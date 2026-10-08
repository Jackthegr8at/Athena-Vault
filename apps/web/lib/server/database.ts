import "./server-only";

import { createDatabase, type Database } from "@athena/database";
import { logOperationalFailure } from "./security-logging";

const globalForAthena = globalThis as typeof globalThis & {
  __athenaDatabase?: Database;
  __athenaAuthDatabase?: Database;
};

class DatabaseConfigurationError extends Error {
  constructor() {
    super("Database configuration failed.");
    this.name = "DatabaseConfigurationError";
  }
}

function resolveDatabaseUrl(): string {
  const configuredUrl = process.env.DATABASE_URL?.trim();
  if (!configuredUrl || !/^postgres(?:ql)?:\/\//i.test(configuredUrl)) {
    throw new DatabaseConfigurationError();
  }

  if (!configuredUrl.includes("$ATHENA_DB_PASSWORD")) return configuredUrl;
  const password = process.env.ATHENA_DB_PASSWORD;
  if (!password) throw new DatabaseConfigurationError();
  return configuredUrl.replaceAll("$ATHENA_DB_PASSWORD", encodeURIComponent(password));
}

export function getServerDatabase(): Database {
  if (!globalForAthena.__athenaDatabase) {
    try {
      globalForAthena.__athenaDatabase = createDatabase(resolveDatabaseUrl());
    } catch (error) {
      const configurationFailure = error instanceof DatabaseConfigurationError;
      logOperationalFailure({
        operation: configurationFailure ? "database.configure" : "database.connect",
        error,
        status: configurationFailure ? "invalid" : "unavailable",
        failureCode: configurationFailure ? "DATABASE_CONFIGURATION_FAILED" : "DATABASE_CONNECTION_FAILED",
      });
      throw new Error(configurationFailure ? "Database configuration failed." : "Database connection failed.");
    }
  }
  return globalForAthena.__athenaDatabase;
}

function resolveAuthDatabaseUrl(): string | undefined {
  const configuredUrl = process.env.ATHENA_AUTH_DATABASE_URL?.trim();
  if (!configuredUrl) return undefined;
  if (!/^postgres(?:ql)?:\/\//i.test(configuredUrl)) throw new DatabaseConfigurationError();
  if (!configuredUrl.includes("$ATHENA_AUTH_ROLE_PASSWORD")) return configuredUrl;
  const password = process.env.ATHENA_AUTH_ROLE_PASSWORD;
  if (!password) throw new DatabaseConfigurationError();
  return configuredUrl.replaceAll("$ATHENA_AUTH_ROLE_PASSWORD", encodeURIComponent(password));
}

export function getAuthDatabase(): Database {
  if (globalForAthena.__athenaAuthDatabase) return globalForAthena.__athenaAuthDatabase;

  let configuredUrl: string | undefined;
  try {
    configuredUrl = resolveAuthDatabaseUrl();
  } catch (error) {
    logOperationalFailure({
      operation: "database.configure",
      error,
      status: "invalid",
      failureCode: "DATABASE_CONFIGURATION_FAILED",
    });
    throw new Error("Database configuration failed.");
  }

  if (!configuredUrl) {
    if (process.env.NODE_ENV === "production") {
      logOperationalFailure({
        operation: "database.configure",
        status: "invalid",
        failureCode: "DATABASE_CONFIGURATION_FAILED",
      });
      throw new Error("Database configuration failed.");
    }
    return getServerDatabase();
  }

  try {
    globalForAthena.__athenaAuthDatabase = createDatabase(configuredUrl);
  } catch (error) {
    logOperationalFailure({
      operation: "database.connect",
      error,
      status: "unavailable",
      failureCode: "DATABASE_CONNECTION_FAILED",
    });
    throw new Error("Database connection failed.");
  }
  return globalForAthena.__athenaAuthDatabase;
}
