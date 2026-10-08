import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { findForbiddenPublicationPaths } from "./publication-path-guard.mjs";

const checks = [
  ["private-host", /athena-vault\.home\.arpa|athena\.kryptxt\.ca|\.home\.arpa\b/i],
  ["private-network", /\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.28\.28\.\d{1,3}\b/],
  ["operator-identity", /\bathena-admin\b|C:[\\/]Users[\\/]Jack\b/i],
  ["workbook-identity", /\bK\x4fHO\b|Fond\x20annuel|D\xE9pense\x20annuelles/i],
  ["private-key", /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/],
];

function categories(content) {
  const found = new Set();
  for (const [category, pattern] of checks) if (pattern.test(content)) found.add(category);
  const assignment = /^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)[ \t]*=[ \t]*["']?([A-Za-z0-9_+/=-]{32,})["']?[ \t]*$/gm;
  for (const hit of content.matchAll(assignment)) {
    if (!/^(?:change-me|replace-with|example|test|dummy|placeholder|replace_me)/i.test(hit[1])) found.add("potential-credential");
  }
  return found;
}

function excludedLinks(content, relativePath) {
  if ([".gitignore", ".dockerignore", "scripts/security/publication-path-guard.test.mjs"].includes(relativePath)) return false;
  return /\]\((?:\.\.[\\/])*(?:plan|mockup|workbook-inspection|drizzle-archive)[\\/]|new URL\(["'](?:\.\.[\\/])*(?:plan|mockup|workbook-inspection|drizzle-archive)[\\/]/i.test(content);
}

function git(root, args, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer });
}

async function treeFiles(root) {
  const pending = [""];
  const files = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      if (directory === "" && entry.name === ".git") continue;
      const relative = path.join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) pending.push(relative);
      else files.push({ path: relative, isSymlink: entry.isSymbolicLink() });
    }
  }
  return files;
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--root" || !path.isAbsolute(process.argv[3])) {
    console.error("usage: node scripts/security/publication-content-guard.mjs --root <absolute-candidate-directory>");
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(process.argv[3]);
  const files = await treeFiles(root);
  const findings = new Set();
  for (const violation of findForbiddenPublicationPaths(files)) findings.add(`${violation.reason}: ${violation.path}`);
  for (const file of files) {
    if (file.isSymlink) continue;
    const content = (await readFile(path.join(root, file.path))).toString("utf8");
    for (const category of categories(content)) findings.add(`${category}: ${file.path}`);
    if (excludedLinks(content, file.path)) findings.add(`excluded-path-link: ${file.path}`);
  }
  const history = git(root, ["rev-list", "--objects", "--all"]).toString("utf8").trim();
  if (history) {
    for (const line of history.split("\n")) {
      const separator = line.indexOf(" ");
      const oid = separator < 0 ? line : line.slice(0, separator);
      const objectPath = separator < 0 ? "<unmapped>" : line.slice(separator + 1);
      if (git(root, ["cat-file", "-t", oid]).toString("utf8").trim() !== "blob") continue;
      const blob = git(root, ["cat-file", "blob", oid]).toString("utf8");
      for (const category of categories(blob)) {
        findings.add(`history-${category}: ${objectPath}`);
      }
      if (excludedLinks(blob, objectPath)) findings.add(`history-excluded-path-link: ${objectPath}`);
      for (const violation of findForbiddenPublicationPaths([objectPath])) {
        findings.add(`history-${violation.reason}: ${objectPath}`);
      }
    }
  }
  for (const finding of [...findings].sort()) console.error(finding);
  console.log(`publication-content-guard=${findings.size === 0 ? "pass" : "fail"} findings=${findings.size} files=${files.length}`);
  if (findings.size > 0) process.exitCode = 1;
}

main().catch(() => {
  console.error("publication-content-guard=error");
  process.exitCode = 2;
});
