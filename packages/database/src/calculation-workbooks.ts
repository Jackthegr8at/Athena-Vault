import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import { auditEvents, calculationWorkbooks } from "./drizzle-schema";

export const CALCULATION_WORKBOOK_NAME_MAX_LENGTH = 80;
export const CALCULATION_WORKBOOK_SNAPSHOT_MAX_BYTES = 5_000_000;

export interface CalculationWorkbookCreateInput {
  readonly name: string;
  readonly snapshot?: CalculationWorkbookSnapshotInput;
}

export interface CalculationWorkbookUpdateInput {
  readonly name: string;
  readonly snapshot: CalculationWorkbookSnapshotInput;
}

export type CalculationWorkbookSnapshotInput = Record<string, unknown>;

export interface CalculationWorkbookListView {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: Date;
  readonly createdAt: Date;
}

export interface CalculationWorkbookView extends CalculationWorkbookListView {
  readonly ownerId: string;
  readonly snapshot: CalculationWorkbookSnapshotInput;
}

type WorkbookQuery = Database;
type WorkbookTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assertOwnerId(ownerId: string): void {
  if (!ownerId.trim()) throw new RangeError("Owner ID is required.");
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new RangeError("Workbook name is required.");
  if (normalized.length > CALCULATION_WORKBOOK_NAME_MAX_LENGTH) {
    throw new RangeError(`Workbook name must be ${CALCULATION_WORKBOOK_NAME_MAX_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function normalizeSnapshot(snapshot: CalculationWorkbookSnapshotInput): CalculationWorkbookSnapshotInput {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new RangeError("Workbook snapshot must be a JSON object.");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    throw new RangeError("Workbook snapshot must be JSON serializable.");
  }
  if (new TextEncoder().encode(serialized).byteLength > CALCULATION_WORKBOOK_SNAPSHOT_MAX_BYTES) {
    throw new RangeError("Workbook snapshot is too large.");
  }
  return snapshot;
}

function toListView(row: Pick<typeof calculationWorkbooks.$inferSelect, "id" | "name" | "updatedAt" | "createdAt">): CalculationWorkbookListView {
  return { id: row.id, name: row.name, updatedAt: row.updatedAt, createdAt: row.createdAt };
}

function toView(row: typeof calculationWorkbooks.$inferSelect): CalculationWorkbookView {
  return { ...toListView(row), ownerId: row.ownerId, snapshot: row.snapshot };
}

async function audit(
  queryDb: WorkbookQuery | WorkbookTransaction,
  ownerId: string,
  action: "created" | "updated" | "deleted",
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await queryDb.insert(auditEvents).values({
    ownerId,
    actorUserId: ownerId,
    action,
    entityType: "calculation_workbook",
    entityId,
    metadata,
  });
}

async function listNames(queryDb: WorkbookQuery | WorkbookTransaction, ownerId: string): Promise<Set<string>> {
  const rows = await queryDb
    .select({ name: calculationWorkbooks.name })
    .from(calculationWorkbooks)
    .where(eq(calculationWorkbooks.ownerId, ownerId));
  return new Set(rows.map((row) => row.name));
}

function nextDefaultName(existingNames: Set<string>): string {
  if (!existingNames.has("Workbook")) return "Workbook";
  let suffix = 2;
  while (existingNames.has(`Workbook ${suffix}`)) suffix += 1;
  return `Workbook ${suffix}`;
}

export function createCalculationWorkbooksRepository(database: Database) {
  return {
    async listByOwner(ownerId: string): Promise<CalculationWorkbookListView[]> {
      assertOwnerId(ownerId);
      const rows = await database
        .select({
          id: calculationWorkbooks.id,
          name: calculationWorkbooks.name,
          updatedAt: calculationWorkbooks.updatedAt,
          createdAt: calculationWorkbooks.createdAt,
        })
        .from(calculationWorkbooks)
        .where(eq(calculationWorkbooks.ownerId, ownerId))
        .orderBy(asc(calculationWorkbooks.name), desc(calculationWorkbooks.updatedAt));
      return rows.map(toListView);
    },

    async getById(ownerId: string, workbookId: string): Promise<CalculationWorkbookView | null> {
      assertOwnerId(ownerId);
      if (!workbookId.trim()) throw new RangeError("Workbook ID is required.");
      const [row] = await database
        .select()
        .from(calculationWorkbooks)
        .where(and(eq(calculationWorkbooks.ownerId, ownerId), eq(calculationWorkbooks.id, workbookId)))
        .limit(1);
      return row ? toView(row) : null;
    },

    async create(ownerId: string, input: CalculationWorkbookCreateInput): Promise<CalculationWorkbookView> {
      assertOwnerId(ownerId);
      const snapshot = normalizeSnapshot(input.snapshot ?? {});
      return database.transaction(async (transaction) => {
        const existingNames = await listNames(transaction, ownerId);
        const name = normalizeName(input.name || nextDefaultName(existingNames));
        const [row] = await transaction
          .insert(calculationWorkbooks)
          .values({ ownerId, name, snapshot })
          .returning();
        if (!row) throw new Error("Workbook insert returned no row.");
        await audit(transaction, ownerId, "created", row.id, { name: row.name });
        return toView(row);
      });
    },

    async update(ownerId: string, workbookId: string, input: CalculationWorkbookUpdateInput): Promise<CalculationWorkbookView> {
      assertOwnerId(ownerId);
      if (!workbookId.trim()) throw new RangeError("Workbook ID is required.");
      const name = normalizeName(input.name);
      const snapshot = normalizeSnapshot(input.snapshot);
      return database.transaction(async (transaction) => {
        const [row] = await transaction
          .update(calculationWorkbooks)
          .set({ name, snapshot, updatedAt: new Date() })
          .where(and(eq(calculationWorkbooks.ownerId, ownerId), eq(calculationWorkbooks.id, workbookId)))
          .returning();
        if (!row) throw new Error("Workbook not found.");
        await audit(transaction, ownerId, "updated", row.id, { name: row.name });
        return toView(row);
      });
    },

    async delete(ownerId: string, workbookId: string): Promise<void> {
      assertOwnerId(ownerId);
      if (!workbookId.trim()) throw new RangeError("Workbook ID is required.");
      await database.transaction(async (transaction) => {
        const [row] = await transaction
          .delete(calculationWorkbooks)
          .where(and(eq(calculationWorkbooks.ownerId, ownerId), eq(calculationWorkbooks.id, workbookId)))
          .returning({ id: calculationWorkbooks.id });
        if (!row) throw new Error("Workbook not found.");
        await audit(transaction, ownerId, "deleted", row.id, {});
      });
    },
  };
}
