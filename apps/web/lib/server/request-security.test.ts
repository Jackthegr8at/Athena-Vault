import { describe, expect, it } from "vitest";
import { normalizeOrigin, trustedOrigins, validateProxyRequest, validateStateChangingRequest } from "./request-security";

const environment = {
  BETTER_AUTH_URL: "http://vault.example.test:8080",
  ATHENA_AUTH_TRUSTED_ORIGINS: "https://vault.example.test",
};

function request(headers: Record<string, string>, method = "POST"): Request {
  return new Request("http://internal:3000/api/auth/sign-in/email", { method, headers });
}

describe("same-origin and trusted-proxy request policy", () => {
  it("normalizes only bare HTTP(S) origins", () => {
    expect(normalizeOrigin("https://vault.example.test/path")).toBeNull();
    expect(normalizeOrigin("https://vault.example.test")).toBe("https://vault.example.test");
    expect(normalizeOrigin("null")).toBeNull();
  });

  it("includes the configured application origin and loopback alias", () => {
    expect(trustedOrigins({ BETTER_AUTH_URL: "http://localhost:3000" })).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
  });

  it("accepts a trusted browser origin and matching forwarded host/scheme", () => {
    const result = validateStateChangingRequest(request({
      origin: "http://vault.example.test:8080",
      "x-forwarded-host": "vault.example.test:8080",
      "x-forwarded-proto": "http",
    }), environment);
    expect(result).toEqual({ ok: true, origin: "http://vault.example.test:8080" });
  });

  it("accepts a trusted Referer when the browser omits Origin", () => {
    const result = validateStateChangingRequest(request({ referer: "http://vault.example.test:8080/setup?first-run=1" }), environment);
    expect(result).toEqual({ ok: true, origin: "http://vault.example.test:8080" });
  });

  it("accepts same-origin Fetch Metadata when the browser omits Origin and Referer", () => {
    const result = validateStateChangingRequest(request({
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": "vault.example.test:8080",
      "x-forwarded-proto": "http",
    }), environment);
    expect(result).toEqual({ ok: true, origin: "http://vault.example.test:8080" });
  });

  it("rejects missing, cross-site, conflicting, and spoofed forwarded headers", () => {
    expect(validateStateChangingRequest(request({}), environment).ok).toBe(false);
    expect(validateStateChangingRequest(request({ "sec-fetch-site": "same-site" }), environment).ok).toBe(false);
    expect(validateStateChangingRequest(request({ "sec-fetch-site": "cross-site" }), environment).ok).toBe(false);
    expect(validateStateChangingRequest(request({ origin: "https://evil.example.test" }), environment).ok).toBe(false);
    expect(validateStateChangingRequest(request({ origin: "not-an-origin", referer: "http://vault.example.test:8080/setup" }), environment).ok).toBe(false);
    expect(validateStateChangingRequest(request({
      origin: "http://vault.example.test:8080",
      "x-forwarded-host": "evil.example.test",
      "x-forwarded-proto": "http",
    }), environment).ok).toBe(false);
    expect(validateStateChangingRequest(request({
      origin: "http://vault.example.test:8080",
      "x-forwarded-host": "vault.example.test:8080, evil.example.test",
      "x-forwarded-proto": "http",
    }), environment).ok).toBe(false);
  });

  it("rejects forwarded identity assertions and does not constrain GET", () => {
    expect(validateStateChangingRequest(request({ origin: "http://vault.example.test:8080", "x-forwarded-user": "owner" }), environment).ok).toBe(false);
    expect(validateStateChangingRequest(request({}, "GET"), environment)).toEqual({ ok: true, origin: null });
  });

  it("requires an explicitly configured proxy source when proxy IP validation is enabled", () => {
    const proxiedEnvironment = { ...environment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "10.0.0.2" };
    const proxiedRequest = request({
      origin: "http://vault.example.test:8080",
      "x-forwarded-host": "vault.example.test:8080",
      "x-forwarded-proto": "http",
    });
    expect(validateStateChangingRequest(proxiedRequest, proxiedEnvironment, { sourceIp: "10.0.0.3" }).ok).toBe(false);
    expect(validateStateChangingRequest(proxiedRequest, proxiedEnvironment, { sourceIp: "10.0.0.2" }).ok).toBe(true);
  });
});

describe("proxy source identity", () => {
  const noneEnvironment = { ...environment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "none" };
  const allowlistEnvironment = { ...environment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "10.0.0.2" };

  function proxyRequest(headers: Record<string, string>, method = "GET"): Request {
    return new Request("http://internal:3000/api/auth/sign-in/email", { method, headers });
  }

  it("rejects forwarded identity headers when the proxy policy is none", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(await validateProxyRequest(proxyRequest({ "x-forwarded-for": "10.0.0.2" }, method), noneEnvironment)).toEqual({
        ok: false,
        reason: "forwarded",
      });
    }
  });

  it("rejects a forged x-real-ip as a forwarded identity header", async () => {
    expect(await validateProxyRequest(proxyRequest({ "x-real-ip": "10.0.0.2" }), noneEnvironment)).toEqual({
      ok: false,
      reason: "forwarded",
    });
  });

  it("requires a matching X-Athena-Proxy-Source marker for an allowlist", async () => {
    expect(await validateProxyRequest(proxyRequest({}), allowlistEnvironment)).toEqual({ ok: false, reason: "proxy" });
    expect(await validateProxyRequest(proxyRequest({ "x-athena-proxy-source": "10.0.0.3" }), allowlistEnvironment)).toEqual({
      ok: false,
      reason: "proxy",
    });
    expect(await validateProxyRequest(proxyRequest({ "x-athena-proxy-source": "forged-marker" }), allowlistEnvironment)).toEqual({
      ok: false,
      reason: "proxy",
    });
  });

  it("rejects multiple or mismatched proxy markers", async () => {
    expect(await validateProxyRequest(proxyRequest({ "x-athena-proxy-source": "10.0.0.2, 10.0.0.3" }), allowlistEnvironment)).toEqual({
      ok: false,
      reason: "proxy",
    });
    expect(
      await validateProxyRequest(proxyRequest({ "x-athena-proxy-source": "10.0.0.2" }), allowlistEnvironment, { sourceIp: "10.0.0.3" }),
    ).toEqual({ ok: false, reason: "proxy" });
  });

  it("accepts a valid allowlist marker and a forwarded HTTP protocol", async () => {
    const httpEnvironment = { ...environment, ATHENA_AUTH_TRUSTED_PROXY_IPS: "10.0.0.2" };
    const headers = {
      "x-athena-proxy-source": "10.0.0.2",
      "x-forwarded-host": "vault.example.test:8080",
      "x-forwarded-proto": "http",
    };
    expect(await validateProxyRequest(proxyRequest(headers, "GET"), httpEnvironment)).toEqual({
      ok: true,
      origin: "http://vault.example.test:8080",
    });
    expect(await validateProxyRequest(proxyRequest(headers, "POST"), httpEnvironment)).toEqual({
      ok: true,
      origin: "http://vault.example.test:8080",
    });
    expect(await validateProxyRequest(proxyRequest(headers, "DELETE"), httpEnvironment)).toEqual({
      ok: true,
      origin: "http://vault.example.test:8080",
    });
  });

  it("accepts a Caddy-controlled client-IP chain with a trusted origin", async () => {
    const caddyEnvironment = {
      BETTER_AUTH_URL: "https://auth.example.test:8443",
      ATHENA_AUTH_TRUSTED_ORIGINS: "",
      ATHENA_AUTH_TRUSTED_PROXY_IPS: "172.30.0.2",
    };
    const headers = {
      "x-athena-proxy-source": "172.30.0.2",
      "x-forwarded-for": "203.0.113.10, 172.30.0.2",
      "x-forwarded-host": "auth.example.test:8443",
      "x-forwarded-proto": "https",
    };
    expect(await validateProxyRequest(proxyRequest(headers), caddyEnvironment)).toEqual({
      ok: true,
      origin: "https://auth.example.test:8443",
    });
  });

  it("rejects a Caddy X-Forwarded-For chain that does not end at the trusted marker", async () => {
    const caddyEnvironment = {
      BETTER_AUTH_URL: "https://auth.example.test:8443",
      ATHENA_AUTH_TRUSTED_ORIGINS: "",
      ATHENA_AUTH_TRUSTED_PROXY_IPS: "172.30.0.2",
    };
    const headers = {
      "x-athena-proxy-source": "172.30.0.2",
      "x-forwarded-for": "203.0.113.10, 10.0.0.3",
      "x-forwarded-host": "auth.example.test:8443",
      "x-forwarded-proto": "https",
    };
    expect(await validateProxyRequest(proxyRequest(headers), caddyEnvironment)).toEqual({
      ok: false,
      reason: "forwarded",
    });
  });

  it("rejects a forwarded HTTP protocol when the application origin is HTTPS", async () => {
    const caddyEnvironment = {
      BETTER_AUTH_URL: "https://auth.example.test:8443",
      ATHENA_AUTH_TRUSTED_ORIGINS: "",
      ATHENA_AUTH_TRUSTED_PROXY_IPS: "172.30.0.2",
    };
    const headers = {
      "x-athena-proxy-source": "172.30.0.2",
      "x-forwarded-for": "203.0.113.10, 172.30.0.2",
      "x-forwarded-host": "auth.example.test:8443",
      "x-forwarded-proto": "http",
    };
    expect(await validateProxyRequest(proxyRequest(headers), caddyEnvironment)).toEqual({
      ok: false,
      reason: "forwarded",
    });
  });

  it("rejects all identity assertion headers, including Forwarded, when the proxy policy is none", async () => {
    for (const headerName of ["x-forwarded-user", "x-forwarded-email", "x-authenticated-user", "forwarded"]) {
      const headers = { [headerName]: "owner" };
      expect(await validateProxyRequest(proxyRequest(headers, "GET"), noneEnvironment)).toEqual({
        ok: false,
        reason: "forwarded",
      });
    }
  });

  it("rejects an unconfigured proxy in production even when the secure cookie flag is absent", async () => {
    const productionEnvironment = {
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://auth.example.test:8443",
      ATHENA_AUTH_COOKIE_SECURE: "false",
      ATHENA_AUTH_TRUSTED_PROXY_IPS: "",
    };
    expect(await validateProxyRequest(proxyRequest({}), productionEnvironment)).toEqual({
      ok: false,
      reason: "proxy",
    });
  });

  it("requires the configured proxy shared secret in allowlist mode", async () => {
    const secret = crypto.randomUUID();
    const secretEnvironment = { ...allowlistEnvironment, ATHENA_PROXY_SHARED_SECRET: secret };
    const marker = { "x-athena-proxy-source": "10.0.0.2" };

    expect(await validateProxyRequest(proxyRequest({ ...marker, "x-athena-proxy-secret": secret }), secretEnvironment)).toEqual({
      ok: true,
      origin: null,
    });
    expect(await validateProxyRequest(proxyRequest({ ...marker, "x-athena-proxy-secret": `${secret}-forged` }), secretEnvironment)).toEqual({
      ok: false,
      reason: "proxy",
    });
    expect(await validateProxyRequest(proxyRequest(marker), secretEnvironment)).toEqual({
      ok: false,
      reason: "proxy",
    });
  });

  it("does not enforce the proxy shared secret outside allowlist mode", async () => {
    const secret = crypto.randomUUID();
    const noneWithSecret = { ...noneEnvironment, ATHENA_PROXY_SHARED_SECRET: secret };
    const unconfiguredWithSecret = { ...environment, ATHENA_PROXY_SHARED_SECRET: secret };

    expect(await validateProxyRequest(proxyRequest({}), noneWithSecret)).toEqual({ ok: true, origin: null });
    expect(await validateProxyRequest(proxyRequest({}), unconfiguredWithSecret)).toEqual({ ok: true, origin: null });
  });
});
