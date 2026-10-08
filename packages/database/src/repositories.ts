import type { AccountRecord, InstitutionRecord } from "./schema";

export interface InstitutionRepository {
  listByOwner(ownerId: string): Promise<InstitutionRecord[]>;
  create(input: Omit<InstitutionRecord, "id">): Promise<InstitutionRecord>;
}

export interface AccountRepository {
  listByOwner(ownerId: string): Promise<AccountRecord[]>;
  create(input: Omit<AccountRecord, "id">): Promise<AccountRecord>;
  updateBalance(ownerId: string, accountId: string, balanceMinor: number, asOf: string): Promise<void>;
}

export class InMemoryInstitutionRepository implements InstitutionRepository {
  private readonly rows: InstitutionRecord[] = [];
  async listByOwner(ownerId: string) { return this.rows.filter((row) => row.ownerId === ownerId); }
  async create(input: Omit<InstitutionRecord, "id">) { const row = { ...input, id: crypto.randomUUID() }; this.rows.push(row); return row; }
}

export class InMemoryAccountRepository implements AccountRepository {
  private readonly rows: AccountRecord[] = [];
  async listByOwner(ownerId: string) { return this.rows.filter((row) => row.ownerId === ownerId); }
  async create(input: Omit<AccountRecord, "id">) { const row = { ...input, id: crypto.randomUUID() }; this.rows.push(row); return row; }
  async updateBalance(ownerId: string, accountId: string, balanceMinor: number) { const row = this.rows.find((item) => item.id === accountId && item.ownerId === ownerId); if (!row) throw new Error("Account not found"); row.balanceMinor = balanceMinor; }
}
