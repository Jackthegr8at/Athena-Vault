import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  logOperationalFailure: vi.fn(),
  fsExistsSync: vi.fn(() => {
    throw new Error("Filesystem environment fallback was invoked.");
  }),
  fsReadFileSync: vi.fn(() => {
    throw new Error("Filesystem environment fallback was invoked.");
  }),
  pathResolve: vi.fn(() => {
    throw new Error("Filesystem environment fallback was invoked.");
  }),
}));

vi.mock("@athena/database", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("./security-logging", () => ({ logOperationalFailure: mocks.logOperationalFailure }));
vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.fsExistsSync,
    readFileSync: mocks.fsReadFileSync,
  },
  existsSync: mocks.fsExistsSync,
  readFileSync: mocks.fsReadFileSync,
}));
vi.mock("node:path", () => ({ default: { resolve: mocks.pathResolve }, resolve: mocks.pathResolve }));

import { getAuthDatabase, getServerDatabase } from "./database";

const ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "ATHENA_DB_PASSWORD",
  "ATHENA_AUTH_DATABASE_URL",
  "ATHENA_AUTH_ROLE_PASSWORD",
  "NODE_ENV",
] as const;
const originalEnvironment = new Map(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));

function clearDatabaseCaches(): void {
  const globalState = globalThis as Record<string, unknown>;
  delete globalState.__athenaDatabase;
  delete globalState.__athenaAuthDatabase;
}

function clearDatabaseEnvironment(): void {
  for (const key of ENVIRONMENT_KEYS) delete process.env[key];
}

function restoreDatabaseEnvironment(): void {
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else Reflect.set(process.env, key, value);
  }
}

function setNodeEnvironment(value: string): void {
  Reflect.set(process.env, "NODE_ENV", value);
}

describe("server database configuration", () => {
  beforeEach(() => {
    clearDatabaseCaches();
    clearDatabaseEnvironment();
    mocks.createDatabase.mockReset();
    mocks.createDatabase.mockImplementation((connectionString: string) => ({ connectionString }));
    mocks.logOperationalFailure.mockReset();
    mocks.fsExistsSync.mockClear();
    mocks.fsReadFileSync.mockClear();
    mocks.pathResolve.mockClear();
  });

  afterEach(() => {
    clearDatabaseCaches();
    restoreDatabaseEnvironment();
  });

  it("resolves application and auth URLs from process.env with separate caches", () => {
    process.env.DATABASE_URL = "  postgresql://app.example/athena  ";
    process.env.ATHENA_AUTH_DATABASE_URL = "postgres://auth.example/better-auth";
    setNodeEnvironment("production");

    const applicationDatabase = getServerDatabase();
    const authDatabase = getAuthDatabase();

    expect(mocks.createDatabase).toHaveBeenNthCalledWith(1, "postgresql://app.example/athena");
    expect(mocks.createDatabase).toHaveBeenNthCalledWith(2, "postgres://auth.example/better-auth");
    expect(authDatabase).not.toBe(applicationDatabase);
    expect(getServerDatabase()).toBe(applicationDatabase);
    expect(getAuthDatabase()).toBe(authDatabase);
    expect(mocks.createDatabase).toHaveBeenCalledTimes(2);
  });

  it("URI-encodes application and auth password placeholders", () => {
    const applicationValue = "application value/@%";
    const authValue = "auth value+?#";
    process.env.DATABASE_URL = "postgresql://app:$ATHENA_DB_PASSWORD@example/athena";
    process.env.ATHENA_DB_PASSWORD = applicationValue;
    process.env.ATHENA_AUTH_DATABASE_URL = "postgresql://auth:$ATHENA_AUTH_ROLE_PASSWORD@example/auth";
    process.env.ATHENA_AUTH_ROLE_PASSWORD = authValue;
    setNodeEnvironment("production");

    getServerDatabase();
    getAuthDatabase();

    expect(mocks.createDatabase).toHaveBeenNthCalledWith(
      1,
      `postgresql://app:${encodeURIComponent(applicationValue)}@example/athena`,
    );
    expect(mocks.createDatabase).toHaveBeenNthCalledWith(
      2,
      `postgresql://auth:${encodeURIComponent(authValue)}@example/auth`,
    );
  });

  it("raises only the generic configuration error for missing or invalid configuration", () => {
    expect(() => getServerDatabase()).toThrowError(new Error("Database configuration failed."));
    expect(mocks.createDatabase).not.toHaveBeenCalled();

    clearDatabaseCaches();
    process.env.DATABASE_URL = "mysql://unsupported.example/athena";
    expect(() => getServerDatabase()).toThrowError(new Error("Database configuration failed."));
    expect(mocks.createDatabase).not.toHaveBeenCalled();

    clearDatabaseCaches();
    process.env.DATABASE_URL = "postgresql://app:$ATHENA_DB_PASSWORD@example/athena";
    expect(() => getServerDatabase()).toThrowError(new Error("Database configuration failed."));
    expect(mocks.createDatabase).not.toHaveBeenCalled();

    clearDatabaseCaches();
    setNodeEnvironment("production");
    process.env.ATHENA_AUTH_DATABASE_URL = "mysql://unsupported.example/auth";
    expect(() => getAuthDatabase()).toThrowError(new Error("Database configuration failed."));
    expect(mocks.createDatabase).not.toHaveBeenCalled();
  });

  it("keeps operational connection failures generic", () => {
    process.env.DATABASE_URL = "postgresql://app.example/athena";
    mocks.createDatabase.mockImplementationOnce(() => {
      throw new Error("connection details must not escape");
    });

    expect(() => getServerDatabase()).toThrowError(new Error("Database connection failed."));
    expect(mocks.logOperationalFailure).toHaveBeenCalledWith(expect.objectContaining({
      operation: "database.connect",
      status: "unavailable",
      failureCode: "DATABASE_CONNECTION_FAILED",
    }));
  });

  it("does not access filesystem environment files when configuration is absent", () => {
    expect(() => getServerDatabase()).toThrowError(new Error("Database configuration failed."));
    expect(mocks.fsExistsSync).not.toHaveBeenCalled();
    expect(mocks.fsReadFileSync).not.toHaveBeenCalled();
    expect(mocks.pathResolve).not.toHaveBeenCalled();
  });
});
