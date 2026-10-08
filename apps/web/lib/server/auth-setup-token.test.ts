import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSetupTokenRequired,
  isSetupTokenValid,
  SETUP_AUTHORIZATION_ERROR,
} from "./auth-setup-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("first-run setup token", () => {
  it("allows tokenless setup outside production when the environment value is absent or blank", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ATHENA_AUTH_SETUP_TOKEN", undefined);
    expect(isSetupTokenRequired()).toBe(false);
    expect(isSetupTokenValid(undefined)).toBe(true);

    vi.stubEnv("ATHENA_AUTH_SETUP_TOKEN", "  ");
    expect(isSetupTokenRequired()).toBe(false);
    expect(isSetupTokenValid(crypto.randomUUID())).toBe(true);
  });

  it("requires the configured token and accepts only the matching value", () => {
    vi.stubEnv("NODE_ENV", "development");
    const configured = crypto.randomUUID();
    vi.stubEnv("ATHENA_AUTH_SETUP_TOKEN", configured);

    expect(isSetupTokenRequired()).toBe(true);
    expect(isSetupTokenValid(configured)).toBe(true);
    expect(isSetupTokenValid(crypto.randomUUID())).toBe(false);
    expect(isSetupTokenValid(undefined)).toBe(false);
  });

  it("fails closed in production when no token is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATHENA_AUTH_SETUP_TOKEN", undefined);

    expect(isSetupTokenRequired()).toBe(true);
    expect(isSetupTokenValid(undefined)).toBe(false);
    expect(isSetupTokenValid(crypto.randomUUID())).toBe(false);
  });

  it("accepts the matching configured token in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const configured = crypto.randomUUID();
    vi.stubEnv("ATHENA_AUTH_SETUP_TOKEN", configured);

    expect(isSetupTokenRequired()).toBe(true);
    expect(isSetupTokenValid(configured)).toBe(true);
    expect(isSetupTokenValid(crypto.randomUUID())).toBe(false);
    expect(isSetupTokenValid(undefined)).toBe(false);
  });

  it("uses a generic authorization message", () => {
    vi.stubEnv("NODE_ENV", "development");
    const configured = crypto.randomUUID();
    vi.stubEnv("ATHENA_AUTH_SETUP_TOKEN", configured);

    expect(SETUP_AUTHORIZATION_ERROR).toBe("Setup authorization failed.");
    expect(SETUP_AUTHORIZATION_ERROR).not.toContain(configured);
  });
});
