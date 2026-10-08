import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync(fileURLToPath(new URL("./next.config.ts", import.meta.url)), "utf8");
const middlewareSource = readFileSync(fileURLToPath(new URL("./middleware.ts", import.meta.url)), "utf8");
const webPackage = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as {
  scripts: Record<string, string>;
};

describe("Next security headers", () => {
  it("keeps the static security headers outside the per-request CSP", () => {
    expect(nextConfigSource).not.toContain("Content-Security-Policy");
    expect(nextConfigSource).toContain("Referrer-Policy");
    expect(nextConfigSource).toContain("X-Content-Type-Options");
    expect(nextConfigSource).toContain("X-Frame-Options");
    expect(nextConfigSource).toContain("Permissions-Policy");
    expect(middlewareSource).toContain("object-src 'none'");
    expect(middlewareSource).toContain("'nonce-${nonce}'");
    expect(middlewareSource).toContain('process.env.NODE_ENV === "production"');
    expect(middlewareSource).toContain("BETTER_AUTH_URL: process.env.BETTER_AUTH_URL");
    expect(middlewareSource).toContain("ATHENA_AUTH_TRUSTED_ORIGINS: process.env.ATHENA_AUTH_TRUSTED_ORIGINS");
    expect(middlewareSource).toContain("ATHENA_AUTH_TRUSTED_PROXY_IPS: process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS");
    expect(middlewareSource).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(nextConfigSource).not.toContain("Strict-Transport-Security");
  });
  it("keeps middleware deployment policy available without bundling secrets", () => {
    expect(nextConfigSource).toContain("BETTER_AUTH_URL: process.env.BETTER_AUTH_URL");
    expect(nextConfigSource).toContain("ATHENA_AUTH_TRUSTED_ORIGINS: process.env.ATHENA_AUTH_TRUSTED_ORIGINS");
    expect(nextConfigSource).toContain("ATHENA_AUTH_TRUSTED_PROXY_IPS: process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS");
    expect(nextConfigSource).toContain('ATHENA_AUTH_TRUSTED_PROXY_IPS: process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS ?? ""');
    expect(nextConfigSource).not.toContain("BETTER_AUTH_SECRET");
    expect(nextConfigSource).not.toContain("DATABASE_URL");
  });
  it("excludes environment files from standalone output traces", () => {
    expect(nextConfigSource).toContain("outputFileTracingExcludes");
    expect(nextConfigSource).toContain('[".env", ".env.*", "../../.env", "../../.env.*"]');
    expect(nextConfigSource).toContain("defense in depth");
    expect(nextConfigSource).toContain("next-standalone-security");
  });
  it("delegates final standalone artifact sanitation to the standard web build", () => {
    expect(webPackage.scripts.build).toBe("next build --webpack && node ../../scripts/next-standalone-security.mjs sanitize");
    expect(webPackage.scripts["test:standalone-security"]).toBe("node --test ../../scripts/next-standalone-security.test.mjs");
  });
  it("allows the workbook snapshot action to carry the database-sized payload", () => {
    expect(nextConfigSource).toContain('serverActions: { bodySizeLimit: "8mb" }');
  });
});
