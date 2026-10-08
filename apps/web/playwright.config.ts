import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.ATHENA_E2E_BASE_URL ?? 'http://localhost:3000';
const e2eEnabled = process.env.ATHENA_E2E_ENABLED === 'true';
const e2eSuite = process.env.ATHENA_E2E_SUITE;
const e2eSuites: Record<string, true> = {
  authentication: true,
  authorization: true,
  demo: true,
  passkeys: true,
  'request-security': true,
  workbooks: true,
  'financial-invariants': true,
  'a11y-zoom': true,
};
const disposableRun = process.env.ATHENA_E2E_DISPOSABLE === 'true';
const webVitalsRun = process.env.ATHENA_WEB_VITALS_RUN === 'true';
const localHosts: Record<string, true> = {
  localhost: true,
  '127.0.0.1': true,
  '[::1]': true,
};
let isLocalBaseURL = false;
try {
  const parsedBaseURL = new URL(baseURL);
  isLocalBaseURL =
    (parsedBaseURL.protocol === 'http:' || parsedBaseURL.protocol === 'https:') &&
    localHosts[parsedBaseURL.hostname] === true;
} catch {
  isLocalBaseURL = false;
}

if (e2eEnabled && (!disposableRun || !isLocalBaseURL)) {
  throw new Error(
    'Browser E2E requires ATHENA_E2E_DISPOSABLE=true and a local ATHENA_E2E_BASE_URL.',
  );
}
if (e2eEnabled && (!e2eSuite || e2eSuites[e2eSuite] !== true)) {
  throw new Error(
    'Browser E2E requires ATHENA_E2E_SUITE to select one disposable spec.',
  );
}
if (webVitalsRun && !isLocalBaseURL) {
  throw new Error('ATHENA_WEB_VITALS_RUN=true requires a local ATHENA_E2E_BASE_URL.');
}

export default defineConfig({
  testDir: 'e2e',
  testMatch: e2eSuite ? [`**/${e2eSuite}.spec.ts`] : undefined,
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  workers: e2eEnabled ? 1 : undefined,
  fullyParallel: false,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: webVitalsRun
    ? {
        command: 'next dev',
        url: baseURL,
        env: {
          NEXT_PUBLIC_ATHENA_LOCAL_WEB_VITALS: 'true',
        },
        timeout: 120_000,
        reuseExistingServer: false,
      }
    : undefined,
});
