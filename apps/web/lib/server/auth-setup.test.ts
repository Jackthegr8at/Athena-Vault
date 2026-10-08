import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETUP_AUTHORIZATION_ERROR } from "./auth-setup-token";

const mocks = vi.hoisted(() => ({
  getServerDatabase: vi.fn(),
  getAuthDatabase: vi.fn(),
  requireMfaEnrolledUser: vi.fn(),
  requireWritableAuthenticatedUser: vi.fn(),
  assertPasswordNotCompromised: vi.fn(async () => undefined),
}));

vi.mock("./database", () => ({ getServerDatabase: mocks.getServerDatabase, getAuthDatabase: mocks.getAuthDatabase }));
vi.mock("./auth-session", () => ({
  requireMfaEnrolledUser: mocks.requireMfaEnrolledUser,
  requireWritableAuthenticatedUser: mocks.requireWritableAuthenticatedUser,
}));
vi.mock("./password-breach", () => ({ assertPasswordNotCompromised: mocks.assertPasswordNotCompromised }));
vi.mock("better-auth/crypto", () => ({ hashPassword: vi.fn(async () => "hashed-password") }));

import { acceptInvitation, createInvitation, isFirstRun, setupFirstUser } from "./auth-setup";

const originalSetupToken = process.env.ATHENA_AUTH_SETUP_TOKEN;
const firstRunCompleteMessage = "First-run setup has already completed.";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.getAuthDatabase.mockImplementation(() => mocks.getServerDatabase());
  mocks.requireWritableAuthenticatedUser.mockReset();
  mocks.requireMfaEnrolledUser.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  if (originalSetupToken === undefined) {
    delete process.env.ATHENA_AUTH_SETUP_TOKEN;
  } else {
    process.env.ATHENA_AUTH_SETUP_TOKEN = originalSetupToken;
  }
});

describe("setupFirstUser authorization", () => {
  it.each([undefined, "wrong-token"])("rejects a missing or invalid token generically", async (setupToken) => {
    const configuredToken = "configured-setup-token";
    process.env.ATHENA_AUTH_SETUP_TOKEN = configuredToken;

    const error = await setupFirstUser({
      email: "owner@example.com",
      password: "correct horse battery staple 1",
      setupToken,
    }).catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(SETUP_AUTHORIZATION_ERROR);
    expect((error as Error).message).not.toContain(configuredToken);
    expect(mocks.getServerDatabase).not.toHaveBeenCalled();
  });

  it("refuses bootstrap after a locked credential count detects an existing account without opening the app transaction", async () => {
    process.env.ATHENA_AUTH_SETUP_TOKEN = "configured-setup-token";
    const authTx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 1 }]) })),
      })),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const appDb = { transaction: vi.fn() };
    const authDb = {
      transaction: vi.fn(async (callback: (transaction: typeof authTx) => Promise<void>) => callback(authTx)),
    };
    mocks.getServerDatabase.mockReturnValue(appDb);
    mocks.getAuthDatabase.mockReturnValue(authDb);

    await expect(setupFirstUser({
      email: "owner@example.com",
      password: "correct horse battery staple 1",
      setupToken: "configured-setup-token",
    })).rejects.toThrow(firstRunCompleteMessage);
    expect(authDb.transaction).toHaveBeenCalledOnce();
    expect(authTx.execute).toHaveBeenCalledOnce();
    expect(authTx.select).toHaveBeenCalledOnce();
    expect(appDb.transaction).not.toHaveBeenCalled();
    expect(authTx.insert).not.toHaveBeenCalled();
    expect(authTx.update).not.toHaveBeenCalled();
  });

  it("recognizes an empty schema as first run", async () => {
    const select = vi.fn().mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 0 }]) })),
    });
    mocks.getServerDatabase.mockReturnValue({ select });

    await expect(isFirstRun()).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("creates the first owner when the database has no users", async () => {
    process.env.ATHENA_AUTH_SETUP_TOKEN = "configured-setup-token";

    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 0 }]) })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
      });
    const insertedValues: unknown[] = [];
    const tx = {
      execute: vi.fn(async () => undefined),
      select,
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => {
          insertedValues.push(values);
          return {
            onConflictDoUpdate: vi.fn(async () => undefined),
            onConflictDoNothing: vi.fn(async () => undefined),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    };
    const db = {
      select,
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    };
    mocks.getServerDatabase.mockReturnValue(db);

    await expect(setupFirstUser({
      email: "owner@example.com",
      password: "correct horse battery staple 1",
      setupToken: "configured-setup-token",
    })).resolves.toBeUndefined();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledTimes(5);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(insertedValues).toHaveLength(5);

    const [user, primaryOwner, authUser, workspace, account] = insertedValues as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(primaryOwner).toEqual({ id: 1, ownerId: user.id });
    expect(user).toEqual(expect.objectContaining({
      id: expect.any(String),
      email: "owner@example.com",
      displayName: null,
    }));
    expect(authUser).toEqual(expect.objectContaining({
      id: user.id,
      email: "owner@example.com",
    }));
    expect(workspace).toEqual({ authUserId: user.id, athenaUserId: user.id });
    expect(account).toEqual(expect.objectContaining({
      issuer: "local:credential",
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: "hashed-password",
    }));
    expect(mocks.assertPasswordNotCompromised).toHaveBeenCalledWith("correct horse battery staple 1");
  });

  it("acquires the first-run advisory lock before counting credentials inside the auth transaction", async () => {
    process.env.ATHENA_AUTH_SETUP_TOKEN = "configured-setup-token";
    const events: string[] = [];
    const authTx = {
      execute: vi.fn(async () => { events.push("auth:lock"); }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => {
            events.push("auth:credential-count");
            return [{ count: 0 }];
          }),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(async () => undefined),
          onConflictDoNothing: vi.fn(async () => undefined),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    };
    const appTx = {
      execute: vi.fn(async () => { events.push("app:context"); }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => {
            events.push("app:owner-lookup");
            return [];
          }) })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(async () => undefined),
          onConflictDoUpdate: vi.fn(async () => undefined),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    };
    const appDb = {
      transaction: vi.fn(async (callback: (transaction: typeof appTx) => Promise<void>) => {
        events.push("app:begin");
        await callback(appTx);
        events.push("app:commit");
      }),
    };
    const authDb = {
      transaction: vi.fn(async (callback: (transaction: typeof authTx) => Promise<void>) => {
        events.push("auth:begin");
        await callback(authTx);
        events.push("auth:commit");
      }),
    };
    mocks.getServerDatabase.mockReturnValue(appDb);
    mocks.getAuthDatabase.mockReturnValue(authDb);

    await expect(setupFirstUser({
      email: "owner@example.com",
      password: "correct horse battery staple 1",
      setupToken: "configured-setup-token",
    })).resolves.toBeUndefined();

    expect(events.indexOf("auth:begin")).toBeLessThan(events.indexOf("auth:lock"));
    expect(events.indexOf("auth:lock")).toBeLessThan(events.indexOf("auth:credential-count"));
    expect(events.indexOf("auth:credential-count")).toBeLessThan(events.indexOf("app:begin"));
    expect(events.indexOf("app:owner-lookup")).toBeGreaterThan(events.indexOf("auth:credential-count"));
    expect(authTx.select).toHaveBeenCalledOnce();
    expect(appTx.select).toHaveBeenCalledOnce();
  });

  it("commits the app owner before the auth workspace link with split database roles", async () => {
    process.env.ATHENA_AUTH_SETUP_TOKEN = "configured-setup-token";

    const appSelect = vi.fn().mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
      })),
    });
    const authSelect = vi.fn().mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 0 }]) })),
    });
    const events: string[] = [];
    const createTransaction = (role: "app" | "auth") => {
      const tx = {
        execute: vi.fn(async () => { events.push(`${role}:execute`); }),
        select: vi.fn(() => {
          events.push(`${role}:select`);
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => role === "auth"
                ? Promise.resolve([{ count: 0 }])
                : { limit: vi.fn(async () => []) }),
            })),
          };
        }),
        insert: vi.fn(() => ({
          values: vi.fn((values: unknown) => {
            void values;
            events.push(`${role}:insert`);
            return {
              onConflictDoUpdate: vi.fn(async () => { events.push(`${role}:upsert`); }),
              onConflictDoNothing: vi.fn(async () => { events.push(`${role}:ignore`); }),
            };
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: vi.fn(async () => { events.push(`${role}:update`); }) })),
        })),
      };
      return {
        tx,
        db: {
          transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => {
            events.push(`${role}:begin`);
            await callback(tx);
            events.push(`${role}:commit`);
          }),
        },
      };
    };
    const app = createTransaction("app");
    const auth = createTransaction("auth");
    const appDb = { select: appSelect, ...app.db };
    const authDb = { select: authSelect, ...auth.db };
    mocks.getServerDatabase.mockReturnValue(appDb);
    mocks.getAuthDatabase.mockReturnValue(authDb);

    await expect(setupFirstUser({
      email: "owner@example.com",
      password: "correct horse battery staple 1",
      setupToken: "configured-setup-token",
    })).resolves.toBeUndefined();

    expect(appDb.transaction).toHaveBeenCalledOnce();
    expect(authDb.transaction).toHaveBeenCalledOnce();
    expect(events.indexOf("auth:execute")).toBeLessThan(events.indexOf("auth:select"));
    expect(events.indexOf("auth:select")).toBeLessThan(events.indexOf("app:begin"));
    expect(events.indexOf("app:commit")).toBeLessThan(events.lastIndexOf("auth:insert"));
  });

  it("serializes concurrent first-run setup and rejects the second request after the first commits", async () => {
    process.env.ATHENA_AUTH_SETUP_TOKEN = "unit-test-setup-token";
    const firstCredentialInserted = deferred();
    const secondLockWaiting = deferred();
    const releaseFirstTransaction = deferred();
    const firstCommitted = deferred();
    const state = {
      credentialCount: 0,
      lockOwner: 0,
      nextAuthTransaction: 0,
    };
    let appTransactionCount = 0;
    let authWriteCount = 0;

    function createAuthTransaction(transactionNumber: number) {
      return {
        execute: vi.fn(async () => {
          if (state.lockOwner === 0) {
            state.lockOwner = transactionNumber;
            return;
          }
          secondLockWaiting.resolve();
          await firstCommitted.promise;
          state.lockOwner = transactionNumber;
        }),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [{ count: state.credentialCount }]),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((values: unknown) => {
            authWriteCount += 1;
            const providerId = values && typeof values === "object"
              ? (values as { readonly providerId?: unknown }).providerId
              : undefined;
            if (providerId === "credential") firstCredentialInserted.resolve();
            return {
              onConflictDoUpdate: vi.fn(async () => undefined),
              onConflictDoNothing: vi.fn(async () => undefined),
            };
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: vi.fn(async () => { authWriteCount += 1; }) })),
        })),
      };
    }

    const authDb = {
      transaction: vi.fn(async (callback: (transaction: ReturnType<typeof createAuthTransaction>) => Promise<void>) => {
        const transactionNumber = ++state.nextAuthTransaction;
        const transaction = createAuthTransaction(transactionNumber);
        await callback(transaction);
        if (transactionNumber === 1) {
          await releaseFirstTransaction.promise;
          state.credentialCount = 1;
          state.lockOwner = 0;
          firstCommitted.resolve();
        }
      }),
    };

    const appTx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(async () => undefined),
          onConflictDoUpdate: vi.fn(async () => undefined),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    };
    const appDb = {
      transaction: vi.fn(async (callback: (transaction: typeof appTx) => Promise<void>) => {
        appTransactionCount += 1;
        await callback(appTx);
      }),
    };
    mocks.getServerDatabase.mockReturnValue(appDb);
    mocks.getAuthDatabase.mockReturnValue(authDb);

    const firstSetup = setupFirstUser({
      email: "first@example.test",
      password: "unit-test-password-1",
      setupToken: "unit-test-setup-token",
    });
    await firstCredentialInserted.promise;

    const secondSetup = setupFirstUser({
      email: "second@example.test",
      password: "unit-test-password-2",
      setupToken: "unit-test-setup-token",
    });
    await secondLockWaiting.promise;

    expect(appTransactionCount).toBe(1);
    expect(authWriteCount).toBe(4);

    const firstResult = expect(firstSetup).resolves.toBeUndefined();
    const secondResult = expect(secondSetup).rejects.toThrow(firstRunCompleteMessage);
    releaseFirstTransaction.resolve();
    await firstResult;
    await secondResult;

    expect(appTransactionCount).toBe(1);
    expect(authWriteCount).toBe(4);
    expect(state.credentialCount).toBe(1);
  });

  it("blocks invitation acceptance before opening its write transaction when screening rejects the password", async () => {
    const invitation = { id: "invitation-a", email: "invitee@example.com", displayName: null, usedAt: null };
    const select = vi.fn().mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn(async () => [invitation]) })),
    });
    const db = { select, transaction: vi.fn() };
    mocks.getServerDatabase.mockReturnValue(db);
    mocks.assertPasswordNotCompromised.mockRejectedValueOnce(new Error("password was compromised"));

    await expect(acceptInvitation({
      token: "invitation-token",
      email: "invitee@example.com",
      password: "correct horse battery staple 1",
    })).rejects.toThrow("password was compromised");

    expect(mocks.assertPasswordNotCompromised).toHaveBeenCalledWith("correct horse battery staple 1");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects demo invitation creation before opening a database write", async () => {
    const error = new Error("This workspace is read-only.");
    mocks.requireWritableAuthenticatedUser.mockRejectedValue(error);

    await expect(createInvitation({ email: "visitor@example.com" })).rejects.toBe(error);
    expect(mocks.getServerDatabase).not.toHaveBeenCalled();
  });
  it("classifies invitation creation as an explicit MFA setup exception", async () => {
    const user = { authUserId: "owner-id" };
    const error = new Error("stop after MFA classification");
    mocks.requireWritableAuthenticatedUser.mockResolvedValue(user);
    mocks.requireMfaEnrolledUser.mockImplementation((_user: unknown, requireTwoFactor: boolean) => {
      expect(requireTwoFactor).toBe(false);
      throw error;
    });

    await expect(createInvitation({ email: "visitor@example.com" })).rejects.toBe(error);
    expect(mocks.requireMfaEnrolledUser).toHaveBeenCalledWith(user, false);
    expect(mocks.getServerDatabase).not.toHaveBeenCalled();
  });
});
