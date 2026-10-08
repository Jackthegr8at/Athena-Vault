import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const collector = fileURLToPath(new URL("./generate-third-party-notices.mjs", import.meta.url));
const fullNotice = "Copyright (c) Synthetic Fixture Author\nPermission is hereby granted, free of charge, to use this fixture.\nTHE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY.\n";

async function fixture(documents, run) {
  const root = await mkdtemp(path.join(tmpdir(), "athena-notice-test-"));
  try {
    const packageRoot = path.join(root, "node_modules/.pnpm/fixture@1.0.0/node_modules/fixture");
    await mkdir(packageRoot, { recursive: true });
    await mkdir(path.join(root, "third-party"));
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\npackages:\n  fixture@1.0.0:\n    resolution: {}\n\nsnapshots:\n  fixture@1.0.0: {}\n");
    await writeFile(path.join(root, "third-party/supplemental-notices.json"), "{}\n");
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", license: "MIT" }));
    for (const [name, text] of Object.entries(documents)) await writeFile(path.join(packageRoot, name), text);
    const summary = JSON.parse(execFileSync(process.execPath, [collector, "--root", root], { encoding: "utf8" }));
    const inventory = JSON.parse(await readFile(path.join(root, "third-party/npm-inventory.json"), "utf8"));
    const notices = await readFile(path.join(root, "third-party/npm-notices.txt"), "utf8");
    await run({ summary, inventory, notices });
    execFileSync(process.execPath, [collector, "--root", root, "--check"]);
  } finally {
    // Delete only the exact fresh fixture directory owned by this test.
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("athena-notice-test-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("retains a full upstream README notice, not the unrelated example content", async () => {
  await fixture({ "README.md": "# Usage\nUnrelated example content\n\n# LICENSE\n" + fullNotice }, ({ summary, inventory, notices }) => {
    assert.deepEqual(summary.missingNotice, []);
    assert.equal(inventory.packages[0].notices[0].file, "README.md");
    assert.ok(notices.includes(fullNotice.trimEnd()));
    assert.ok(!notices.includes("Unrelated example content"));
  });
});

test("does not treat a README license declaration/link as an original notice", async () => {
  await fixture({ "README.md": "# License\nReleased under MIT. See https://spdx.org/licenses/MIT.html\n" }, ({ summary }) => {
    assert.deepEqual(summary.missingNotice, ["fixture@1.0.0"]);
  });
});

test("retains THIRD-PARTY-NOTICES alongside the primary LICENSE", async () => {
  await fixture({ LICENSE: fullNotice, "THIRD-PARTY-NOTICES.md": "Copyright (c) Synthetic Vendor\nVendor notice\n" }, ({ inventory, notices }) => {
    assert.equal(inventory.packages[0].notices.length, 2);
    assert.ok(notices.includes("Synthetic Vendor"));
  });
});
