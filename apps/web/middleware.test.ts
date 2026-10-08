import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware, residualInlineStyleFiles } from "./middleware";
const mutableProcessEnv = process.env as Record<string, string | undefined>;

const originalAuthUrl = process.env.BETTER_AUTH_URL;
const originalTrustedOrigins = process.env.ATHENA_AUTH_TRUSTED_ORIGINS;
const originalTrustedProxyIps = process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS;
const originalNodeEnv = mutableProcessEnv.NODE_ENV;

beforeAll(() => {
  mutableProcessEnv.NODE_ENV = "test";
});

afterAll(() => {
  if (originalNodeEnv === undefined) delete mutableProcessEnv.NODE_ENV;
  else mutableProcessEnv.NODE_ENV = originalNodeEnv;
});

afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = originalAuthUrl;
  if (originalTrustedOrigins === undefined) delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;
  else process.env.ATHENA_AUTH_TRUSTED_ORIGINS = originalTrustedOrigins;
  if (originalTrustedProxyIps === undefined) delete process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS;
  else process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = originalTrustedProxyIps;
  mutableProcessEnv.NODE_ENV = "test";
});

describe("authentication middleware request boundary", () => {
  it("rejects a state-changing request with a cross-site origin", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("http://vault.example.test:8080/api/auth/sign-in/email", {
      method: "POST",
      headers: { origin: "http://evil.example.test" },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Request rejected." });
  });

  it("passes a same-origin request to the downstream route", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("http://vault.example.test:8080/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://vault.example.test:8080",
        "x-forwarded-host": "vault.example.test:8080",
        "x-forwarded-proto": "http",
      },
    }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets the demo route perform its own CSRF check when browser origin headers are absent", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/api/demo/sign-in", {
      method: "POST",
    }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("issues the demo CSRF cookie for the login page", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/login", { method: "GET" }));

    expect(response.cookies.get("athena_demo_csrf")?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(response.cookies.get("athena_demo_csrf")?.httpOnly).toBe(true);
  });

  it("adds a per-request CSP nonce to the login response", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/login", { method: "GET" }));
    const policy = response.headers.get("Content-Security-Policy");

    expect(policy).toMatch(/default-src 'self'/);
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("adds the nonce to public and authenticated continuation responses", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const publicResponse = await middleware(new NextRequest("https://vault.example.test/security"));
    const authenticatedResponse = await middleware(new NextRequest("https://vault.example.test/shared-expenses", {
      headers: { cookie: "better-auth.session_token=session" },
    }));

    expect(publicResponse.headers.get("Content-Security-Policy")).toContain("'nonce-");
    expect(authenticatedResponse.headers.get("Content-Security-Policy")).toContain("'nonce-");
  });

  it("leaves rejected JSON responses without a CSP continuation header", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { origin: "https://evil.example.test" },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("allows the public Security information page without a session", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("http://vault.example.test:8080/security"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    "/fonts/archivo-latin.woff2",
    "/fonts/playfair-display-latin.woff2",
    "/fonts/archivo-OFL.txt",
    "/fonts/playfair-display-OFL.txt",
  ].flatMap((path) => ["GET", "HEAD"].map((method) => [path, method])))("allows anonymous %s requests with method %s", async (path, method) => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;
    delete process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS;

    const response = await middleware(new NextRequest(`https://vault.example.test${path}`, { method }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("Content-Security-Policy")).toContain("'nonce-");
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/fonts/unlisted.woff2", "/fonts/archivo-latin.woff2/private"])("does not expose unlisted font paths: %s", async (path) => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;
    delete process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS;

    const response = await middleware(new NextRequest(`https://vault.example.test${path}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?next=");
  });

  it("retains production proxy validation for anonymous font requests", async () => {
    mutableProcessEnv.NODE_ENV = "production";
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "127.0.0.1";

    const response = await middleware(new NextRequest("https://vault.example.test/fonts/archivo-latin.woff2"));

    expect(response.status).toBe(403);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("retains cross-site mutation rejection for the font allowlist", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS;

    const response = await middleware(new NextRequest("https://vault.example.test/fonts/archivo-OFL.txt", {
      method: "POST",
      headers: { origin: "https://evil.example.test" },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("allows the health probe without a session", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("http://vault.example.test:8080/api/health"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes the authenticated investment symbol search route to its handler", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("http://vault.example.test:8080/api/investments/symbol-search?q=veq&instrumentType=etf&currency=CAD", {
      headers: { cookie: "better-auth.session_token=session" },
    }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes the workbook snapshot route to its handler and rejects neighbouring API paths", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const allowed = await middleware(new NextRequest("http://vault.example.test:8080/api/workbooks/book-1/snapshot", {
      headers: { cookie: "better-auth.session_token=session" },
    }));
    const withoutSnapshot = await middleware(new NextRequest("http://vault.example.test:8080/api/workbooks/book-1"));
    const nested = await middleware(new NextRequest("http://vault.example.test:8080/api/workbooks/book-1/snapshot/extra"));

    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    expect(withoutSnapshot.status).toBe(404);
    expect(nested.status).toBe(404);
  });

  it("rejects an unknown API path", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const unknown = await middleware(new NextRequest("http://vault.example.test:8080/api/unknown"));
    const exportPath = await middleware(new NextRequest("http://vault.example.test:8080/api/export"));

    expect(unknown.status).toBe(404);
    expect(exportPath.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: "Not found." });
    await expect(exportPath.json()).resolves.toEqual({ error: "Not found." });
  });

  it("redirects an unauthenticated protected page and preserves its destination", async () => {
    process.env.BETTER_AUTH_URL = "http://vault.example.test:8080";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("http://vault.example.test:8080/shared-expenses?status=active"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://vault.example.test:8080/login?next=%2Fshared-expenses%3Fstatus%3Dactive");
  });

  it("rejects a request without the Caddy marker when an allowlist is configured", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "172.30.0.2";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { origin: "https://vault.example.test" },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Request rejected." });
  });

  it("rejects a forged marker before the origin or CSRF gate is evaluated", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "172.30.0.2";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "https://evil.example.test",
        "x-athena-proxy-source": "forged-marker",
      },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Request rejected." });
  });

  it("does not trust x-real-ip as a substitute for the Caddy source marker", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "172.30.0.2";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "https://vault.example.test",
        "x-real-ip": "172.30.0.2",
      },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Request rejected." });
  });

  it("rejects direct requests with forwarded headers when the proxy policy is none", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "none";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const get = await middleware(new NextRequest("https://vault.example.test/security", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    }));
    const post = await middleware(new NextRequest("https://vault.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.2" },
    }));

    expect(get.status).toBe(403);
    expect(post.status).toBe(403);
    await expect(get.json()).resolves.toEqual({ error: "Request rejected." });
    await expect(post.json()).resolves.toEqual({ error: "Request rejected." });
  });

  it("keeps public pages and health reachable under direct (none) policy", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "none";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const security = await middleware(new NextRequest("https://vault.example.test/security"));
    const health = await middleware(new NextRequest("https://vault.example.test/api/health"));
    const login = await middleware(new NextRequest("https://vault.example.test/login", { method: "GET" }));

    expect(security.headers.get("x-middleware-next")).toBe("1");
    expect(health.headers.get("x-middleware-next")).toBe("1");
    expect(login.cookies.get("athena_demo_csrf")?.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lets the demo sign-in bypass the CSRF/origin gate only after the proxy gate is satisfied", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "172.30.0.2";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const allowed = await middleware(new NextRequest("https://vault.example.test/api/demo/sign-in", {
      method: "POST",
      headers: { "x-athena-proxy-source": "172.30.0.2" },
    }));
    const rejected = await middleware(new NextRequest("https://vault.example.test/api/demo/sign-in", {
      method: "POST",
    }));

    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toEqual({ error: "Request rejected." });
  });

  it("validates the proxy marker before the public page check for GET requests", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "172.30.0.2";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/security"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Request rejected." });
  });

  it("passes a same-origin request with a valid Caddy marker", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "172.30.0.2";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const response = await middleware(new NextRequest("https://vault.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "https://vault.example.test",
        "x-athena-proxy-source": "172.30.0.2",
      },
    }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("re-evaluates memoised proxy policy and trusted origins when env values change", async () => {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "172.30.0.2";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;

    const withoutMarker = await middleware(new NextRequest("https://vault.example.test/security"));
    expect(withoutMarker.status).toBe(403);

    process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS = "none";

    const allowed = await middleware(new NextRequest("https://vault.example.test/security"));
    expect(allowed.headers.get("x-middleware-next")).toBe("1");

    process.env.BETTER_AUTH_URL = "https://other.example.test";

    const staleOrigin = await middleware(new NextRequest("https://other.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { origin: "https://vault.example.test" },
    }));
    const freshOrigin = await middleware(new NextRequest("https://other.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { origin: "https://other.example.test" },
    }));

    expect(staleOrigin.status).toBe(403);
    expect(freshOrigin.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("content security policy", () => {
  async function policyFor(path: string, method = "GET", env: Record<string, string | undefined> = {}) {
    process.env.BETTER_AUTH_URL = "https://vault.example.test";
    delete process.env.ATHENA_AUTH_TRUSTED_ORIGINS;
    mutableProcessEnv.NODE_ENV = env.NODE_ENV ?? "test";
    for (const [key, value] of Object.entries(env)) {
      if (key === "NODE_ENV") continue;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const response = await middleware(new NextRequest(`https://vault.example.test${path}`, { method }));
    return response.headers.get("Content-Security-Policy");
  }

  it("retains style-src 'self' 'unsafe-inline' while residual inline styles remain", async () => {
    const policy = (await policyFor("/login"))!;
    expect(policy).toMatch(/style-src 'self' 'unsafe-inline'/);
    expect(policy).not.toMatch(/style-src[^;]*'unsafe-hashes'/);
    expect(policy).not.toMatch(/style-src[^;]*'unsafe-eval'/);
    expect(policy).not.toMatch(/\bhttps?:\/\//);
    expect(policy).not.toMatch(/\*\./);
  });

  it("does not allow 'unsafe-inline' in script-src", async () => {
    const policy = (await policyFor("/login"))!;
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("generates a unique per-request script nonce", async () => {
    const policy1 = (await policyFor("/login"))!;
    const policy2 = (await policyFor("/login"))!;
    const match1 = policy1.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    const match2 = policy2.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    const nonce1 = match1?.[1];
    const nonce2 = match2?.[1];
    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toBe(nonce2);
    expect(nonce1!.length).toBeGreaterThan(0);
  });

  it("uses only the allowlisted safe origins and no external domains", async () => {
    const policy = (await policyFor("/login"))!;
    const allowed = new Set(["'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'", "data:"]);
    for (const directive of policy.split("; ")) {
      const parts = directive.split(" ");
      const name = parts[0] as string;
      const sources = parts.slice(1);
      if (name.endsWith("-src") || ["default-src", "form-action", "base-uri", "frame-ancestors"].includes(name)) {
        for (const source of sources) {
          expect(allowed.has(source) || source.startsWith("'nonce-")).toBe(true);
        }
      }
    }
  });

  it("adds upgrade-insecure-requests only in production", async () => {
    const production = (await policyFor("/login", "GET", { NODE_ENV: "production", ATHENA_AUTH_TRUSTED_PROXY_IPS: "none" }))!;
    expect(production).toContain("upgrade-insecure-requests");
    const test = (await policyFor("/login"))!;
    expect(test).not.toContain("upgrade-insecure-requests");
  });

  it("adds 'unsafe-eval' to script-src only in development", async () => {
    const development = (await policyFor("/login", "GET", { NODE_ENV: "development" }))!;
    expect(development).toMatch(/script-src[^;]*'unsafe-eval'/);
    const test = (await policyFor("/login"))!;
    expect(test).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });
});

describe("residual inline style inventory", () => {
  const webRoot = fileURLToPath(new URL(".", import.meta.url));

  function listFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry: Dirent) => {
      const path = `${directory}${entry.name}`;
      return entry.isDirectory() ? listFiles(`${path}/`) : [path];
    });
  }

  function currentInlineStyleFiles(): readonly string[] {
    return listFiles(`${webRoot}app/`)
      .filter((path) => path.endsWith(".tsx"))
      .filter((path) => readFileSync(path, "utf8").includes("style={"))
      .map((path) => path.slice(webRoot.length).replaceAll("\\", "/"))
      .sort();
  }

  it("matches every app .tsx file that still contains an inline style expression", () => {
    const current = currentInlineStyleFiles();
    expect(current.length).toBeGreaterThan(0);
    expect([...residualInlineStyleFiles].sort()).toEqual(current);
  });
});
