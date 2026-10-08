import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Local-only Playwright request/browser coverage for proxy and origin security.
 *
 * Required env gating:
 * - ATHENA_E2E_ENABLED=true, ATHENA_E2E_DISPOSABLE=true, and ATHENA_E2E_SUITE=request-security.
 * - ATHENA_E2E_BASE_URL (default http://localhost:3000) for the non-proxied next dev target.
 * - ATHENA_E2E_AUTH_TRUSTED_PROXY_IPS=none for the forged-forwarded-header test.
 * - ATHENA_E2E_BETTER_AUTH_URL (defaults to ATHENA_E2E_BASE_URL) for same-origin allowance.
 * - ATHENA_E2E_CADDY_ENABLED=true to run Caddy/proxy tests.
 * - ATHENA_E2E_CADDY_HTTPS_URL (default https://localhost:8443).
 * - ATHENA_E2E_CADDY_HTTP_URL (default http://localhost:8080).
 * - ATHENA_E2E_CADDY_DIRECT_URL to the backend (e.g. http://localhost:3000 configured
 *   with ATHENA_AUTH_TRUSTED_PROXY_IPS=<caddy ip>) for the forged marker test.
 * - ATHENA_E2E_CADDY_TRUSTED_PROXY_IP (default 172.30.0.2) for the expected Caddy internal IP.
 * - ATHENA_E2E_CADDY_INTERNAL_CERT=true to set ignoreHTTPSErrors for the local Caddy tls internal cert.
 * - ATHENA_E2E_TEST_EMAIL and ATHENA_E2E_TEST_PASSWORD for the real sign-in smoke.
 *
 * Credentials, tokens, and cookie values must be passed by the local runner
 * and are never logged or committed.
 */

const isE2EEnabled = process.env.ATHENA_E2E_ENABLED === "true";

const baseUrl = (process.env.ATHENA_E2E_BASE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const isNoneProxy = process.env.ATHENA_E2E_AUTH_TRUSTED_PROXY_IPS === "none";
const allowedOrigin = (
  process.env.ATHENA_E2E_BETTER_AUTH_URL ?? baseUrl
).replace(/\/+$/, "");

const isCaddyEnabled =
  isE2EEnabled && process.env.ATHENA_E2E_CADDY_ENABLED === "true";
const caddyHttpUrl = (
  process.env.ATHENA_E2E_CADDY_HTTP_URL ?? "http://localhost:8080"
).replace(/\/+$/, "");
const caddyHttpsUrl = (
  process.env.ATHENA_E2E_CADDY_HTTPS_URL ??
  "https://localhost:8443"
).replace(/\/+$/, "");
const caddyDirectUrl = process.env.ATHENA_E2E_CADDY_DIRECT_URL?.replace(
  /\/+$/,
  "",
);
const caddyTrustedProxyIp =
  process.env.ATHENA_E2E_CADDY_TRUSTED_PROXY_IP ?? "172.30.0.2";
const isCaddyInternalCert =
  process.env.ATHENA_E2E_CADDY_INTERNAL_CERT === "true";
const localHosts: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
};

function isLocalCaddyUrl(
  value: string,
  expectedProtocol: "http:" | "https:" | "any",
): boolean {
  try {
    const url = new URL(value);
    const protocolAllowed =
      expectedProtocol === "any"
        ? url.protocol === "http:" || url.protocol === "https:"
        : url.protocol === expectedProtocol;
    return protocolAllowed && localHosts[url.hostname] === true;
  } catch {
    return false;
  }
}

const isLocalCaddyHttpTarget = isLocalCaddyUrl(caddyHttpUrl, "http:");
const isLocalCaddyHttpsTarget = isLocalCaddyUrl(caddyHttpsUrl, "https:");
const isLocalCaddyDirectTarget =
  !caddyDirectUrl || isLocalCaddyUrl(caddyDirectUrl, "any");
const hasLocalCaddyTargets =
  isLocalCaddyHttpTarget &&
  isLocalCaddyHttpsTarget &&
  isLocalCaddyDirectTarget;
const ignoreCaddyCertificate =
  isCaddyInternalCert && isLocalCaddyHttpsTarget;
if (isE2EEnabled && isCaddyEnabled && !hasLocalCaddyTargets) {
  throw new Error(
    "Caddy E2E requires local HTTP/HTTPS/direct targets; remote targets are refused.",
  );
}

const testEmail = process.env.ATHENA_E2E_TEST_EMAIL;
const testPassword = process.env.ATHENA_E2E_TEST_PASSWORD;

function invalidCredentials() {
  return {
    email: `missing-${randomUUID()}@example.test`,
    password: `${randomUUID()}!`,
    callbackURL: "/",
  };
}

const e2eTitle = isE2EEnabled
  ? "request security (local disposable E2E)"
  : "request security (skipped: ATHENA_E2E_ENABLED is not 'true')";

const describeFn = isE2EEnabled ? test.describe : test.describe.skip;

describeFn(e2eTitle, () => {
  test.describe("non-proxied next dev", () => {
    test("forged X-Forwarded-For is rejected under 'none' policy", async ({
      request,
    }) => {
      test.skip(
        !isNoneProxy,
        "ATHENA_E2E_AUTH_TRUSTED_PROXY_IPS is not 'none'; skipping none-policy test",
      );

      const response = await request.get(`${baseUrl}/api/auth/get-session`, {
        headers: {
          "X-Forwarded-For": "1.2.3.4",
        },
      });

      expect(response.status()).toBe(403);
    });

    test("cross-origin state-changing request is rejected", async ({ request }) => {
      const response = await request.post(`${baseUrl}/api/auth/sign-in/email`, {
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          Referer: "https://evil.example/login",
        },
        data: JSON.stringify(invalidCredentials()),
      });

      expect(response.status()).toBe(403);
    });

    test("same-origin state-changing request is allowed", async ({ request }) => {
      const response = await request.post(`${baseUrl}/api/auth/sign-in/email`, {
        headers: {
          "Content-Type": "application/json",
          Origin: allowedOrigin,
          Referer: `${allowedOrigin}/login`,
        },
        data: JSON.stringify(invalidCredentials()),
      });

      expect(response.status()).not.toBe(405);
    });
  });

  const caddyTitle = isCaddyEnabled
    ? "Caddy disposable proxy"
    : "Caddy disposable proxy (skipped: ATHENA_E2E_CADDY_ENABLED is not 'true')";

  const caddyDescribe = isCaddyEnabled ? test.describe : test.describe.skip;
  caddyDescribe(caddyTitle, () => {
    // Certificate bypass is limited to the explicitly named local Caddy host.
    // Any other target keeps normal TLS verification even if the flag is set.
    test.use({ ignoreHTTPSErrors: ignoreCaddyCertificate });

    test("HTTP to HTTPS redirect on the published Caddy port", async ({
      request,
    }) => {
      const response = await request.get(caddyHttpUrl, {
        maxRedirects: 0,
      });

      expect([301, 308]).toContain(response.status());
      const location = response.headers()["location"];
      expect(location).toBe(`${caddyHttpsUrl}/`);
    });

    test("Caddy allowlist marker is accepted", async ({ request }) => {
      const response = await request.get(`${caddyHttpsUrl}/api/auth/get-session`);

      expect(response.status()).toBe(200);
    });

    test("forged X-Athena-Proxy-Source marker is rejected", async ({
      request,
    }) => {
      test.skip(
        !caddyDirectUrl,
        "ATHENA_E2E_CADDY_DIRECT_URL not set; direct backend unreachable for forged marker test",
      );

      const response = await request.get(`${caddyDirectUrl}/api/auth/get-session`, {
        headers: {
          "X-Athena-Proxy-Source": "1.2.3.4",
          "X-Forwarded-For": `1.2.3.4, ${caddyTrustedProxyIp}`,
        },
      });

      expect(response.status()).toBe(403);
    });

    test("real sign-in through Caddy returns a secure session cookie", async ({
      request,
    }) => {
      test.skip(
        !testEmail || !testPassword,
        "ATHENA_E2E_TEST_EMAIL and ATHENA_E2E_TEST_PASSWORD not set; skipping Caddy sign-in smoke",
      );

      const origin = caddyHttpsUrl;

      const signInResponse = await request.post(
        `${caddyHttpsUrl}/api/auth/sign-in/email`,
        {
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            Referer: `${origin}/login`,
          },
          data: JSON.stringify({
            email: testEmail,
            password: testPassword,
            callbackURL: "/",
          }),
        },
      );

      // The security boundary is reached if the request is not rejected as cross-origin/forged.
      expect(signInResponse.status()).not.toBe(403);
      expect([200, 302, 303]).toContain(signInResponse.status());

      const setCookieHeader = signInResponse.headers()["set-cookie"];
      const setCookieValue = Array.isArray(setCookieHeader)
        ? setCookieHeader.join("; ")
        : setCookieHeader;
      expect(setCookieValue).toBeTruthy();

      const hasSecure =
        typeof setCookieValue === "string" &&
        setCookieValue.toLowerCase().includes("secure");
      expect(hasSecure).toBe(true);

      // Verify the session is usable through Caddy without printing the body.
      const sessionResponse = await request.get(
        `${caddyHttpsUrl}/api/auth/get-session`,
      );
      expect(sessionResponse.status()).toBe(200);
      const contentType = sessionResponse.headers()["content-type"];
      const isJson =
        typeof contentType === "string" &&
        contentType.toLowerCase().includes("application/json");
      expect(isJson).toBe(true);
    });
  });
});
