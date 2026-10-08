/// <reference types="node" />
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = resolve(__dirname, "..");
const THRESHOLD_PX = 12;
const REM_BASE = 16;

const HIGH_USE_ROUTES = [
  "apps/web/app/accounts/accounts.css",
  "apps/web/app/annual-expenses/annual-expenses.css",
  "apps/web/app/cash-flow/cash-flow.css",
  "apps/web/app/home/home.css",
  "apps/web/app/settings/settings.css",
  "apps/web/app/login/login.css",
];

interface AllowlistEntry {
  file: string;
  selector?: string;
  line?: number;
  reason: string;
}

interface Violation {
  file: string;
  line: number;
  selector: string;
  rawValue: string;
  px: number;
  reason?: string;
}

// Justifications are required for every allowlisted sub-threshold declaration.
// The checker flags every other font-size < 12px equivalent as an unjustified violation.
const ALLOWLIST: AllowlistEntry[] = [];

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::GLOBSTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::GLOBSTAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchAllowlist(file: string, selector: string, line: number): AllowlistEntry | null {
  const relFile = relative(WORKSPACE_ROOT, file);
  for (const entry of ALLOWLIST) {
    const fileMatch = globToRegex(entry.file).test(relFile);
    if (!fileMatch) continue;
    if (entry.selector && !selector.includes(entry.selector)) continue;
    if (entry.line !== undefined && entry.line !== line) continue;
    return entry;
  }
  return null;
}

function countNewlines(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === "\n") n++;
  return n;
}

function toPx(value: string): number | null {
  const v = value
    .replace(/!important/gi, "")
    .replace(/\s+/g, "")
    .toLowerCase();

  if (!v || v === "0" || v === "inherit" || v === "initial" || v === "unset" || v.startsWith("calc")) {
    return null;
  }

  const pxMatch = v.match(/^([0-9]+(?:\.[0-9]+)?)px$/);
  if (pxMatch) return parseFloat(pxMatch[1]!);

  const remMatch = v.match(/^([0-9]+(?:\.[0-9]+)?)rem$/);
  if (remMatch) return parseFloat(remMatch[1]!) * REM_BASE;

  const emMatch = v.match(/^([0-9]+(?:\.[0-9]+)?)em$/);
  if (emMatch) {
    const em = parseFloat(emMatch[1]!);
    // Conservative: flag any em value below 0.75em; assume 16px parent for reporting.
    if (em < 0.75) return em * REM_BASE;
    return THRESHOLD_PX; // not below threshold
  }

  const clampMatch = v.match(/^clamp\(([^,]+),([^,]+),([^)]+)\)$/);
  if (clampMatch) {
    return toPx(clampMatch[1]!);
  }

  return null;
}

interface RuleFrame {
  selector: string;
  startLine: number;
  isAtRule: boolean;
}

function findFontSizeViolations(css: string, filePath: string): Violation[] {
  const violations: Violation[] = [];
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack: RuleFrame[] = [];

  let line = 1;
  let current = "";
  let currentStartLine = 1;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (ch === "\n") {
      line++;
      if (current === "") currentStartLine = line;
    }

    if (ch === "{") {
      const token = current.trim();
      const isAtRule = token.startsWith("@");
      stack.push({ selector: token, startLine: currentStartLine, isAtRule });
      current = "";
      currentStartLine = line;
    } else if (ch === "}" || ch === ";") {
      const token = current.trim();
      const top = stack[stack.length - 1];
      if (token && top && !top.isAtRule) {
        const match = token.match(/font-size\s*:\s*([^;}{]+)/i);
        if (match) {
          const rawValue = match[1]!.trim();
          const propIndex = token.toLowerCase().indexOf("font-size");
          const valueLine = currentStartLine + countNewlines(token.slice(0, propIndex));
          const px = toPx(rawValue);
          if (px !== null && px < THRESHOLD_PX) {
            const selector = stack
              .filter((f) => !f.isAtRule)
              .map((f) => f.selector)
              .join(" ");
            const allowed = matchAllowlist(filePath, selector, valueLine);
            violations.push({
              file: filePath,
              line: valueLine,
              selector,
              rawValue,
              px: Math.round(px * 100) / 100,
              reason: allowed?.reason,
            });
          }
        }
      }
      if (ch === "}") {
        stack.pop();
      }
      current = "";
      currentStartLine = line;
    } else {
      if (current === "") currentStartLine = line;
      current += ch;
    }
  }

  return violations;
}

async function collectCssFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      const nested = await collectCssFiles(p);
      out.push(...nested);
    } else if (ent.isFile() && extname(ent.name) === ".css") {
      out.push(p);
    }
  }
  return out;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const scopeIndex = args.indexOf("--scope");
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : "all";

  let files: string[];
  if (scope === "high-use") {
    files = HIGH_USE_ROUTES.map((f) => resolve(WORKSPACE_ROOT, f));
  } else {
    files = await collectCssFiles(resolve(WORKSPACE_ROOT, "apps/web/app"));
  }

  const allViolations: Violation[] = [];
  for (const file of files) {
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) continue;
    const css = await readFile(file, "utf8");
    const v = findFontSizeViolations(css, file);
    allViolations.push(...v);
  }

  const unjustified: Violation[] = [];
  const allowed: Violation[] = [];
  for (const v of allViolations) {
    if (v.reason) allowed.push(v);
    else unjustified.push(v);
  }

  const byFile = new Map<string, { unjustified: Violation[]; allowed: Violation[] }>();
  for (const v of allViolations) {
    const bucket = byFile.get(v.file) ?? { unjustified: [], allowed: [] };
    if (v.reason) bucket.allowed.push(v);
    else bucket.unjustified.push(v);
    byFile.set(v.file, bucket);
  }

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          scope,
          exitCode: unjustified.length > 0 ? 1 : 0,
          total: allViolations.length,
          unjustified: unjustified.length,
          allowed: allowed.length,
          files: Object.fromEntries(
            [...byFile.entries()].map(([file, { unjustified, allowed }]) => [
              relative(WORKSPACE_ROOT, file),
              { unjustified: unjustified.length, allowed: allowed.length },
            ]),
          ),
          unjustifiedViolations: unjustified.map((v) => ({
            file: relative(WORKSPACE_ROOT, v.file),
            line: v.line,
            selector: v.selector,
            value: v.rawValue,
            px: v.px,
          })),
          allowedViolations: allowed.map((v) => ({
            file: relative(WORKSPACE_ROOT, v.file),
            line: v.line,
            selector: v.selector,
            value: v.rawValue,
            px: v.px,
            reason: v.reason,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    for (const [file, { unjustified, allowed }] of byFile) {
      const rel = relative(WORKSPACE_ROOT, file);
      console.log(`\n${rel}`);
      if (unjustified.length) {
        console.log(`  unjustified (${unjustified.length}):`);
        for (const v of unjustified) {
          console.log(`    ${v.line}: ${v.selector || "(inline)"} = ${v.rawValue} (~${v.px}px)`);
        }
      }
      if (allowed.length) {
        console.log(`  allowlisted (${allowed.length}):`);
        for (const v of allowed) {
          console.log(`    ${v.line}: ${v.selector || "(inline)"} = ${v.rawValue} -- ${v.reason}`);
        }
      }
      if (!unjustified.length && !allowed.length) {
        console.log("  no sub-threshold font-size declarations");
      }
    }
    if (unjustified.length === 0) {
      console.log(`\nNo unjustified sub-threshold font-size declarations (${allowed.length} allowlisted).`);
    } else {
      console.log(`\n${unjustified.length} unjustified sub-threshold font-size declaration(s) found.`);
    }
  }

  return unjustified.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
