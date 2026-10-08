import { describe, expect, it } from "vitest";
import {
  DatabaseVerificationError,
  verifyPublicDatabase,
  type ReadOnlyVerificationDatabase,
} from "../../../../scripts/docker/verify-database";
import type { MigrationDetails, MigrationInspection, MigrationQueryClient, MigrationRow } from "./catalog";

type QueryHandler = (statement: string) => Promise<readonly MigrationRow[]>;

function verificationDatabase(
  handle: QueryHandler,
): {
  readonly database: ReadOnlyVerificationDatabase;
  readonly transactions: string[][];
  readonly savepoints: string[][];
} {
  const transactions: string[][] = [];
  const savepoints: string[][] = [];
  const database: ReadOnlyVerificationDatabase = {
    readOnly: async (work) => {
      const statements: string[] = ["SET TRANSACTION READ ONLY;"];
      transactions.push(statements);
      const transaction: MigrationQueryClient = {
        query: async <Row extends MigrationRow = MigrationRow>(statement: string) => {
          statements.push(statement);
          return await handle(statement) as readonly Row[];
        },
      };
      await work({
        ...transaction,
        savepoint: async (savepointWork) => {
          const nestedStatements: string[] = [];
          savepoints.push(nestedStatements);
          await savepointWork({
            query: async <Row extends MigrationRow = MigrationRow>(statement: string) => {
              nestedStatements.push(statement);
              return await handle(statement) as readonly Row[];
            },
          });
        },
      });
    },
  };
  return { database, transactions, savepoints };
}

const completeBaseline: MigrationInspection<MigrationDetails> = { state: "complete", details: {} };
const completeInspector = async (_database: MigrationQueryClient) => completeBaseline;

function permissionDenied(): Error & { readonly code: string } {
  return Object.assign(new Error("permission denied"), { code: "42501" });
}

describe("public database verifier", () => {
  it("checks the baseline and least-privilege boundaries only in read-only transactions", async () => {
    const { database, transactions, savepoints } = verificationDatabase(async (statement) => {
      const normalized = statement.toLowerCase();
      if (normalized.includes("exists (select 1 from public.accounts)")) {
        return [{ hasVisibleAccounts: false }];
      }
      if (normalized.includes("exists (select 1 from public.auth_users)")) {
        return [{ canReadAuthUsers: true }];
      }
      if (normalized.includes("from public.auth_verifications") || normalized.includes("from public.accounts limit 0")) {
        throw permissionDenied();
      }
      return [];
    });

    await expect(verifyPublicDatabase(database, completeInspector)).resolves.toBeUndefined();
    expect(transactions).toHaveLength(3);
    expect(savepoints).toEqual([
      ["SELECT 1 FROM public.auth_verifications LIMIT 0;"],
      ["SELECT 1 FROM public.accounts LIMIT 0;"],
    ]);
    expect(transactions.every(([first]) => first === "SET TRANSACTION READ ONLY;")).toBe(true);
    expect(transactions[1]).toContain("SET LOCAL ROLE athena_app;");
    expect(transactions[1]).toContain("SELECT set_config('app.owner_id', '', true);");
    expect(transactions[2]).toContain("SET LOCAL ROLE athena_auth;");
    expect(
      [...transactions.flat(), ...savepoints.flat()]
        .some((statement) => /\b(insert|update|delete|alter|drop|create)\b/i.test(statement)),
    ).toBe(false);
  });

  it("fails closed when the public baseline is not complete", async () => {
    const { database, transactions } = verificationDatabase(async () => []);
    const inspectPartial = async () => ({ state: "partial" as const, details: {} });

    await expect(verifyPublicDatabase(database, inspectPartial))
      .rejects.toEqual(new DatabaseVerificationError("current-schema-baseline"));
    expect(transactions).toHaveLength(1);
  });

  it("rejects visible owner rows when the application owner context is empty", async () => {
    const { database } = verificationDatabase(async (statement) => {
      if (statement.toLowerCase().includes("exists (select 1 from public.accounts)")) {
        return [{ hasVisibleAccounts: true }];
      }
      return [];
    });

    await expect(verifyPublicDatabase(database, completeInspector))
      .rejects.toEqual(new DatabaseVerificationError("app-owner-isolation"));
  });

  it("fails if the application role can query an auth-only table", async () => {
    const { database } = verificationDatabase(async (statement) => {
      if (statement.toLowerCase().includes("exists (select 1 from public.accounts)")) {
        return [{ hasVisibleAccounts: false }];
      }
      if (statement.toLowerCase().includes("from public.auth_verifications")) return [];
      return [];
    });

    await expect(verifyPublicDatabase(database, completeInspector))
      .rejects.toEqual(new DatabaseVerificationError("app-auth-boundary"));
  });

  it("fails if the authentication role cannot query auth tables", async () => {
    const { database } = verificationDatabase(async (statement) => {
      if (statement.toLowerCase().includes("exists (select 1 from public.accounts)")) {
        return [{ hasVisibleAccounts: false }];
      }
      if (statement.toLowerCase().includes("exists (select 1 from public.auth_users)")) {
        throw permissionDenied();
      }
      if (statement.toLowerCase().includes("from public.auth_verifications") || statement.toLowerCase().includes("from public.accounts limit 0")) {
        throw permissionDenied();
      }
      return [];
    });

    await expect(verifyPublicDatabase(database, completeInspector))
      .rejects.toEqual(new DatabaseVerificationError("auth-role-access"));
  });

  it("fails if the authentication role can query owner financial tables", async () => {
    const { database } = verificationDatabase(async (statement) => {
      const normalized = statement.toLowerCase();
      if (normalized.includes("from public.accounts limit 0")) return [];
      if (normalized.includes("exists (select 1 from public.accounts)")) return [{ hasVisibleAccounts: false }];
      if (normalized.includes("exists (select 1 from public.auth_users)")) return [{ canReadAuthUsers: false }];
      if (normalized.includes("from public.auth_verifications")) {
        throw permissionDenied();
      }
      return [];
    });

    await expect(verifyPublicDatabase(database, completeInspector))
      .rejects.toEqual(new DatabaseVerificationError("auth-role-boundary"));
  });
});
