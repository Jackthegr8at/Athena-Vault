// Local-only notice collection; does not install dependencies or contact a network.
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const rootArg = args.indexOf("--root");
if ((rootArg >= 0 && (!args[rootArg + 1] || args[rootArg + 1].startsWith("--"))) ||
    args.some((arg, index) => arg !== "--check" && arg !== "--root" && !(rootArg >= 0 && index === rootArg + 1))) {
  throw new Error("usage: node scripts/generate-third-party-notices.mjs [--root <workspace>] [--check]");
}
const root = await realpath(path.resolve(rootArg >= 0 ? args[rootArg + 1] : "."));
const lock = (await readFile(path.join(root, "pnpm-lock.yaml"), "utf8")).replaceAll("\r\n", "\n");
const section = lock.split("\npackages:\n")[1]?.split("\nsnapshots:")[0];
if (!section) throw new Error("unsupported-lockfile-package-section");
const packageIds = [...section.matchAll(/^  (?:'([^']+)'|(\S[^\n]*)):[ \t]*$/gm)]
  .map((match) => match[1] || match[2]).sort();
if (!packageIds.length || new Set(packageIds).size !== packageIds.length) throw new Error("invalid-package-inventory");
const wanted = new Set(packageIds);
const installed = new Map();
const store = path.join(root, "node_modules", ".pnpm");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

for (const entry of (await readdir(store, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
  if (!entry.isDirectory()) continue;
  const modules = path.join(store, entry.name, "node_modules");
  const names = await readdir(modules, { withFileTypes: true }).catch(() => []);
  for (const item of names) {
    const candidates = item.name.startsWith("@")
      ? (await readdir(path.join(modules, item.name))).map((name) => item.name + "/" + name)
      : [item.name];
    for (const name of candidates) {
      const directory = path.join(modules, name);
      const metadata = await readFile(path.join(directory, "package.json"), "utf8").then(JSON.parse).catch(() => null);
      if (!metadata) continue;
      const id = metadata.name + "@" + metadata.version;
      if (!wanted.has(id) || installed.has(id)) continue;
      const physical = await realpath(directory);
      if (!physical.startsWith(root + path.sep)) throw new Error("dependency-outside-workspace");
      installed.set(id, { directory: physical, metadata });
    }
  }
}

async function noticeDocuments(directory, relative = "") {
  const documents = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
    if (entry.isSymbolicLink() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const filename = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      documents.push(...await noticeDocuments(directory, filename));
    } else if (entry.isFile() && (/^(licen[cs]e|copying|notice|third[-_]party[-_]notices?)([._-]|$)/i.test(entry.name) || /^readme(?:\.md|\.txt)?$/i.test(entry.name))) {
      const info = await stat(path.join(directory, filename));
      if (info.size > 2 * 1024 * 1024) throw new Error("oversized-license-document");
      let text = (await readFile(path.join(directory, filename), "utf8")).replaceAll("\r\n", "\n").trimEnd();
      if (text.includes("\0")) throw new Error("nontext-license-document");
      if (/^readme(?:\.md|\.txt)?$/i.test(entry.name)) {
        // Some exact npm archives contain their full notice only in README.
        // A license name/link alone is not a copyright or permission notice.
        const heading = /^#{1,6}[ \t]+licen[cs]e\b[^\n]*\n/im.exec(text);
        if (!heading) continue;
        text = text.slice(heading.index);
        if (!/(?:permission[\s\S]{0,140}hereby granted|redistribution and use in source and binary forms)/i.test(text) ||
            !/(?:AS IS|WITHOUT WARRANTY|DISCLAIMS ALL WARRANTIES)/i.test(text)) continue;
      }
      if (text) documents.push({ path: filename.replaceAll("\\", "/"), text });
    }
  }
  return documents;
}

const groups = new Map();
const packages = [];
const supplements = JSON.parse(await readFile(path.join(root, "third-party", "supplemental-notices.json"), "utf8"));
for (const id of packageIds) {
  const match = id.match(/^(.+)@([^@]+)$/);
  if (!match) throw new Error("unsupported-package-id");
  const [, name, version] = match;
  const record = installed.get(id);
  const item = { name, version, installed: Boolean(record), license: null, notices: [] };
  if (record) {
    const declared = record.metadata.license;
    item.license = typeof declared === "string" ? declared : declared?.type || null;
    const docs = await noticeDocuments(record.directory);
    const supplement = supplements[id];
    if (supplement && !docs.length) {
      if (supplement.license !== item.license || !/^upstream\/[a-zA-Z0-9._-]+$/.test(supplement.file)) throw new Error("invalid-supplemental-notice");
      docs.push({ path: "upstream:" + supplement.file, text: (await readFile(path.join(root, "third-party", supplement.file), "utf8")).replaceAll("\r\n", "\n").trimEnd() });
    }
    for (const document of docs) {
      const digest = createHash("sha256").update(document.text).digest("hex");
      item.notices.push({ file: document.path, sha256: digest });
      if (!groups.has(digest)) groups.set(digest, { text: document.text, sources: [] });
      groups.get(digest).sources.push(id + " / " + document.path);
    }
  }
  packages.push(item);
}

const inventory = {
  formatVersion: 1,
  lockfileSha256: createHash("sha256").update(lock).digest("hex"),
  scope: "Exact lockfile packages; only locally installed matching versions have harvested notices. Missing platforms and unknown/missing licenses require artifact review.",
  packages,
};
const summary = {
  locked: packages.length,
  installed: packages.filter((item) => item.installed).length,
  missingInstalled: packages.filter((item) => !item.installed).length,
  undeclaredLicense: packages.filter((item) => item.installed && !item.license).map((item) => item.name + "@" + item.version),
  missingNotice: packages.filter((item) => item.installed && !item.notices.length).map((item) => item.name + "@" + item.version),
};
const banner = [
  "Athena Vault — collected third-party npm license and notice texts",
  "Generated from matching installed packages and pnpm-lock.yaml.",
  "This collection preserves upstream text, including nested vendor/compiled notices.",
  "It is not a compatibility opinion or a grant for packages with missing/unknown terms.",
  "See npm-inventory.json for exact versions, missing packages, and document hashes.",
  "",
].join("\n");
const notices = banner + [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([digest, group]) =>
  "\n" + "=".repeat(72) + "\nDocument SHA-256: " + digest + "\nSources:\n" +
  group.sources.sort().map((source) => "  " + source).join("\n") + "\n\n" + group.text + "\n"
).join("");
const outputs = new Map([
  ["npm-inventory.json", JSON.stringify(inventory, null, 2) + "\n"],
  ["npm-notices.txt", notices],
]);
const outputDirectory = path.join(root, "third-party");
if (!check) await mkdir(outputDirectory, { recursive: true });
for (const [filename, content] of outputs) {
  const target = path.join(outputDirectory, filename);
  if (check) {
    const existing = await readFile(target, "utf8");
    if (existing.replaceAll("\r\n", "\n") !== content) throw new Error("stale-third-party-notices:" + filename);
  } else {
    await writeFile(target, content);
  }
}
console.log(JSON.stringify({ mode: check ? "check" : "generate", ...summary }));
