#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptFile), "..");
const webRoot = path.join(repositoryRoot, "apps", "web");
const environmentBasename = (basename) => basename === ".env" || basename.startsWith(".env.");
const traceManifestSuffix = ".nft.json";
const traceEnvironmentReference = /\.env\.(?:local|docker)/g;

class StandaloneSecurityError extends Error {
  constructor(message, { reported = false } = {}) {
    super(message);
    this.name = "StandaloneSecurityError";
    this.reported = reported;
  }
}

function isPathWithin(candidate, parent, includeParent) {
  const relative = path.relative(parent, candidate);
  if (relative === "") return includeParent;
  return !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
}

async function inspectPath(target, description) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    const suffix = errorCode(error) === "ENOENT" ? " does not exist" : " could not be inspected";
    throw new StandaloneSecurityError(description + suffix + ": " + target);
  }
}

async function resolveRealPath(target, description) {
  try {
    return await fs.realpath(target);
  } catch {
    throw new StandaloneSecurityError(description + " could not be resolved: " + target);
  }
}

export function resolveBuildRoot(configuredDist = process.env.ATHENA_BUILD_DIST) {
  const dist = configuredDist ?? ".next";
  if (typeof dist !== "string") {
    throw new StandaloneSecurityError("ATHENA_BUILD_DIST must be a path relative to apps/web or an absolute path.");
  }

  const candidate = path.resolve(webRoot, dist);
  const resolvedWebRoot = path.resolve(webRoot);
  if (!isPathWithin(candidate, resolvedWebRoot, false)) {
    throw new StandaloneSecurityError("ATHENA_BUILD_DIST must resolve below apps/web: " + candidate);
  }
  return candidate;
}

async function validateBuildOutput(buildRoot) {
  const resolvedWebRoot = await resolveRealPath(webRoot, "apps/web");
  if (!isPathWithin(buildRoot, path.resolve(webRoot), false)) {
    throw new StandaloneSecurityError("Build output must resolve below apps/web: " + buildRoot);
  }

  const buildRootStat = await inspectPath(buildRoot, "Build output");
  if (buildRootStat.isSymbolicLink() || !buildRootStat.isDirectory()) {
    throw new StandaloneSecurityError("Build output must be a real directory: " + buildRoot);
  }

  const realBuildRoot = await resolveRealPath(buildRoot, "Build output");
  if (!isPathWithin(realBuildRoot, resolvedWebRoot, false)) {
    throw new StandaloneSecurityError("Build output resolves outside apps/web: " + buildRoot);
  }

  const buildId = path.join(buildRoot, "BUILD_ID");
  const buildIdStat = await inspectPath(buildId, "BUILD_ID");
  if (buildIdStat.isSymbolicLink() || !buildIdStat.isFile()) {
    throw new StandaloneSecurityError("BUILD_ID must be a regular file: " + buildId);
  }

  const standalone = path.join(buildRoot, "standalone");
  const standaloneStat = await inspectPath(standalone, "Standalone output");
  if (standaloneStat.isSymbolicLink() || !standaloneStat.isDirectory()) {
    throw new StandaloneSecurityError("Standalone output must be a real directory: " + standalone);
  }

  const realStandalone = await resolveRealPath(standalone, "Standalone output");
  if (!isPathWithin(realStandalone, realBuildRoot, false) || !isPathWithin(realStandalone, resolvedWebRoot, false)) {
    throw new StandaloneSecurityError("Standalone output resolves outside the selected build output: " + standalone);
  }

  return { buildRoot, realBuildRoot, standalone, realStandalone };
}

async function* enumerateEntries(directory, { skipEnvironmentDirectories = false } = {}) {
  let names;
  try {
    names = await fs.readdir(directory);
  } catch {
    throw new StandaloneSecurityError("Directory could not be enumerated: " + directory);
  }

  names.sort();
  for (const name of names) {
    const entryPath = path.join(directory, name);
    const stats = await inspectPath(entryPath, "Generated entry");
    yield { name, path: entryPath, stats };

    // lstat above deliberately does not follow symlinks. Recurse only into
    // directories confirmed to be real directories at enumeration time.
    if (stats.isDirectory() && !stats.isSymbolicLink() && !(skipEnvironmentDirectories && environmentBasename(name))) {
      yield* enumerateEntries(entryPath, { skipEnvironmentDirectories });
    }
  }
}

async function findEnvironmentEntries(standalone) {
  const matches = [];
  for await (const entry of enumerateEntries(standalone)) {
    if (environmentBasename(entry.name)) matches.push(entry);
  }
  return matches;
}

async function findTraceIssues(buildRoot) {
  const issues = [];
  for await (const entry of enumerateEntries(buildRoot, { skipEnvironmentDirectories: true })) {
    if (entry.stats.isDirectory() && !entry.stats.isSymbolicLink() && environmentBasename(entry.name)) {
      issues.push({ path: entry.path, count: 1 });
      continue;
    }

    if (!entry.name.endsWith(traceManifestSuffix)) continue;

    // A trace symlink could point outside the generated output. Do not follow
    // it or inspect its target; fail closed instead.
    if (entry.stats.isSymbolicLink() || !entry.stats.isFile()) {
      issues.push({ path: entry.path, count: 1 });
      continue;
    }

    let contents;
    try {
      contents = await fs.readFile(entry.path, "utf8");
    } catch {
      throw new StandaloneSecurityError("Trace manifest could not be read: " + entry.path);
    }

    const references = contents.match(traceEnvironmentReference) ?? [];
    if (references.length > 0) issues.push({ path: entry.path, count: references.length });
  }
  return issues;
}

async function assertClean(output) {
  const environmentEntries = await findEnvironmentEntries(output.realStandalone);
  const traceIssues = await findTraceIssues(output.realBuildRoot);

  if (environmentEntries.length === 0 && traceIssues.length === 0) return;

  for (const entry of environmentEntries) {
    console.error(entry.path + ":1");
  }
  for (const issue of traceIssues) {
    console.error(issue.path + ":" + issue.count);
  }
  throw new StandaloneSecurityError("Standalone output failed security checks.", { reported: true });
}

async function sanitizeEnvironmentEntries(output) {
  const environmentEntries = await findEnvironmentEntries(output.realStandalone);

  for (const entry of environmentEntries) {
    const parent = path.dirname(entry.path);
    const realParent = await resolveRealPath(parent, "Generated entry parent");
    const realEntry = path.join(realParent, entry.name);
    if (!isPathWithin(realParent, output.realStandalone, true) || !isPathWithin(realEntry, output.realStandalone, false)) {
      throw new StandaloneSecurityError("Generated environment entry resolves outside standalone output: " + entry.path);
    }

    const current = await inspectPath(realEntry, "Generated environment entry");
    // Only regular generated files are eligible for unlink. Symlinks and
    // directories remain for the final check to reject without modifying a
    // path that may refer to an external target.
    if (!current.isFile() || current.isSymbolicLink()) continue;

    try {
      await fs.unlink(realEntry);
    } catch {
      throw new StandaloneSecurityError("Generated environment entry could not be removed: " + realEntry);
    }
    console.error(realEntry + ":removed");
  }
}

export async function run(mode) {
  if (mode !== "sanitize" && mode !== "check") {
    throw new StandaloneSecurityError("Mode must be explicitly set to sanitize or check.");
  }

  const buildRoot = resolveBuildRoot();
  const output = await validateBuildOutput(buildRoot);

  if (mode === "sanitize") {
    await sanitizeEnvironmentEntries(output);
    const refreshedOutput = await validateBuildOutput(buildRoot);
    await assertClean(refreshedOutput);
    return;
  }

  await assertClean(output);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isMain = process.platform === "win32"
  ? invokedFile.toLowerCase() === scriptFile.toLowerCase()
  : invokedFile === scriptFile;

if (isMain) {
  const mode = process.argv[2];
  if (mode === "--help" || mode === "-h") {
    console.log("Usage: node scripts/next-standalone-security.mjs <sanitize|check>");
  } else if (process.argv.length !== 3) {
    console.error("Usage: node scripts/next-standalone-security.mjs <sanitize|check>");
    process.exitCode = 2;
  } else {
    run(mode).catch((error) => {
      if (!(error instanceof StandaloneSecurityError && error.reported)) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("next-standalone-security: " + message);
      }
      process.exitCode = 1;
    });
  }
}
