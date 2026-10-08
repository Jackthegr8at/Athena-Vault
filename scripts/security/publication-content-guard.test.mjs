import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guard = fileURLToPath(new URL("./publication-content-guard.mjs", import.meta.url));

async function withCandidate(action) {
  const root = await mkdtemp(path.join(os.tmpdir(), "athena-publication-content-test-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function scan(root) {
  return spawnSync(process.execPath, [guard, "--root", root], { encoding: "utf8" });
}

test("accepts a clean candidate without Git history", async () => {
  await withCandidate(async (root) => {
    await writeFile(path.join(root, "README.md"), "# Public install\n");
    const result = scan(root);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /publication-content-guard=pass findings=0/);
  });
});

test("reports only a path and category for a credential-like value", async () => {
  await withCandidate(async (root) => {
    await writeFile(path.join(root, "settings.example"), `SERVICE_${"TOKEN"}=${"a".repeat(40)}\n`);
    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /potential-credential: settings\.example/);
    assert.doesNotMatch(result.stderr + result.stdout, /a{20}/);
  });
});

test("rejects references to excluded paths", async () => {
  await withCandidate(async (root) => {
    await writeFile(path.join(root, "README.md"), `[private](${"pl" + "an"}/internal.md)\n`);
    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /excluded-path-link: README\.md/);
  });
});

test("rejects private network identifiers without printing values", async () => {
  await withCandidate(async (root) => {
    await mkdir(path.join(root, "docs"));
    const address = [192, 168, 0, 191].join(".");
    await writeFile(path.join(root, "docs", "setup.md"), `host=${address}\n`);
    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /private-network: docs\/setup\.md/);
    assert.ok(!result.stderr.includes(address));
  });
});
