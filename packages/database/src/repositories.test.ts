import { describe, expect, it } from "vitest";
import { InMemoryAccountRepository, InMemoryInstitutionRepository } from "./repositories";

describe("repository contracts", () => {
  it("keeps records owner-scoped", async () => {
    const institutions = new InMemoryInstitutionRepository();
    await institutions.create({ ownerId: "owner-a", name: "Tangerine", currency: "CAD" });
    await institutions.create({ ownerId: "owner-b", name: "Tangerine", currency: "CAD" });
    expect((await institutions.listByOwner("owner-a")).length).toBe(1);
    expect((await institutions.listByOwner("owner-c")).length).toBe(0);
  });

  it("updates balances without allowing cross-owner access", async () => {
    const accounts = new InMemoryAccountRepository();
    const account = await accounts.create({ ownerId: "owner-a", institutionId: "institution", name: "Checking", kind: "checking", balanceMinor: 1000 });
    await expect(accounts.updateBalance("owner-b", account.id, 0)).rejects.toThrow("Account not found");
    await accounts.updateBalance("owner-a", account.id, 2200);
    expect((await accounts.listByOwner("owner-a"))[0]?.balanceMinor).toBe(2200);
  });

  it("accepts the current RDSP account kind in the exported repository contract", async () => {
    const accounts = new InMemoryAccountRepository();
    const account = await accounts.create({ ownerId: "owner-a", institutionId: "institution", name: "Disability savings", kind: "rdsp", balanceMinor: 75_000 });

    expect(account.kind).toBe("rdsp");
  });
});
