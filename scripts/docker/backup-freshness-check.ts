import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  symlink,
  readdir,
  stat,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BACKUP_NAME_RE =
  /^athena-vault-scheduled-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump\.age$/;
const FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const META_EXT = ".dump.age.meta";
const EXPECTED_ALGORITHM = "sha256";

interface BackupMetadata {
  file: string;
  createdAt: string;
  bytes: number;
  sha256: string;
  algorithm: string;
}

interface CheckResult {
  name: string;
  expected: "passed" | "failed";
  actual: "passed" | "failed";
  reason?: string;
}

interface Event {
  event: "backup-freshness-check";
  operation: string;
  status: "passed" | "failed";
  errorClass: string;
  failureCode: string;
  [key: string]: unknown;
}

function emit(event: Event): void {
  console.log(JSON.stringify(event));
}

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return sha256Buffer(bytes);
}

function formatBackupFileName(date: Date): string {
  const Y = String(date.getUTCFullYear());
  const M = String(date.getUTCMonth() + 1).padStart(2, "0");
  const D = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const m = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `athena-vault-scheduled-${Y}${M}${D}T${h}${m}${s}Z.dump.age`;
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function getReferenceNow(): Date {
  const env = process.env.BACKUP_FRESHNESS_NOW;
  if (env) {
    const parsed = Date.parse(env);
    if (Number.isNaN(parsed)) {
      throw new Error("invalid-BACKUP_FRESHNESS_NOW");
    }
    return new Date(parsed);
  }
  // Deterministic default for the synthetic, self-contained self-test.
  return new Date("2026-09-02T00:00:00.000Z");
}

function okEvent(operation: string, extras: Record<string, unknown> = {}): Event {
  return {
    event: "backup-freshness-check",
    operation,
    status: "passed",
    errorClass: "None",
    failureCode: "OK",
    ...extras,
  };
}

function failEvent(
  operation: string,
  errorClass: string,
  failureCode: string,
  extras: Record<string, unknown> = {}
): Event {
  return {
    event: "backup-freshness-check",
    operation,
    status: "failed",
    errorClass,
    failureCode,
    ...extras,
  };
}

async function main(): Promise<number> {
  const referenceNow = getReferenceNow();
  const tempPrefix = path.join(os.tmpdir(), "athena-backup-freshness-");
  const tempRoot = await mkdtemp(tempPrefix);
  let created = true;
  const results: CheckResult[] = [];

  try {
    const fixturesDir = path.join(tempRoot, "fixtures");
    const restoreDir = path.join(tempRoot, "restore-contract");
    await mkdir(fixturesDir, { recursive: true });
    await mkdir(restoreDir, { recursive: true });

    const freshDate = new Date(referenceNow.getTime() - 1 * 60 * 60 * 1000);
    const staleDate = new Date(referenceNow.getTime() - 25 * 60 * 60 * 1000);
    const badChecksumDate = new Date(referenceNow.getTime() - 2 * 60 * 60 * 1000);
    const badSizeDate = new Date(referenceNow.getTime() - 3 * 60 * 60 * 1000);
    const missingMetaDate = new Date(referenceNow.getTime() - 4 * 60 * 60 * 1000);

    const freshContent = Buffer.from(
      `FRESH:${freshDate.toISOString()}:synthetic-dump`,
      "utf8"
    );
    const staleContent = Buffer.from(
      `STALE:${staleDate.toISOString()}:synthetic-dump`,
      "utf8"
    );
    const badChecksumContent = Buffer.from(
      `BAD-CHECKSUM:${badChecksumDate.toISOString()}:synthetic-dump`,
      "utf8"
    );
    const badSizeContent = Buffer.from(
      `BAD-SIZE:${badSizeDate.toISOString()}:synthetic-dump`,
      "utf8"
    );
    const missingMetaContent = Buffer.from(
      `MISSING-META:${missingMetaDate.toISOString()}:synthetic-dump`,
      "utf8"
    );

    const fixtures: Array<{
      name: string;
      date: Date;
      content: Buffer;
      kind: "good" | "stale" | "badChecksum" | "badSize" | "missingMeta";
    }> = [
      { name: formatBackupFileName(freshDate), date: freshDate, content: freshContent, kind: "good" },
      { name: formatBackupFileName(staleDate), date: staleDate, content: staleContent, kind: "stale" },
      { name: formatBackupFileName(badChecksumDate), date: badChecksumDate, content: badChecksumContent, kind: "badChecksum" },
      { name: formatBackupFileName(badSizeDate), date: badSizeDate, content: badSizeContent, kind: "badSize" },
      { name: formatBackupFileName(missingMetaDate), date: missingMetaDate, content: missingMetaContent, kind: "missingMeta" },
    ];

    for (const f of fixtures) {
      const filePath = path.join(fixturesDir, f.name);
      await writeFile(filePath, f.content);
      if (f.kind === "good" || f.kind === "stale") {
        const meta: BackupMetadata = {
          file: f.name,
          createdAt: f.date.toISOString(),
          bytes: f.content.length,
          sha256: sha256Buffer(f.content),
          algorithm: EXPECTED_ALGORITHM,
        };
        await writeFile(filePath + META_EXT, JSON.stringify(meta, null, 2));
      } else if (f.kind === "badChecksum") {
        await writeFile(
          filePath + META_EXT,
          JSON.stringify({
            file: f.name,
            createdAt: f.date.toISOString(),
            bytes: f.content.length,
            sha256: "0".repeat(64),
            algorithm: EXPECTED_ALGORITHM,
          })
        );
      } else if (f.kind === "badSize") {
        await writeFile(
          filePath + META_EXT,
          JSON.stringify({
            file: f.name,
            createdAt: f.date.toISOString(),
            bytes: 999_999_999,
            sha256: sha256Buffer(f.content),
            algorithm: EXPECTED_ALGORITHM,
          })
        );
      }
    }

    const namingAnomalyFile = path.join(
      fixturesDir,
      "athena-vault-bad-name.dump.age"
    );
    await writeFile(namingAnomalyFile, Buffer.from("NOT-A-BACKUP", "utf8"));

    const symlinkName = "athena-vault-scheduled-00000000T000000Z.dump.age";
    const symlinkPath = path.join(fixturesDir, symlinkName);
    await symlink("/etc/passwd", symlinkPath);

    emit(okEvent("create-fixtures", { referenceNow: referenceNow.toISOString() }));

    // Path containment: every fixture must resolve inside the temp root.
    const entries = await readdir(fixturesDir, { withFileTypes: true });
    const backupEntries: Array<{ filePath: string; fileName: string }> = [];
    for (const ent of entries) {
      const filePath = path.join(fixturesDir, ent.name);
      const resolved = await realpath(filePath);
      if (!isWithinRoot(tempRoot, resolved)) {
        emit(
          failEvent(
            "validate-path-containment",
            "PathContainmentError",
            "path-outside-temp-root",
            { file: ent.name }
          )
        );
        if (ent.name === symlinkName) {
          results.push({
            name: "symlink-outside-root",
            expected: "failed",
            actual: "failed",
            reason: "path-outside-temp-root",
          });
        }
        continue;
      }
      if (ent.isSymbolicLink()) {
        emit(
          failEvent(
            "validate-symlink",
            "PathContainmentError",
            "symlink-ignored",
            { file: ent.name }
          )
        );
        continue;
      }
      if (ent.isFile() && ent.name.endsWith(".dump.age")) {
        backupEntries.push({ filePath, fileName: ent.name });
      }
    }

    const validBackups: Array<{
      fileName: string;
      filePath: string;
      metaPath: string;
      metadata: BackupMetadata;
    }> = [];

    for (const { filePath, fileName } of backupEntries) {
      if (!BACKUP_NAME_RE.test(fileName)) {
        emit(
          failEvent(
            "validate-naming",
            "FreshnessCheckError",
            "invalid-backup-name",
            { file: fileName }
          )
        );
        if (fileName === "athena-vault-bad-name.dump.age") {
          results.push({
            name: "naming-anomaly",
            expected: "failed",
            actual: "failed",
            reason: "invalid-backup-name",
          });
        }
        continue;
      }

      const metaPath = filePath + META_EXT;
      const metaExists = await stat(metaPath).then(
        () => true,
        () => false
      );
      if (!metaExists) {
        emit(
          failEvent(
            "validate-metadata-exists",
            "FreshnessCheckError",
            "missing-metadata",
            { file: fileName }
          )
        );
        if (fileName === formatBackupFileName(missingMetaDate)) {
          results.push({
            name: "missing-metadata",
            expected: "failed",
            actual: "failed",
            reason: "missing-metadata",
          });
        }
        continue;
      }

      const raw = await readFile(metaPath, "utf8");
      let metadata: BackupMetadata;
      try {
        metadata = JSON.parse(raw) as BackupMetadata;
      } catch (e) {
        emit(
          failEvent(
            "validate-metadata-parse",
            "FreshnessCheckError",
            "metadata-unparseable",
            { file: fileName }
          )
        );
        continue;
      }

      if (
        typeof metadata.createdAt !== "string" ||
        typeof metadata.bytes !== "number" ||
        typeof metadata.sha256 !== "string" ||
        typeof metadata.algorithm !== "string"
      ) {
        emit(
          failEvent(
            "validate-metadata-schema",
            "FreshnessCheckError",
            "metadata-schema-invalid",
            { file: fileName }
          )
        );
        continue;
      }

      const actualSha = await sha256File(filePath);
      const actualSize = (await stat(filePath)).size;

      if (metadata.algorithm !== EXPECTED_ALGORITHM) {
        emit(
          failEvent(
            "validate-metadata-algorithm",
            "FreshnessCheckError",
            "invalid-algorithm",
            { file: fileName, expected: EXPECTED_ALGORITHM, actual: metadata.algorithm }
          )
        );
        continue;
      }
      if (metadata.bytes !== actualSize) {
        emit(
          failEvent(
            "validate-metadata-size",
            "FreshnessCheckError",
            "size-mismatch",
            { file: fileName, expected: metadata.bytes, actual: actualSize }
          )
        );
        if (fileName === formatBackupFileName(badSizeDate)) {
          results.push({
            name: "size-mismatch",
            expected: "failed",
            actual: "failed",
            reason: "size-mismatch",
          });
        }
        continue;
      }
      if (metadata.sha256.toLowerCase() !== actualSha) {
        emit(
          failEvent(
            "validate-metadata-checksum",
            "FreshnessCheckError",
            "checksum-mismatch",
            { file: fileName, expected: metadata.sha256, actual: actualSha }
          )
        );
        if (fileName === formatBackupFileName(badChecksumDate)) {
          results.push({
            name: "checksum-mismatch",
            expected: "failed",
            actual: "failed",
            reason: "checksum-mismatch",
          });
        }
        continue;
      }

      const fileDateMatch = BACKUP_NAME_RE.exec(fileName);
      const fileTime = fileDateMatch
        ? Date.UTC(
            Number(fileDateMatch[1]),
            Number(fileDateMatch[2]) - 1,
            Number(fileDateMatch[3]),
            Number(fileDateMatch[4]),
            Number(fileDateMatch[5]),
            Number(fileDateMatch[6])
          )
        : NaN;
      if (Number.isNaN(fileTime) || new Date(metadata.createdAt).getTime() !== fileTime) {
        emit(
          failEvent(
            "validate-timestamp-consistency",
            "FreshnessCheckError",
            "timestamp-mismatch",
            { file: fileName }
          )
        );
        continue;
      }

      validBackups.push({ fileName, filePath, metaPath, metadata });
    }

    const sorted = [...validBackups].sort(
      (a, b) =>
        new Date(b.metadata.createdAt).getTime() -
        new Date(a.metadata.createdAt).getTime()
    );

    let staleDetected = false;
    for (const b of sorted) {
      const ageMs = referenceNow.getTime() - new Date(b.metadata.createdAt).getTime();
      if (ageMs > FRESHNESS_THRESHOLD_MS) {
        staleDetected = true;
        emit(
          failEvent(
            "validate-backup-age",
            "FreshnessCheckError",
            "backup-stale",
            { file: b.fileName, ageMs }
          )
        );
      }
    }
    if (staleDetected) {
      results.push({
        name: "stale-backup",
        expected: "failed",
        actual: "failed",
        reason: "backup-stale",
      });
    }

    let latest = sorted[0];
    let freshnessPassed = false;
    if (latest) {
      const latestAgeMs =
        referenceNow.getTime() - new Date(latest.metadata.createdAt).getTime();
      freshnessPassed = latestAgeMs <= FRESHNESS_THRESHOLD_MS;
      if (freshnessPassed) {
        emit(okEvent("validate-freshness", { file: latest.fileName, latestAgeMs }));
        results.push({
          name: "fresh-backup",
          expected: "passed",
          actual: "passed",
        });
      } else {
        emit(
          failEvent(
            "validate-freshness",
            "FreshnessCheckError",
            "no-fresh-backup",
            { file: latest.fileName, latestAgeMs }
          )
        );
      }
    } else {
      emit(
        failEvent(
          "validate-freshness",
          "FreshnessCheckError",
          "no-valid-backup",
          {}
        )
      );
    }

    const inputs = {
      referenceNow: referenceNow.toISOString(),
      thresholdMs: FRESHNESS_THRESHOLD_MS,
      selected: latest
        ? {
            file: latest.fileName,
            meta: path.basename(latest.metaPath),
            fullPath: latest.filePath,
          }
        : null,
      backups: sorted.map((b) => ({
        file: b.fileName,
        meta: path.basename(b.metaPath),
        fullPath: b.filePath,
        metaFullPath: b.metaPath,
        createdAt: b.metadata.createdAt,
        bytes: b.metadata.bytes,
        sha256: b.metadata.sha256,
      })),
    };
    const inputsPath = path.join(restoreDir, "inputs.json");
    await writeFile(inputsPath, JSON.stringify(inputs, null, 2));
    const allPaths = [inputsPath, ...inputs.backups.flatMap((backup) => [backup.fullPath, backup.metaFullPath])];
    let allContained = true;
    for (const p of allPaths) {
      const resolved = await realpath(p);
      if (!isWithinRoot(tempRoot, resolved)) {
        allContained = false;
        emit(
          failEvent(
            "validate-restore-contract-paths",
            "PathContainmentError",
            "restore-path-outside-temp-root",
            { path: path.basename(p) }
          )
        );
      }
    }
    if (allContained) {
      emit(
        okEvent("validate-restore-contract", {
          inputsPath,
          backupCount: inputs.backups.length,
        })
      );
    }
    results.push({
      name: "restore-contract",
      expected: "passed",
      actual: allContained ? "passed" : "failed",
      ...(allContained ? {} : { reason: "restore-path-outside-temp-root" }),
    });
  } catch {
    emit(
      failEvent(
        "run",
        "FreshnessCheckError",
        "unexpected-error"
      )
    );
    return 1;
  } finally {
    if (created) {
      try {
        await rm(tempRoot, { recursive: true, force: true });
        emit(okEvent("cleanup"));
      } catch {
        emit(
          failEvent(
            "cleanup",
            "CleanupError",
            "cleanup-failed"
          )
        );
      }
    }
  }
  const expectedResultNames = [
    "symlink-outside-root",
    "naming-anomaly",
    "missing-metadata",
    "size-mismatch",
    "checksum-mismatch",
    "stale-backup",
    "fresh-backup",
    "restore-contract",
  ];
  const resultNames = new Set(results.map((result) => result.name));
  const missingResults = expectedResultNames.filter((name) => !resultNames.has(name));
  const allMatched = missingResults.length === 0 && results.every((r) => r.expected === r.actual);
  emit({
    event: "backup-freshness-check",
    operation: "summary",
    status: allMatched ? "passed" : "failed",
    errorClass: allMatched ? "None" : "FreshnessCheckError",
    failureCode: allMatched ? "OK" : "EXPECTED_CHECK_MISSING",
    referenceNow: referenceNow.toISOString(),
    results,
  });
  return allMatched ? 0 : 1;

}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    console.error(JSON.stringify({
      event: "backup-freshness-check",
      operation: "run",
      status: "failed",
      errorClass: "FreshnessCheckError",
      failureCode: "UNEXPECTED_ERROR",
    }));
    process.exit(1);
  });
