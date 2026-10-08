/// <reference lib="ES2024.Promise" />
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  console.error(`a11y:zoom failed — ${message}`);
  console.error(
    "\nRequired environment for a disposable local run:\n" +
      "  ATHENA_E2E_ENABLED=true\n" +
      "  ATHENA_E2E_DISPOSABLE=true\n" +
      "  ATHENA_E2E_BASE_URL=http://localhost:3000",
  );
  process.exit(1);
}

async function runPlaywright(): Promise<number> {
  const command = "corepack";
  const args = [
    "pnpm",
    "--filter",
    "@athena/web",
    "exec",
    "playwright",
    "test",
    "e2e/a11y-zoom.spec.ts",
    "--reporter=json",
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATHENA_E2E_ENABLED: "true",
    ATHENA_E2E_DISPOSABLE: "true",
    ATHENA_E2E_SUITE: "a11y-zoom",
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
  const expected = report.stats?.expected ?? 0;
  const skipped = report.stats?.skipped ?? 0;
  const hasErrors = (report.errors?.length ?? 0) > 0;

  if (hasErrors || unexpected > 0) {
    fail(`Playwright reported ${unexpected} unexpected failure(s) and ${report.errors?.length ?? 0} error(s).`);
  }

  if (expected === 0 || expected === skipped) {
    fail("No a11y-zoom tests were collected. Ensure the suite is registered in playwright.config.ts.");
  }

  let totalTests = 0;
  let observedTests = 0;
  for (const suite of report.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const result of t.results ?? []) {
          totalTests += 1;
          const attachment = result.attachments?.find(
            (a) => a.name === "a11y-observations",
          );
          if (!attachment) continue;

          if (typeof attachment.body === "string" && attachment.body.length > 0) {
            observedTests += 1;
            continue;
          }

          const attachmentPath = attachment.path;
          if (attachmentPath && existsSync(attachmentPath)) {
            const info = await stat(attachmentPath);
            if (info.size > 0) {
              observedTests += 1;
            }
          }
        }
      }
    }
  }

  if (totalTests === 0) {
    fail("No test results were found in the Playwright JSON report.");
  }

  if (observedTests !== totalTests) {
    fail(
      `Missing or empty a11y observations: ${observedTests}/${totalTests} test(s) had an a11y-observations attachment.`,
    );
  }

  console.log(
    `a11y:zoom passed — ${observedTests}/${totalTests} tests collected a11y observations with 0 unexpected failures.`,
  );
}

async function main(): Promise<void> {
  const e2eEnabled = process.env.ATHENA_E2E_ENABLED === "true";
  const e2eDisposable = process.env.ATHENA_E2E_DISPOSABLE === "true";
  const e2eBaseURL = process.env.ATHENA_E2E_BASE_URL;

  if (!e2eEnabled) {
    fail("ATHENA_E2E_ENABLED is not set to \"true\".");
  }
  if (!e2eDisposable) {
    fail("ATHENA_E2E_DISPOSABLE is not set to \"true\".");
  }
  if (!e2eBaseURL || !isLocalBaseURL(e2eBaseURL)) {
    fail("ATHENA_E2E_BASE_URL must point to a local, disposable instance (e.g., http://localhost:3000).");
  }

  const exitCode = await runPlaywright();
  if (exitCode !== 0) {
    fail(`Playwright exited with code ${exitCode}.`);
  }

  const reportPath = resolve(
    WORKSPACE_ROOT,
    "apps/web/playwright-report/results.json",
  );
  await validateReport(reportPath);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
