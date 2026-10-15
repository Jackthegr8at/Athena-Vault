import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateUpdates, unsafePath, unsafeContent, run } from './public-pre-push.mjs';
const remote = 'https://github.com/Jackthegr8at/Athena-Vault.git';
const oid = 'a'.repeat(40);
const update = `refs/heads/main ${oid} refs/heads/main ${'0'.repeat(40)}\n`;
test('approved destination and branches/tags only', () => {
  assert.deepEqual(validateUpdates(remote, update), [oid]);
  assert.throws(() => validateUpdates('https://example.com/other.git', update));
  assert.throws(() => validateUpdates(remote, update.replace('refs/heads/main a', 'refs/heads/main bad a')));
  assert.throws(() => validateUpdates(remote, update.replace(oid, '0'.repeat(40))));
  assert.throws(() => validateUpdates(remote, update.replace(/refs\/heads\/main(?= 0)/, 'refs/notes/test')));
});
test('private/generated paths, symlinks and gitlinks rejected', () => {
  for (const name of ['.env.production', 'plan/internal.md', 'mockup/art.png', 'backups/data.dump', 'node_modules/pkg/index.js', 'data.sqlite', 'secret.pem']) assert.ok(unsafePath(name, '100644'));
  for (const name of ['.env.example', '.env.docker.example', 'apps/web/app/page.tsx']) assert.equal(unsafePath(name, '100644'), false);
  assert.ok(unsafePath('safe', '120000'));
  assert.ok(unsafePath('safe', '160000'));
});
test('private markers blocked without real records in fixtures', () => {
  assert.ok(unsafeContent(['192', '168', '1', '10'].join('.')));
  assert.ok(unsafeContent(['-----BEGIN ', 'PRIVATE KEY-----'].join('')));
  assert.equal(unsafeContent('Synthetic example, no financial records'), false);
});
test('missing scanner fails closed', () => {
  assert.throws(() => run(remote, '', process.cwd(), 'athena-intentionally-missing-scanner'));
});
test('deleted private file in ancestor still blocks history', { skip: !process.env.ATHENA_GITLEAKS_BIN }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'athena-hook-history-'));
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString().trim();
  git(['init', '--quiet']);
  git(['config', 'user.name', 'Synthetic Test']);
  git(['config', 'user.email', 'test@example.invalid']);
  writeFileSync(path.join(root, '.env.local'), 'SYNTHETIC_ONLY=true\n');
  git(['add', '.env.local']);
  git(['commit', '--quiet', '-m', 'Synthetic blocked path']);
  git(['rm', '.env.local']);
  writeFileSync(path.join(root, 'README.md'), 'Synthetic safe file\n');
  git(['add', 'README.md']);
  git(['commit', '--quiet', '-m', 'Remove synthetic path']);
  const tip = git(['rev-parse', 'HEAD']);
  assert.throws(() => run(remote, update.replace(oid, tip), root), /forbidden-history-path/);
  // Synthetic test repository is retained in the OS temp directory; no user data is touched.
});
