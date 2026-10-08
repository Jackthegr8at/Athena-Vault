import assert from "node:assert/strict";
import test from "node:test";
import { classifyPublicationPath, findForbiddenPublicationPaths } from "./publication-path-guard.mjs";

test("rejects backup files and backup directories regardless of extension or separator", () => {
  for (const candidate of [
    "infrastructure/backups/archive.dump",
    "docker-backups/2026-01-01/file",
    "copy.dump",
    "copy.dump.age",
    "copy.backup",
    "copy.bak",
    "copy.sql.gz",
    "folder\\BACKUPS\\snapshot.txt",
  ]) {
    assert.ok(classifyPublicationPath(candidate), candidate);
  }
});

test("rejects workbook data, archived migrations, mockups, and operator infrastructure", () => {
  for (const candidate of [
    "Budget.xlsx",
    "workbook-inspection/summary.ndjson",
    "mockup/background/source.ai",
    "packages/database/drizzle-archive/old.sql",
    "infrastructure/nginx/private.conf",
    "infrastructure/docker/compose.yaml",
    ".env.docker.prod",
  ]) {
    assert.ok(classifyPublicationPath(candidate), candidate);
  }
});

test("allows expected public sources and examples", () => {
  for (const candidate of [
    "packages/database/drizzle/0000_current_schema_baseline.sql",
    "apps/web/public/brand/bank.webp",
    "docs/backup-and-restore.md",
    ".env.example",
    ".env.docker.example",
  ]) {
    assert.equal(classifyPublicationPath(candidate), null, candidate);
  }
});

test("rejects symlinks without following them and reports paths only", () => {
  assert.equal(classifyPublicationPath("assets/linked-image.png", true), "symlink");
  assert.deepEqual(findForbiddenPublicationPaths(["README.md", "workbook-inspection/private.ndjson"]), [
    { path: "workbook-inspection/private.ndjson", reason: "private-directory" },
  ]);
});
