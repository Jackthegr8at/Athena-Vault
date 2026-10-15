import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const store = path.join(root, 'node_modules/.pnpm');
const entry = readdirSync(store).find(name => name.startsWith('braces@3.0.3_patch_hash=') && existsSync(path.join(store, name, 'node_modules/braces/lib/depth-guard.js')));
assert.ok(entry, 'security-patched braces must be installed');
const braces = require(path.join(store, entry, 'node_modules/braces'));

test('Docker installs dependencies only after copying the required pnpm patches', () => {
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const copy = dockerfile.indexOf('COPY patches/ ./patches/');
  const install = dockerfile.indexOf('pnpm install --frozen-lockfile');
  assert.ok(copy >= 0 && install > copy, 'Docker dependency installation must include security patches');
});
test('normal brace compilation and expansion remain compatible', () => {
  assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);
  assert.equal(braces.compile('{a,b}'), '(a|b)');
});
test('deep braces and parentheses are rejected before recursive walkers', () => {
  for (const [open, close] of [['{','}'], ['(',')']]) {
    const input = open.repeat(512) + 'a,b' + close.repeat(512);
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      assert.throws(() => braces[method](input), /nesting exceeds safe depth/);
    }
  }
});
test('caller-provided deep or cyclic ASTs cannot bypass the guard', () => {
  let ast = { type: 'text', value: 'a' };
  for (let i = 0; i < 512; i++) ast = { type: 'root', nodes: [ast] };
  for (const method of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method](ast), /nesting exceeds safe depth/);
  }
  const cycle = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  assert.throws(() => braces.stringify(cycle), /nesting exceeds safe depth/);
});
