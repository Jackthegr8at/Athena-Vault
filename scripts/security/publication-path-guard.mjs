import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const blockedDirectoryNames = new Set([
  "backups",
  "docker-backups",
  "docker-import",
  "drizzle-archive",
  "mockup",
  "workbook-inspection",
]);

const blockedGeneratedDirectoryNames = new Set([
  ".next",
  "node_modules",
  "playwright-report",
  "test-results",
]);

export function classifyPublicationPath(relativePath, isSymlink = false) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  const lowercaseSegments = segments.map((segment) => segment.toLowerCase());
  const basename = lowercaseSegments.at(-1) ?? "";

  if (isSymlink) return "symlink";
  if (lowercaseSegments.some((segment) => blockedDirectoryNames.has(segment))) return "private-directory";
  if (lowercaseSegments.some((segment) => blockedGeneratedDirectoryNames.has(segment) || segment.startsWith(".next-"))) {
    return "generated-directory";
  }
  if (lowercaseSegments[0] === "infrastructure" && lowercaseSegments[1] === "nginx") return "private-infrastructure";
  if (lowercaseSegments[0] === "infrastructure" && lowercaseSegments[1] === "docker" && basename === "compose.yaml") {
    return "retired-infrastructure";
  }
  if (basename === "budget.xlsx" || basename.endsWith(".xlsx")) return "workbook";
  if (/\.(?:dump|backup|bak)(?:\..+)?$/i.test(basename) || basename.endsWith(".sql.gz")) return "backup-file";
  if (basename === ".env" || basename === ".env.local" || (basename.startsWith(".env.docker") && basename !== ".env.docker.example")) {
    return "environment-file";
  }
  return null;
}

export function findForbiddenPublicationPaths(relativePaths) {
  return relativePaths
    .map((entry) => typeof entry === "string" ? { path: entry, isSymlink: false } : entry)
    .map((entry) => ({ path: entry.path, reason: classifyPublicationPath(entry.path, entry.isSymlink) }))
    .filter((entry) => entry.reason !== null);
}

async function listCandidatePaths(root) {
  const pending = [""];
  const paths = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (directory === "" && entry.name === ".git") continue;
      const relativePath = path.join(directory, entry.name).replaceAll("\\", "/");
      const isSymlink = entry.isSymbolicLink();
      paths.push({ path: relativePath, isSymlink });
      if (entry.isDirectory() && !classifyPublicationPath(relativePath)) pending.push(relativePath);
    }
  }
  return paths;
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--root" || !path.isAbsolute(process.argv[3])) {
    console.error("usage: node scripts/security/publication-path-guard.mjs --root <absolute-candidate-directory>");
    process.exitCode = 2;
    return;
  }
  const violations = findForbiddenPublicationPaths(await listCandidatePaths(process.argv[3]));
  for (const violation of violations) console.error(`${violation.reason}: ${violation.path}`);
  console.log(`publication-path-guard=${violations.length === 0 ? "pass" : "fail"} violations=${violations.length}`);
  if (violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("publication-path-guard=error");
    process.exitCode = 2;
  });
}
