import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyPublicationPath } from './publication-path-guard.mjs';

const allowed = new Set([
  'https://github.com/Jackthegr8at/Athena-Vault.git',
  'git@github.com:Jackthegr8at/Athena-Vault.git',
  'ssh://git@github.com/Jackthegr8at/Athena-Vault.git',
]);
const zero = /^0+$/;
export function validateUpdates(destination, input) {
  if (!allowed.has(destination)) throw new Error('unapproved-destination');
  const tips = [];
  for (const line of input.trim().split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !/^[0-9a-f]{40}$/.test(fields[1]) || !/^[0-9a-f]{40}$/.test(fields[3])) {
      throw new Error('invalid-push-input');
    }
    if (zero.test(fields[1])) throw new Error('ref-deletion-not-approved');
    if (!/^refs\/(heads|tags)\//.test(fields[2])) throw new Error('unapproved-ref');
    tips.push(fields[1]);
  }
  return [...new Set(tips)];
}
export function unsafePath(name, mode) {
  return mode === '120000' || mode === '160000' || classifyPublicationPath(name) !== null ||
    /(^|\/)(?:plan|tools|\.git|\.ssh|\.aws|\.publication-candidate)(\/|$)/i.test(name) ||
    /(^|\/)\.env(?:\.|$)/i.test(name) && !/(^|\/)\.env(?:\.docker)?\.example$/.test(name) ||
    /\.(?:age|pfx|p12|pem|key|sqlite|sqlite3|db|tar|tgz|zip)$/i.test(name);
}
export function unsafeContent(text) {
  return /athena-vault\.home\.arpa|athena\.kryptxt\.ca|\.home\.arpa\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.28\.28\.\d{1,3}\b|\bathena-admin\b|C:[\\/]Users[\\/]Jack\b|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/i.test(text);
}
export function run(destination, input, root = process.cwd(), scanner = process.env.ATHENA_GITLEAKS_BIN || 'gitleaks') {
  const tips = validateUpdates(destination, input);
  const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 128 * 1024 * 1024 });
  // Require the scanner even for an empty push; never silently skip tooling.
  execFileSync(scanner, ['version'], { stdio: 'pipe' });
  const inspected = new Set();
  for (const tip of tips) {
    // Scan complete reachable history, not just differences from remote refs.
    const commits = git(['rev-list', `${tip}^{commit}`]).toString().trim().split('\n');
    for (const commit of commits) {
      for (const entry of git(['ls-tree', '-r', '-z', commit]).toString().split('\0').filter(Boolean)) {
        const match = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
        if (!match) throw new Error('invalid-tree-entry');
        const [, mode, type, oid, name] = match;
        if (unsafePath(name, mode) || type !== 'blob') throw new Error('forbidden-history-path');
        if (!inspected.has(oid)) {
          if (unsafeContent(git(['cat-file', 'blob', oid]).toString('utf8'))) throw new Error('private-history-content');
          inspected.add(oid);
        }
      }
      if (unsafeContent(git(['cat-file', 'commit', commit]).toString('utf8'))) throw new Error('private-commit-metadata');
    }
    execFileSync(scanner, ['detect', '--source', root, '--log-opts', tip, '--redact', '--no-banner'], { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
  }
  return tips.length;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = run(process.argv[3], readFileSync(0, 'utf8'));
    console.log(`public-pre-push=pass refs=${count}`);
  } catch {
    // Do not echo scanner output, blob contents, credentials or remote URLs.
    console.error('public-pre-push=blocked: unapproved destination/ref, unsafe history, or missing/failed Git/Gitleaks. Resolve checks; do not bypass the hook.');
    process.exitCode = 1;
  }
}
