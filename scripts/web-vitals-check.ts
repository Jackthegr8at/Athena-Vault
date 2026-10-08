/// <reference lib="ES2024.Promise" />
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = resolve(__dirname, "..");

const LOCAL_HOSTS: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
};

type JSONReport = {
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
  };
  suites?: Suite[];
  errors?: unknown[];
};

type Suite = {
  specs?: Spec[];
};

type Spec = {
  title?: string;
  tests?: Test[];
};

type Test = {
  results?: Result[];
};

type Result = {
  status: string;
  attachments?: Attachment[];
};

type Attachment = {
  name: string;
  contentType?: string;
  path?: string;
  body?: string;
};

type ObservationPayload = {
  route: string;
  profile: string;
  observations: Array<{ name: string; value: unknown }>;
  deviations?: unknown[];
};

function isLocalBaseURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return LOCAL_HOSTS[parsed.hostname] === true;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  console.error(`web:vitals failed — ${message}`);
  console.error(
    "\nRequired environment for a disposable local run:\n" +
      "  ATHENA_E2E_BASE_URL=http://localhost:3000\n\n" +
      "Run with:\n" +
      "  corepack pnpm web:vitals\n\n" +
      "Or manually:\n" +
      "  NEXT_PUBLIC_ATHENA_LOCAL_WEB_VITALS=true ATHENA_WEB_VITALS_RUN=true " +
      'corepack pnpm --filter @athena/web exec playwright test e2e/web-vitals.spec.ts --reporter=json',
  );
  process.exit(1);
}

function getObservationValue(
  observations: Array<{ name: string; value: unknown }>,
  name: string,
): unknown {
  return observations.find((o) => o.name === name)?.value;
}

function requireFiniteNumber(
  observations: Array<{ name: string; value: unknown }>,
  name: string,
  profile: string,
): number {
  const raw = getObservationValue(observations, name);
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    fail(`Observation payload for ${profile} is missing or non-finite ${name}.`);
  }
  return raw;
}

async function decodeAttachment(attachment: Attachment): Promise<string> {
  if (typeof attachment.body === "string" && attachment.body.length > 0) {
    try {
      const decoded = Buffer.from(attachment.body, "base64").toString("utf8");
      // If the decoded text parses as JSON, the body was base64-encoded.
      JSON.parse(decoded);
      return decoded;
    } catch {
      // Otherwise treat the body as a raw JSON string.
      return attachment.body;
    }
  }

  if (attachment.path) {
    const packageRoot = resolve(WORKSPACE_ROOT, "apps/web");
    const attachmentPath = isAbsolute(attachment.path)
      ? attachment.path
      : resolve(packageRoot, attachment.path);
    if (!existsSync(attachmentPath)) {
      fail(
        `Attachment ${attachment.name} refers to a missing path: ${attachment.path}`,
      );
    }
    return readFile(attachmentPath, "utf8");
  }

  fail(`Attachment ${attachment.name} has neither body nor path.`);
}

async function runPlaywright(port: string): Promise<number> {
  const command = "corepack";
  const args = [
    "pnpm",
    "--filter",
    "@athena/web",
    "exec",
    "playwright",
    "test",
    "e2e/web-vitals.spec.ts",
    "--reporter=json",
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATHENA_WEB_VITALS_RUN: "true",
    NEXT_PUBLIC_ATHENA_LOCAL_WEB_VITALS: "true",
    PORT: port,
  };

  const child = spawn(command, args, {
    cwd: WORKSPACE_ROOT,
    env,
    stdio: "pipe",
  });

  child.stdout.on("data", (data: Buffer) => {
    process.stdout.write(data);
  });
  child.stderr.on("data", (data: Buffer) => {
    process.stderr.write(data);
  });

  const { promise, resolve: finish } = Promise.withResolvers<number>();
  child.on("close", (code) => finish(code ?? 1));
  return promise;
}

async function validateReport(reportPath: string): Promise<void> {
  if (!existsSync(reportPath)) {
    fail("Playwright JSON report was not produced at apps/web/playwright-report/results.json");
  }

  const raw = await readFile(reportPath, "utf8");
  const report = JSON.parse(raw) as JSONReport;

  const unexpected = report.stats?.unexpected ?? 0;
  const errors = report.errors?.length ?? 0;

  if (errors > 0 || unexpected > 0) {
    fail(
      `Playwright reported ${unexpected} unexpected failure(s) and ${errors} error(s).`,
    );
  }

  let totalTests = 0;
  let completedTests = 0;
  let observedTests = 0;

  for (const suite of report.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const result of t.results ?? []) {
          totalTests += 1;

          if (result.status !== "passed") {
            fail(
              `Test ${spec.title ?? "<unknown>"} completed with status ${result.status}.`,
            );
          }
          completedTests += 1;

          const attachment = result.attachments?.find(
            (a) => a.name === "web-vitals-observations",
          );
          if (!attachment) {
            fail(
              `Missing web-vitals-observations attachment for ${spec.title ?? "<unknown>"}.`,
            );
          }

          const content = await decodeAttachment(attachment);
          let payload: ObservationPayload;
          try {
            payload = JSON.parse(content) as ObservationPayload;
          } catch (err) {
            fail(
              `Malformed web-vitals-observations attachment for ${spec.title ?? "<unknown>"}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          const profile = payload.profile ?? spec.title ?? "<unknown>";
          const { observations } = payload;
          if (!Array.isArray(observations) || observations.length === 0) {
            fail(`Observation payload for ${profile} is missing or empty.`);
          }

          requireFiniteNumber(observations, "LCP", profile);
          requireFiniteNumber(observations, "CLS", profile);
          requireFiniteNumber(observations, "transferSize", profile);
          requireFiniteNumber(observations, "horizontalOverflow", profile);

          const inp = getObservationValue(observations, "INP");
          if (typeof inp !== "number" || !Number.isFinite(inp) || inp <= 0) {
            fail(
              `INP observation is missing, non-finite, or not strictly positive for ${profile}.`,
            );
          }

          observedTests += 1;
        }
      }
    }
  }

  if (totalTests === 0) {
    fail("No test results were found in the Playwright JSON report.");
  }
  if (completedTests === 0) {
    fail("No web vitals tests completed.");
  }
  if (observedTests !== completedTests) {
    fail(
      `Missing or invalid web-vitals observations: ${observedTests}/${completedTests} test(s) had valid observations.`,
    );
  }

  console.log(
    `web:vitals passed — ${observedTests}/${completedTests} tests collected web vitals observations with 0 unexpected failures.`,
  );
}

async function main(): Promise<void> {
  const baseURL = process.env.ATHENA_E2E_BASE_URL;
  if (!baseURL || !isLocalBaseURL(baseURL)) {
    fail(
      "ATHENA_E2E_BASE_URL must point to a local, disposable instance (e.g., http://localhost:3000).",
    );
  }
  const parsedBaseURL = new URL(baseURL);
  const port = parsedBaseURL.port || "3000";


  const reportPath = resolve(
    WORKSPACE_ROOT,
    "apps/web/playwright-report/results.json",
  );

  await rm(reportPath, { force: true });

  const exitCode = await runPlaywright(port);
  if (exitCode !== 0) {
    fail(`Playwright exited with code ${exitCode}.`);
  }

  await validateReport(reportPath);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
