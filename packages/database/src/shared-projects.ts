import { calculateSharedProjectExpenseTotalMinor, calculateSharedProjectFinance, type SharedProjectPaymentStatus } from "@athena/finance-engine";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "./client";
import { auditEvents, sharedProjectExpenses, sharedProjectParticipants, sharedProjects } from "./drizzle-schema";

type ProjectQuery = Database;
type ProjectTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface SharedProjectCreateInput {
  readonly name: string;
  readonly projectYear: number;
  readonly ownerParticipates: boolean;
  readonly note?: string | null;
}

export type SharedProjectUpdateInput = SharedProjectCreateInput;

export interface SharedProjectCloneInput {
  readonly name: string;
  readonly projectYear: number;
}

export interface SharedProjectExpenseCreateInput {
  readonly description: string;
  readonly expenseOn?: string | null;
  readonly quantity?: number;
  readonly amountMinor: number;
  readonly note?: string | null;
}

export type SharedProjectExpenseUpdateInput = SharedProjectExpenseCreateInput;

export interface SharedProjectParticipantCreateInput {
  readonly name: string;
  readonly paidMinor: number;
}

export type SharedProjectParticipantUpdateInput = SharedProjectParticipantCreateInput;

export type SharedProjectCollectionStatus = "not_ready" | "no_expenses" | "unpaid" | "partial" | "paid" | "overpaid";

export interface SharedProjectExpenseView {
  readonly id: string;
  readonly projectId: string;
  readonly description: string;
  readonly expenseOn: string | null;
  readonly quantity: number;
  readonly amountMinor: number;
  readonly totalMinor: number;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SharedProjectParticipantView {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly paidMinor: number;
  readonly paidAt: Date | null;
  readonly owedMinor: number | null;
  readonly remainingMinor: number | null;
  readonly extraMinor: number | null;
  readonly status: SharedProjectPaymentStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SharedProjectSummaryView {
  readonly totalExpensesMinor: number;
  readonly participantCount: number;
  readonly splitCount: number;
  readonly sharePerPersonMinor: number | null;
  readonly ownerShareMinor: number | null;
  readonly expectedFromOthersMinor: number | null;
  readonly receivedFromOthersMinor: number;
  readonly outstandingMinor: number | null;
  readonly overpaymentReceivedMinor: number | null;
  readonly roundingDifferenceMinor: number | null;
  readonly netCashResultMinor: number;
  readonly canCalculate: boolean;
  readonly collectionStatus: SharedProjectCollectionStatus;
}

export interface SharedProjectListView {
  readonly id: string;
  readonly name: string;
  readonly projectYear: number;
  readonly ownerParticipates: boolean;
  readonly note: string | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly totalExpensesMinor: number;
  readonly receivedFromOthersMinor: number;
  readonly outstandingMinor: number | null;
  readonly participantCount: number;
  readonly collectionStatus: SharedProjectCollectionStatus;
}

export interface SharedProjectView extends SharedProjectListView {
  readonly summary: SharedProjectSummaryView;
  readonly expenses: readonly SharedProjectExpenseView[];
  readonly participants: readonly SharedProjectParticipantView[];
}

function assertOwnerId(ownerId: string): void {
  if (!ownerId.trim()) throw new RangeError("Owner ID is required.");
}

function assertProjectYear(projectYear: number): void {
  if (!Number.isSafeInteger(projectYear) || projectYear < 1900 || projectYear > 2200) throw new RangeError("Project year must be between 1900 and 2200.");
}

function normalizeRequired(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new RangeError(`${label} is required.`);
  if (normalized.length > maxLength) throw new RangeError(`${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function normalizeNote(note: string | null | undefined, label: string): string | null {
  const normalized = note?.trim() ?? "";
  if (normalized.length > 500) throw new RangeError(`${label} must be 500 characters or fewer.`);
  return normalized || null;
}

function assertMinor(value: number, label: string, positive: boolean): void {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError(`${label} must be ${positive ? "a positive" : "a non-negative"} safe integer.`);
  }
}

function assertQuantity(value: number, label = "Expense quantity"): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive whole safe integer.`);
}

function assertIsoDate(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must be a valid ISO date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new RangeError(`${label} must be a valid ISO date.`);
}

function normalizeProjectInput(input: SharedProjectCreateInput): { name: string; projectYear: number; ownerParticipates: boolean; note: string | null } {
  assertProjectYear(input.projectYear);
  return {
    name: normalizeRequired(input.name, "Project name", 120),
    projectYear: input.projectYear,
    ownerParticipates: input.ownerParticipates,
    note: normalizeNote(input.note, "Project note"),
  };
}

function normalizeCloneInput(input: SharedProjectCloneInput): { name: string; projectYear: number } {
  assertProjectYear(input.projectYear);
  return {
    name: normalizeRequired(input.name, "Project name", 120),
    projectYear: input.projectYear,
  };
}

function normalizeExpenseInput(input: SharedProjectExpenseCreateInput): { description: string; expenseOn: string | null; quantity: number; amountMinor: number; note: string | null } {
  const quantity = input.quantity ?? 1;
  assertQuantity(quantity);
  assertMinor(input.amountMinor, "Expense amount", true);
  calculateSharedProjectExpenseTotalMinor(quantity, input.amountMinor);
  assertIsoDate(input.expenseOn, "Expense date");
  return {
    description: normalizeRequired(input.description, "Expense description", 240),
    expenseOn: input.expenseOn ?? null,
    quantity,
    amountMinor: input.amountMinor,
    note: normalizeNote(input.note, "Expense note"),
  };
}

function normalizeParticipantInput(input: SharedProjectParticipantCreateInput): { name: string; paidMinor: number } {
  assertMinor(input.paidMinor, "Paid amount", false);
  return { name: normalizeRequired(input.name, "Participant name", 120), paidMinor: input.paidMinor };
}

async function ownerProject(queryDb: ProjectQuery | ProjectTransaction, ownerId: string, projectId: string) {
  const [project] = await queryDb.select().from(sharedProjects)
    .where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId)))
    .limit(1);
  if (!project) throw new Error("Project not found.");
  return project;
}

async function ownerExpense(queryDb: ProjectQuery | ProjectTransaction, ownerId: string, expenseId: string, projectId?: string) {
  const [expense] = await queryDb.select().from(sharedProjectExpenses)
    .where(and(
      eq(sharedProjectExpenses.ownerId, ownerId),
      eq(sharedProjectExpenses.id, expenseId),
      ...(projectId ? [eq(sharedProjectExpenses.projectId, projectId)] : []),
    ))
    .limit(1);
  if (!expense) throw new Error("Project expense not found.");
  return expense;
}

async function ownerParticipant(queryDb: ProjectQuery | ProjectTransaction, ownerId: string, participantId: string, projectId?: string) {
  const [participant] = await queryDb.select().from(sharedProjectParticipants)
    .where(and(
      eq(sharedProjectParticipants.ownerId, ownerId),
      eq(sharedProjectParticipants.id, participantId),
      ...(projectId ? [eq(sharedProjectParticipants.projectId, projectId)] : []),
    ))
    .limit(1);
  if (!participant) throw new Error("Project participant not found.");
  return participant;
}

async function audit(
  queryDb: ProjectQuery | ProjectTransaction,
  ownerId: string,
  action: "created" | "updated" | "deleted",
  entityType: "shared_project" | "shared_project_expense" | "shared_project_participant" | "shared_project_payment",
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await queryDb.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action, entityType, entityId, metadata });
}

function collectionStatus(totalExpensesMinor: number, summary: ReturnType<typeof calculateSharedProjectFinance>["summary"]): SharedProjectCollectionStatus {
  if (!summary.canCalculate) return "not_ready";
  if (totalExpensesMinor === 0) return "no_expenses";
  if ((summary.overpaymentReceivedMinor ?? 0) > 0) return "overpaid";
  if ((summary.outstandingMinor ?? 0) > 0 && summary.receivedFromOthersMinor > 0) return "partial";
  if ((summary.outstandingMinor ?? 0) > 0) return "unpaid";
  return "paid";
}

function toExpenseView(row: typeof sharedProjectExpenses.$inferSelect): SharedProjectExpenseView {
  return {
    id: row.id,
    projectId: row.projectId,
    description: row.description,
    expenseOn: row.expenseOn,
    quantity: row.quantity,
    amountMinor: row.amountMinor,
    totalMinor: calculateSharedProjectExpenseTotalMinor(row.quantity, row.amountMinor),
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProjectView(
  project: typeof sharedProjects.$inferSelect,
  expenseRows: readonly (typeof sharedProjectExpenses.$inferSelect)[],
  participantRows: readonly (typeof sharedProjectParticipants.$inferSelect)[],
): SharedProjectView {
  const finance = calculateSharedProjectFinance({
    expenses: expenseRows.map((expense) => ({ quantity: expense.quantity, amountMinor: expense.amountMinor })),
    participants: participantRows.map((participant) => ({ id: participant.id, paidMinor: participant.paidMinor })),
    ownerParticipates: project.ownerParticipates,
  });
  const participantFinance = new Map(finance.participants.map((participant) => [participant.id, participant]));
  const summary: SharedProjectSummaryView = {
    ...finance.summary,
    collectionStatus: collectionStatus(finance.summary.totalExpensesMinor, finance.summary),
  };
  const expenses = expenseRows.map(toExpenseView);
  const participants = participantRows.map((row): SharedProjectParticipantView => {
    const derived = participantFinance.get(row.id);
    if (!derived) throw new Error("Project participant calculation is inconsistent.");
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      paidMinor: row.paidMinor,
      paidAt: row.paidAt,
      owedMinor: derived.owedMinor,
      remainingMinor: derived.remainingMinor,
      extraMinor: derived.extraMinor,
      status: derived.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
  return {
    id: project.id,
    name: project.name,
    projectYear: project.projectYear,
    ownerParticipates: project.ownerParticipates,
    note: project.note,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    totalExpensesMinor: summary.totalExpensesMinor,
    receivedFromOthersMinor: summary.receivedFromOthersMinor,
    outstandingMinor: summary.outstandingMinor,
    participantCount: summary.participantCount,
    collectionStatus: summary.collectionStatus,
    summary,
    expenses,
    participants,
  };
}

function groupByProject<T extends { readonly projectId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.projectId, [...(grouped.get(row.projectId) ?? []), row]);
  return grouped;
}

export function createSharedProjectsRepository(db: Database) {
  return {
    async listProjects(ownerId: string, options?: { readonly projectYear?: number; readonly archived?: boolean }): Promise<readonly SharedProjectListView[]> {
      assertOwnerId(ownerId);
      if (options?.projectYear !== undefined) assertProjectYear(options.projectYear);
      const projectFilters = [eq(sharedProjects.ownerId, ownerId)];
      if (options?.projectYear !== undefined) projectFilters.push(eq(sharedProjects.projectYear, options.projectYear));
      if (options?.archived === true) projectFilters.push(isNotNull(sharedProjects.archivedAt));
      if (options?.archived === false) projectFilters.push(isNull(sharedProjects.archivedAt));
      const [projects, expenses, participants] = await Promise.all([
        db.select().from(sharedProjects).where(and(...projectFilters)).orderBy(desc(sharedProjects.projectYear), desc(sharedProjects.createdAt), desc(sharedProjects.id)),
        db.select().from(sharedProjectExpenses).where(eq(sharedProjectExpenses.ownerId, ownerId)).orderBy(asc(sharedProjectExpenses.expenseOn), asc(sharedProjectExpenses.createdAt), asc(sharedProjectExpenses.id)),
        db.select().from(sharedProjectParticipants).where(eq(sharedProjectParticipants.ownerId, ownerId)).orderBy(asc(sharedProjectParticipants.createdAt), asc(sharedProjectParticipants.id)),
      ]);
      const expensesByProject = groupByProject(expenses);
      const participantsByProject = groupByProject(participants);
      return projects.map((project) => {
        const view = toProjectView(project, expensesByProject.get(project.id) ?? [], participantsByProject.get(project.id) ?? []);
        return {
          id: view.id,
          name: view.name,
          projectYear: view.projectYear,
          ownerParticipates: view.ownerParticipates,
          note: view.note,
          archivedAt: view.archivedAt,
          createdAt: view.createdAt,
          updatedAt: view.updatedAt,
          totalExpensesMinor: view.totalExpensesMinor,
          receivedFromOthersMinor: view.receivedFromOthersMinor,
          outstandingMinor: view.outstandingMinor,
          participantCount: view.participantCount,
          collectionStatus: view.collectionStatus,
        };
      });
    },

    async getProject(ownerId: string, projectId: string): Promise<SharedProjectView | null> {
      assertOwnerId(ownerId);
      const project = await db.select().from(sharedProjects).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId))).limit(1);
      if (!project[0]) return null;
      const [expenses, participants] = await Promise.all([
        db.select().from(sharedProjectExpenses)
          .where(and(eq(sharedProjectExpenses.ownerId, ownerId), eq(sharedProjectExpenses.projectId, projectId)))
          .orderBy(asc(sharedProjectExpenses.expenseOn), asc(sharedProjectExpenses.createdAt), asc(sharedProjectExpenses.id)),
        db.select().from(sharedProjectParticipants)
          .where(and(eq(sharedProjectParticipants.ownerId, ownerId), eq(sharedProjectParticipants.projectId, projectId)))
          .orderBy(asc(sharedProjectParticipants.createdAt), asc(sharedProjectParticipants.id)),
      ]);
      return toProjectView(project[0], expenses, participants);
    },

    async createProject(ownerId: string, input: SharedProjectCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      const normalized = normalizeProjectInput(input);
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(sharedProjects).values({ ownerId, name: normalized.name, projectYear: normalized.projectYear, ownerParticipates: normalized.ownerParticipates, note: normalized.note }).returning({ id: sharedProjects.id });
        if (!created) throw new Error("Project could not be created.");
        await audit(tx, ownerId, "created", "shared_project", created.id, { operation: "create" });
        return created.id;
      });
    },

    async cloneProject(ownerId: string, sourceProjectId: string, input: SharedProjectCloneInput): Promise<string> {
      assertOwnerId(ownerId);
      const normalized = normalizeCloneInput(input);
      return db.transaction(async (tx) => {
        const source = await ownerProject(tx, ownerId, sourceProjectId);
        const expenseRows = await tx.select().from(sharedProjectExpenses)
          .where(and(eq(sharedProjectExpenses.ownerId, ownerId), eq(sharedProjectExpenses.projectId, sourceProjectId)))
          .orderBy(asc(sharedProjectExpenses.expenseOn), asc(sharedProjectExpenses.createdAt), asc(sharedProjectExpenses.id));
        const participantRows = await tx.select().from(sharedProjectParticipants)
          .where(and(eq(sharedProjectParticipants.ownerId, ownerId), eq(sharedProjectParticipants.projectId, sourceProjectId)))
          .orderBy(asc(sharedProjectParticipants.createdAt), asc(sharedProjectParticipants.id));
        const [created] = await tx.insert(sharedProjects).values({
          ownerId,
          name: normalized.name,
          projectYear: normalized.projectYear,
          ownerParticipates: source.ownerParticipates,
          note: null,
          archivedAt: null,
        }).returning({ id: sharedProjects.id });
        if (!created) throw new Error("Project could not be cloned.");
        await audit(tx, ownerId, "created", "shared_project", created.id, { operation: "clone", sourceProjectId });

        if (expenseRows.length > 0) {
          const createdExpenses = await tx.insert(sharedProjectExpenses).values(expenseRows.map((expense) => ({
            ownerId,
            projectId: created.id,
            description: expense.description,
            expenseOn: expense.expenseOn,
            quantity: expense.quantity,
            amountMinor: expense.amountMinor,
            note: expense.note,
          }))).returning({ id: sharedProjectExpenses.id });
          for (const expense of createdExpenses) {
            await audit(tx, ownerId, "created", "shared_project_expense", expense.id, { operation: "clone", projectId: created.id, sourceProjectId });
          }
        }

        if (participantRows.length > 0) {
          const createdParticipants = await tx.insert(sharedProjectParticipants).values(participantRows.map((participant) => ({
            ownerId,
            projectId: created.id,
            name: participant.name,
            paidMinor: 0,
            paidAt: null,
          }))).returning({ id: sharedProjectParticipants.id });
          for (const participant of createdParticipants) {
            await audit(tx, ownerId, "created", "shared_project_participant", participant.id, { operation: "clone", projectId: created.id, sourceProjectId });
          }
        }

        return created.id;
      });
    },

    async updateProject(ownerId: string, projectId: string, input: SharedProjectUpdateInput): Promise<void> {
      assertOwnerId(ownerId);
      const normalized = normalizeProjectInput(input);
      await db.transaction(async (tx) => {
        await ownerProject(tx, ownerId, projectId);
        const [updated] = await tx.update(sharedProjects).set({ name: normalized.name, projectYear: normalized.projectYear, ownerParticipates: normalized.ownerParticipates, note: normalized.note, updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId))).returning({ id: sharedProjects.id });
        if (!updated) throw new Error("Project not found.");
        await audit(tx, ownerId, "updated", "shared_project", projectId, { operation: "update" });
      });
    },

    async archiveProject(ownerId: string, projectId: string): Promise<void> {
      await this.setProjectArchived(ownerId, projectId, true);
    },

    async restoreProject(ownerId: string, projectId: string): Promise<void> {
      await this.setProjectArchived(ownerId, projectId, false);
    },

    async setProjectArchived(ownerId: string, projectId: string, archived: boolean): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        const project = await ownerProject(tx, ownerId, projectId);
        if (Boolean(project.archivedAt) === archived) throw new Error(archived ? "Project is already archived." : "Project is already active.");
        const [updated] = await tx.update(sharedProjects).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId))).returning({ id: sharedProjects.id });
        if (!updated) throw new Error("Project not found.");
        await audit(tx, ownerId, "updated", "shared_project", projectId, { operation: archived ? "archive" : "restore" });
      });
    },

    async createExpense(ownerId: string, projectId: string, input: SharedProjectExpenseCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      const normalized = normalizeExpenseInput(input);
      return db.transaction(async (tx) => {
        await ownerProject(tx, ownerId, projectId);
        const [created] = await tx.insert(sharedProjectExpenses).values({ ownerId, projectId, description: normalized.description, expenseOn: normalized.expenseOn, quantity: normalized.quantity, amountMinor: normalized.amountMinor, note: normalized.note }).returning({ id: sharedProjectExpenses.id });
        if (!created) throw new Error("Project expense could not be created.");
        await tx.update(sharedProjects).set({ updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId)));
        await audit(tx, ownerId, "created", "shared_project_expense", created.id, { operation: "create", projectId });
        return created.id;
      });
    },

    async updateExpense(ownerId: string, expenseId: string, projectId: string, input: SharedProjectExpenseUpdateInput): Promise<void> {
      assertOwnerId(ownerId);
      const normalized = normalizeExpenseInput(input);
      await db.transaction(async (tx) => {
        await ownerProject(tx, ownerId, projectId);
        await ownerExpense(tx, ownerId, expenseId, projectId);
        const [updated] = await tx.update(sharedProjectExpenses).set({ description: normalized.description, expenseOn: normalized.expenseOn, quantity: normalized.quantity, amountMinor: normalized.amountMinor, note: normalized.note, updatedAt: new Date() }).where(and(eq(sharedProjectExpenses.ownerId, ownerId), eq(sharedProjectExpenses.id, expenseId), eq(sharedProjectExpenses.projectId, projectId))).returning({ id: sharedProjectExpenses.id });
        if (!updated) throw new Error("Project expense not found.");
        await tx.update(sharedProjects).set({ updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId)));
        await audit(tx, ownerId, "updated", "shared_project_expense", expenseId, { operation: "update", projectId });
      });
    },

    async deleteExpense(ownerId: string, expenseId: string, projectId: string): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        await ownerProject(tx, ownerId, projectId);
        await ownerExpense(tx, ownerId, expenseId, projectId);
        const [deleted] = await tx.delete(sharedProjectExpenses).where(and(eq(sharedProjectExpenses.ownerId, ownerId), eq(sharedProjectExpenses.id, expenseId), eq(sharedProjectExpenses.projectId, projectId))).returning({ id: sharedProjectExpenses.id });
        if (!deleted) throw new Error("Project expense not found.");
        await tx.update(sharedProjects).set({ updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId)));
        await audit(tx, ownerId, "deleted", "shared_project_expense", expenseId, { operation: "delete", projectId });
      });
    },

    async createParticipant(ownerId: string, projectId: string, input: SharedProjectParticipantCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      const normalized = normalizeParticipantInput(input);
      return db.transaction(async (tx) => {
        await ownerProject(tx, ownerId, projectId);
        const [created] = await tx.insert(sharedProjectParticipants).values({ ownerId, projectId, name: normalized.name, paidMinor: normalized.paidMinor, paidAt: normalized.paidMinor > 0 ? new Date() : null }).returning({ id: sharedProjectParticipants.id });
        if (!created) throw new Error("Project participant could not be created.");
        await tx.update(sharedProjects).set({ updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId)));
        await audit(tx, ownerId, "created", "shared_project_participant", created.id, { operation: "create", projectId });
        if (normalized.paidMinor > 0) await audit(tx, ownerId, "updated", "shared_project_payment", created.id, { operation: "payment_create", projectId });
        return created.id;
      });
    },

    async updateParticipant(ownerId: string, participantId: string, projectId: string, input: SharedProjectParticipantUpdateInput): Promise<void> {
      assertOwnerId(ownerId);
      const normalized = normalizeParticipantInput(input);
      await db.transaction(async (tx) => {
        await ownerProject(tx, ownerId, projectId);
        const existing = await ownerParticipant(tx, ownerId, participantId, projectId);
        const [updated] = await tx.update(sharedProjectParticipants).set({ name: normalized.name, paidMinor: normalized.paidMinor, paidAt: normalized.paidMinor === existing.paidMinor ? existing.paidAt : normalized.paidMinor > 0 ? new Date() : null, updatedAt: new Date() }).where(and(eq(sharedProjectParticipants.ownerId, ownerId), eq(sharedProjectParticipants.id, participantId), eq(sharedProjectParticipants.projectId, projectId))).returning({ id: sharedProjectParticipants.id });
        if (!updated) throw new Error("Project participant not found.");
        await tx.update(sharedProjects).set({ updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId)));
        await audit(tx, ownerId, "updated", "shared_project_participant", participantId, { operation: "update", projectId });
        if (normalized.paidMinor !== existing.paidMinor) await audit(tx, ownerId, "updated", "shared_project_payment", participantId, { operation: "payment_update", projectId });
      });
    },

    async deleteParticipant(ownerId: string, participantId: string, projectId: string): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        await ownerProject(tx, ownerId, projectId);
        await ownerParticipant(tx, ownerId, participantId, projectId);
        const [deleted] = await tx.delete(sharedProjectParticipants).where(and(eq(sharedProjectParticipants.ownerId, ownerId), eq(sharedProjectParticipants.id, participantId), eq(sharedProjectParticipants.projectId, projectId))).returning({ id: sharedProjectParticipants.id });
        if (!deleted) throw new Error("Project participant not found.");
        await tx.update(sharedProjects).set({ updatedAt: new Date() }).where(and(eq(sharedProjects.ownerId, ownerId), eq(sharedProjects.id, projectId)));
        await audit(tx, ownerId, "deleted", "shared_project_participant", participantId, { operation: "delete", projectId });
      });
    },
  };
}
