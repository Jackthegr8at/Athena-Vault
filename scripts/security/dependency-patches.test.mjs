import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const configRequire = createRequire(webRequire.resolve('eslint-config-next'));
const pluginEntry = configRequire.resolve('@next/eslint-plugin-next');
const pluginRequire = createRequire(pluginEntry);
const { getRootDirs } = pluginRequire('./utils/get-root-dirs');
const plugin = configRequire('@next/eslint-plugin-next');
const { ESLint } = webRequire('eslint');
const normalize = value => value.replaceAll('\\', '/').replace(/\/$/, '');
const sorted = values => values.map(normalize).sort();

function fixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'athena-next-glob-'));
  t.after(() => {
    assert.equal(path.resolve(path.dirname(base)), path.resolve(os.tmpdir()));
    rmSync(base, { recursive: true, force: true });
  });
  const apps = path.join(base, 'apps');
  const one = path.join(apps, 'site one');
  const two = path.join(apps, 'site-two');
  mkdirSync(path.join(one, 'app', 'about'), { recursive: true });
  mkdirSync(path.join(two, 'pages'), { recursive: true });
  mkdirSync(path.join(apps, '.hidden'), { recursive: true });
  writeFileSync(path.join(one, 'app', 'about', 'page.jsx'), 'export default function About() { return null; }');
  writeFileSync(path.join(two, 'pages', 'contact.jsx'), 'export default function Contact() { return null; }');
  writeFileSync(path.join(apps, 'not-a-directory.txt'), 'synthetic');
  return { base, apps: normalize(apps), one, two };
}

test('removes vulnerable glob packages from the lockfile rather than suppressing audit findings', () => {
  const lock = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(lock, /^\s+['"]?(?:braces|micromatch|fast-glob)@/m);
  assert.doesNotMatch(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'), /"braces@/);
  const replacement = pluginRequire('fast-glob/package.json');
  assert.equal(replacement.name, 'tinyglobby');
  assert.equal(replacement.version, '0.2.17');
  assert.equal(typeof pluginRequire('fast-glob').globSync, 'function');
  const docker = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.ok(!docker.includes('COPY patches/ ./patches/') || existsSync(path.join(root, 'patches')), 'Docker must not require a retired patch directory');
  assert.ok(docker.indexOf('COPY patches/ ./patches/') >= 0 && docker.indexOf('COPY patches/ ./patches/') < docker.indexOf('pnpm install --frozen-lockfile'), 'Docker must install with the lint compatibility patch available');
});

test('Next lint root discovery preserves defaults, directory-only globs and missing matches', t => {
  const { base, apps, one, two } = fixture(t);
  assert.deepEqual(getRootDirs({ cwd: base, settings: {} }), [base]);
  assert.deepEqual(sorted(getRootDirs({ cwd: base, settings: { next: { rootDir: apps + '/*' } } })), sorted([one, two]));
  assert.deepEqual(getRootDirs({ cwd: base, settings: { next: { rootDir: apps + '/missing-*' } } }), []);
});

test('Next lint root discovery supports arrays, brace patterns, spaces and Windows separators', t => {
  const { base, apps, one, two } = fixture(t);
  assert.deepEqual(sorted(getRootDirs({ cwd: base, settings: { next: { rootDir: [normalize(one), normalize(two), 42] } } })), sorted([one, two]));
  assert.deepEqual(sorted(getRootDirs({ cwd: base, settings: { next: { rootDir: apps + '/{site one,site-two}' } } })), sorted([one, two]));
  assert.deepEqual(sorted(getRootDirs({ cwd: base, settings: { next: { rootDir: (apps + '/*').replaceAll('/', '\\') } } })), sorted([one, two]));
});

test('Next lint root discovery preserves relative root directory results', t => {
  const { base } = fixture(t);
  const previousCwd = process.cwd();
  try {
    process.chdir(base);
    assert.deepEqual(sorted(getRootDirs({ cwd: base, settings: { next: { rootDir: 'apps/*' } } })), ['apps/site one', 'apps/site-two']);
  } finally {
    process.chdir(previousCwd);
  }
});

test('normalizes separators before checking absolute paths on POSIX and Windows', () => {
  const source = readFileSync(pluginRequire.resolve('./utils/get-root-dirs'), 'utf8');
  for (const platformPath of [path.posix, path.win32]) {
    const exports = {};
    const calls = [];
    vm.runInNewContext(source, { exports, require: name => name === 'path' ? platformPath : { globSync: (pattern, options) => { calls.push({ pattern, ...options }); return []; } } });
    for (const pattern of ['/synthetic/apps/*', 'apps/*', '\\synthetic\\apps\\*']) {
      exports.getRootDirs({ cwd: '/', settings: { next: { rootDir: pattern } } });
    }
    assert.deepEqual(calls.map(call => call.absolute), [true, false, true]);
    assert.ok(calls.every(call => call.onlyDirectories === true && call.expandDirectories === false));
  }
});

test('Next internal-navigation lint rule still reports invalid links with globbed project roots', async t => {
  const { base, apps } = fixture(t);
  const eslint = new ESLint({
    cwd: base,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.jsx'],
      plugins: { '@next/next': plugin },
      settings: { next: { rootDir: apps + '/*' } },
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: { '@next/next/no-html-link-for-pages': 'error' },
    }],
  });
  const [result] = await eslint.lintText('export default function Probe() { return <a href="/contact">Contact</a>; }', { filePath: path.join(base, 'probe.jsx') });
  assert.ok(result.messages.some(message => message.ruleId === '@next/next/no-html-link-for-pages'));
  assert.ok(!result.messages.some(message => message.fatal));
});
