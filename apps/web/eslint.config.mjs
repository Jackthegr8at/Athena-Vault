import js from '@eslint/js';
import nextConfig from 'eslint-config-next';
import nextTypescript from 'eslint-config-next/typescript';

const reactCompilerRuleNames = [
  'react-hooks/refs',
  'react-hooks/set-state-in-effect',
  'react-hooks/static-components',
];
const reactHooksPlugin = nextConfig
  .map((config) => config.plugins?.['react-hooks'])
  .find(Boolean);
const reactCompilerWarnings = Object.fromEntries(
  reactCompilerRuleNames
    .filter((ruleName) => ruleName.slice('react-hooks/'.length) in (reactHooksPlugin?.rules ?? {}))
    .map((ruleName) => [ruleName, 'warn']),
);

const eslintConfig = [
  js.configs.recommended,
  ...nextConfig,
  ...nextTypescript,
  {
    rules: {
      // eslint-config-next 16.3 still publishes the core-web-vitals delta as
      // a legacy eslintrc object. Apply its two rule overrides directly so
      // the rest of the configuration remains valid ESLint 9 flat config.
      '@next/next/no-html-link-for-pages': 'error',
      '@next/next/no-sync-scripts': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Next 16 surfaces these React compiler migration checks. Keep them
      // visible without turning the dependency alignment into a broad rewrite.
      ...reactCompilerWarnings,
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-*/**',
      'dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'e2e/.auth/**',
      'next-env.d.ts',
    ],
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        test: 'readonly',
        vi: 'readonly',
      },
    },
  },
];

export default eslintConfig;
