import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const eslintRequire = createRequire(webRequire.resolve('eslint/package.json'));
const minimatchRequire = createRequire(eslintRequire.resolve('minimatch/package.json'));
const expand = minimatchRequire('brace-expansion');
const parseAddresses = webRequire('nodemailer/lib/addressparser');
const nodemailer = webRequire('nodemailer');

test('pins patched Nodemailer and the compatible legacy brace-expansion API', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../apps/web/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies.nodemailer, '10.0.9');
  assert.equal(minimatchRequire('brace-expansion/package.json').version, '1.1.21');
  assert.deepEqual(expand('file-{a,b}-{1..2}'), ['file-a-1', 'file-a-2', 'file-b-1', 'file-b-2']);
});

test('legacy expansion bounds deep nesting, chained groups and repeated rewrites', () => {
  const patterns = ['{'.repeat(4000) + 'a,b' + '}'.repeat(4000), '{a}'.repeat(4000), '{a}' + '}'.repeat(4000) + ',z}'];
  for (const pattern of patterns) {
    const result = expand(pattern, { max: 10, maxLength: 1000, maxDepth: 16, maxRewrites: 8 });
    assert.ok(result.length <= 10);
    assert.ok(result.reduce((sum, item) => sum + item.length, 0) <= 1000);
  }
});

test('quoted local-part comments do not append a second domain to envelope addresses', () => {
  const parsed = parseAddresses('"user"@example.invalid(x)evil.invalid');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].address, 'user@example.invalid');
});

test('notification message generation remains compatible without SMTP or network access', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await transport.sendMail({
    from: 'sender@example.invalid', to: 'recipient@example.invalid',
    subject: 'Synthetic security regression', text: 'Synthetic notification only.',
  });
  assert.deepEqual(info.envelope.to, ['recipient@example.invalid']);
  assert.match(info.message.toString(), /Synthetic security regression/);
});
