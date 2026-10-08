import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scriptPath = fileURLToPath(new URL("./next-standalone-security.mjs", import.meta.url));
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const webRoot = path.join(repositoryRoot, "apps", "web");

async function createFixture(t, { build = true, buildId = true, standalone = true } = {}) {
  const fixtureRoot = await fs.mkdtemp(path.join(webRoot, ".standalone-security-test-"));
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));

  const buildRoot = path.join(fixtureRoot, "build");
  if (build) await fs.mkdir(buildRoot, { recursive: true });
  if (build && buildId) await fs.writeFile(path.join(buildRoot, "BUILD_ID"), "fixture-build-id\n");
  if (build && standalone) await fs.mkdir(path.join(buildRoot, "standalone"), { recursive: true });

  return {
    fixtureRoot,
    buildRoot,
    standalone: path.join(buildRoot, "standalone"),
  };
}

function runChecker(mode, buildRoot) {
  return spawnSync(process.execPath, [scriptPath, mode], {
    cwd: repositoryRoot,
    env: { ...process.env, ATHENA_BUILD_DIST: buildRoot },
    encoding: "utf8",
  });
}

function combinedOutput(result) {
  return (result.stdout ?? "") + (result.stderr ?? "");
}

async function assertExists(target) {
  await assert.doesNotReject(() => fs.lstat(target));
}

async function assertMissing(target) {
  await assert.rejects(() => fs.lstat(target), { code: "ENOENT" });
}

test("fails closed when the selected build root is missing", async (t) => {
  const fixture = await createFixture(t, { build: false });
  const result = runChecker("check", fixture.buildRoot);

  assert.notEqual(result.status, 0);
  assert.match(combinedOutput(result), /does not exist/);
});

test("fails closed when BUILD_ID is missing", async (t) => {
  const fixture = await createFixture(t, { buildId: false });
  const result = runChecker("check", fixture.buildRoot);

  assert.notEqual(result.status, 0);
  assert.match(combinedOutput(result), /BUILD_ID/);
});

test("fails closed when standalone output is missing", async (t) => {
  const fixture = await createFixture(t, { standalone: false });
  const result = runChecker("check", fixture.buildRoot);

  assert.notEqual(result.status, 0);
  assert.match(combinedOutput(result), /Standalone output/);
});

test("rejects a selected output equal to or outside apps/web", async (t) => {
  const fixture = await createFixture(t);
  const equalResult = runChecker("check", webRoot);
  assert.notEqual(equalResult.status, 0);
  assert.match(combinedOutput(equalResult), /below apps[\\/]web/);

  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "athena-standalone-security-"));
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  const outsideResult = runChecker("check", outsideRoot);
  assert.notEqual(outsideResult.status, 0);
  assert.match(combinedOutput(outsideResult), /below apps[\\/]web/);

  await assertExists(fixture.buildRoot);
});

test("passes clean output", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(path.join(fixture.buildRoot, "server.nft.json"), JSON.stringify({ files: ["server.js"] }));
  await fs.writeFile(path.join(fixture.standalone, "server.js"), "generated\n");

  const result = runChecker("check", fixture.buildRoot);

  assert.equal(result.status, 0, combinedOutput(result));
});

test("sanitizes standalone regular environment entries, including an env-named manifest", async (t) => {
  const fixture = await createFixture(t);
  const generatedNames = [".env", ".env.local", ".env.docker", ".env.local.nft.json"];
  for (const name of generatedNames) {
    await fs.writeFile(path.join(fixture.standalone, name), "DO_NOT_PRINT_THIS .env.local\n");
  }

  const outsideDirectory = path.join(fixture.fixtureRoot, "outside");
  await fs.mkdir(outsideDirectory);
  const outsideEnvironment = path.join(outsideDirectory, ".env.local");
  await fs.writeFile(outsideEnvironment, "AUTHORITATIVE_SENTINEL\n");

  const checkResult = runChecker("check", fixture.buildRoot);
  assert.notEqual(checkResult.status, 0);
  assert.match(combinedOutput(checkResult), /\.env(?::|[.])/);
  assert.doesNotMatch(combinedOutput(checkResult), /DO_NOT_PRINT_THIS|AUTHORITATIVE_SENTINEL/);
  for (const name of generatedNames) await assertExists(path.join(fixture.standalone, name));

  const sanitizeResult = runChecker("sanitize", fixture.buildRoot);
  assert.equal(sanitizeResult.status, 0, combinedOutput(sanitizeResult));
  assert.doesNotMatch(combinedOutput(sanitizeResult), /DO_NOT_PRINT_THIS|AUTHORITATIVE_SENTINEL/);
  for (const name of generatedNames) await assertMissing(path.join(fixture.standalone, name));
  await assertExists(outsideEnvironment);

  const finalResult = runChecker("check", fixture.buildRoot);
  assert.equal(finalResult.status, 0, combinedOutput(finalResult));
});

test("fails in both modes when a generated trace manifest references local or Docker environment files", async (t) => {
  const fixture = await createFixture(t);
  const manifest = path.join(fixture.buildRoot, "server.nft.json");
  await fs.writeFile(manifest, JSON.stringify({ files: [".env.local", "apps/web/.env.docker"] }));

  const checkResult = runChecker("check", fixture.buildRoot);
  assert.notEqual(checkResult.status, 0);
  assert.match(combinedOutput(checkResult), /server\.nft\.json/);
  await assertExists(manifest);

  const sanitizeResult = runChecker("sanitize", fixture.buildRoot);
  assert.notEqual(sanitizeResult.status, 0);
  assert.match(combinedOutput(sanitizeResult), /server\.nft\.json/);
  await assertExists(manifest);
});

test("fails for a regular env-named build-root trace manifest without reading environment files", async (t) => {
  const fixture = await createFixture(t);
  const manifest = path.join(fixture.buildRoot, ".env.local.nft.json");
  await fs.writeFile(manifest, JSON.stringify({ files: [".env.local", "apps/web/.env.docker"] }));

  const fixtureEnvironment = path.join(fixture.buildRoot, ".env.local");
  await fs.writeFile(fixtureEnvironment, "FIXTURE_ENVIRONMENT_FILE_SENTINEL\n");

  const outsideDirectory = path.join(fixture.fixtureRoot, "outside");
  await fs.mkdir(outsideDirectory);
  const outsideFile = path.join(outsideDirectory, "outside.txt");
  await fs.writeFile(outsideFile, "OUTSIDE_FILE_SENTINEL\n");

  const checkResult = runChecker("check", fixture.buildRoot);
  assert.notEqual(checkResult.status, 0);
  assert.ok(combinedOutput(checkResult).includes(manifest), combinedOutput(checkResult));
  assert.doesNotMatch(combinedOutput(checkResult), /FIXTURE_ENVIRONMENT_FILE_SENTINEL|OUTSIDE_FILE_SENTINEL/);
  await assertExists(manifest);

  const sanitizeResult = runChecker("sanitize", fixture.buildRoot);
  assert.notEqual(sanitizeResult.status, 0);
  assert.ok(combinedOutput(sanitizeResult).includes(manifest), combinedOutput(sanitizeResult));
  assert.doesNotMatch(combinedOutput(sanitizeResult), /FIXTURE_ENVIRONMENT_FILE_SENTINEL|OUTSIDE_FILE_SENTINEL/);
  await assertExists(manifest);
});

test("fails closed for an env-named build-root directory without inspecting its contents", async (t) => {
  const fixture = await createFixture(t);
  const environmentDirectory = path.join(fixture.buildRoot, ".env.local");
  const nestedManifest = path.join(environmentDirectory, "trace.nft.json");
  const nestedSentinel = path.join(environmentDirectory, "sentinel.txt");
  await fs.mkdir(environmentDirectory);
  await fs.writeFile(nestedManifest, JSON.stringify({ files: [".env.local", "apps/web/.env.docker"] }));
  await fs.writeFile(nestedSentinel, "NESTED_ENV_DIRECTORY_SENTINEL\n");

  for (const mode of ["check", "sanitize"]) {
    const result = runChecker(mode, fixture.buildRoot);
    const output = combinedOutput(result);
    assert.notEqual(result.status, 0, output);
    assert.ok(output.includes(environmentDirectory), output);
    assert.doesNotMatch(output, /NESTED_ENV_DIRECTORY_SENTINEL/);
    await assertExists(environmentDirectory);
    await assertExists(nestedManifest);
    await assertExists(nestedSentinel);
  }
});

test("does not follow a directory symlink while scanning or sanitizing", async (t) => {
  const fixture = await createFixture(t);
  const outsideDirectory = path.join(fixture.fixtureRoot, "outside");
  await fs.mkdir(outsideDirectory);
  const outsideEnvironment = path.join(outsideDirectory, ".env.local");
  await fs.writeFile(outsideEnvironment, "OUTSIDE_SENTINEL\n");
  const linkedDirectory = path.join(fixture.standalone, "linked");

  try {
    await fs.symlink(outsideDirectory, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error && typeof error === "object" && ("code" in error) && (error.code === "EACCES" || error.code === "EPERM")) {
      t.skip("directory symlinks are unavailable in this test environment");
      return;
    }
    throw error;
  }

  const checkResult = runChecker("check", fixture.buildRoot);
  assert.equal(checkResult.status, 0, combinedOutput(checkResult));
  const sanitizeResult = runChecker("sanitize", fixture.buildRoot);
  assert.equal(sanitizeResult.status, 0, combinedOutput(sanitizeResult));
  await assertExists(linkedDirectory);
  await assertExists(outsideEnvironment);
});

test("does not modify an environment symlink or its outside target", async (t) => {
  const fixture = await createFixture(t);
  const outsideDirectory = path.join(fixture.fixtureRoot, "outside");
  await fs.mkdir(outsideDirectory);
  const outsideFile = path.join(outsideDirectory, "payload");
  await fs.writeFile(outsideFile, "OUTSIDE_SENTINEL\n");
  const linkedEnvironment = path.join(fixture.standalone, ".env.local");

  try {
    await fs.symlink(outsideDirectory, linkedEnvironment, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error && typeof error === "object" && ("code" in error) && (error.code === "EACCES" || error.code === "EPERM")) {
      t.skip("directory symlinks are unavailable in this test environment");
      return;
    }
    throw error;
  }

  const checkResult = runChecker("check", fixture.buildRoot);
  assert.notEqual(checkResult.status, 0);
  assert.match(combinedOutput(checkResult), /\.env\.local/);
  assert.doesNotMatch(combinedOutput(checkResult), /OUTSIDE_SENTINEL/);

  const sanitizeResult = runChecker("sanitize", fixture.buildRoot);
  assert.notEqual(sanitizeResult.status, 0);
  assert.match(combinedOutput(sanitizeResult), /\.env\.local/);
  assert.doesNotMatch(combinedOutput(sanitizeResult), /OUTSIDE_SENTINEL/);
  await assertExists(linkedEnvironment);
  await assertExists(outsideFile);
});
