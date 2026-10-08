import {
  calculateRrqContributionTracker,
  deriveBiweeklyPaydays,
  deriveCompletedPayNumber,
  projectSalaryYearEndMinor,
  salaryVarianceToBaseMinor,
  type RrqContributionTrackerView,
  type RrqYearLimitsInput,
} from "@athena/finance-engine";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import { auditEvents, cashFlowPeriods, rrqYearLimitOverrides, rrqYearLimits, salarySnapshots, salaryYears } from "./drizzle-schema";

type SalaryQuery = Database;
type SalaryTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type SalaryYearStatus = (typeof salaryYears.$inferSelect)["status"];

export interface SalaryYearCreateInput {
  readonly taxYear: number;
  readonly annualBaseMinor: number | null;
  readonly payPeriodsPerYearOverride?: number | null;
  readonly note?: string | null;
}

export interface SalaryFinalizedYearCreateInput {
  readonly taxYear: number;
  readonly finalFederalMinor: number;
  readonly note?: string | null;
}

export type SalaryYearUpdateInput = Omit<SalaryYearCreateInput, "taxYear">;

export interface SalarySnapshotCreateInput {
  readonly snapshotOn: string;
  readonly federalCumulativeMinor: number;
  readonly provincialCumulativeMinor: number;
  readonly rrqContributionYtdMinor?: number | null;
  readonly completedPayNumberOverride?: number | null;
  readonly note?: string | null;
}

export type SalarySnapshotUpdateInput = SalarySnapshotCreateInput;

export type SalaryRrqYearLimitInput = RrqYearLimitsInput;

export interface SalarySnapshotView {
  readonly id: string;
  readonly salaryYearId: string;
  readonly snapshotOn: string;
  readonly federalCumulativeMinor: number;
  readonly provincialCumulativeMinor: number;
  readonly completedPayNumber: number;
  readonly completedPayNumberOverride: number | null;
  readonly rrqContributionYtdMinor: number | null;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly federalDeltaMinor: number | null;
  readonly provincialDeltaMinor: number | null;
  readonly federalProjectedYearEndMinor: number;
  readonly provincialProjectedYearEndMinor: number;
}

export interface SalaryYearView {
  readonly id: string;
  readonly ownerId: string;
  readonly taxYear: number;
  readonly annualBaseMinor: number | null;
  readonly status: SalaryYearStatus;
  readonly finalFederalMinor: number | null;
  readonly payPeriodsPerYearOverride: number | null;
  readonly totalPayPeriods: number;
  readonly paydayAnchorOn: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly latestSnapshot: SalarySnapshotView | null;
  readonly snapshots: readonly SalarySnapshotView[];
  readonly federalCumulativeMinor: number | null;
  readonly provincialCumulativeMinor: number | null;
  readonly federalProjectedYearEndMinor: number | null;
  readonly provincialProjectedYearEndMinor: number | null;
  readonly federalVarianceToBaseMinor: number | null;
  readonly rrqContributionTracker: RrqContributionTrackerView;
}

function assertOwnerId(ownerId: string): void {
  if (!ownerId.trim()) throw new RangeError("Owner ID is required.");
}

function assertTaxYear(taxYear: number): void {
  if (!Number.isSafeInteger(taxYear) || taxYear < 1900 || taxYear > 2200) {
    throw new RangeError("Tax year must be between 1900 and 2200.");
  }
}

function assertMinor(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function assertPayCount(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 366)) {
    throw new RangeError(`${label} must be an integer between 1 and 366.`);
  }
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must be a valid ISO date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} must be a valid ISO date.`);
  }
}

function assertSnapshotDate(snapshotOn: string, taxYear: number): void {
  assertIsoDate(snapshotOn, "Snapshot date");
  if (snapshotOn.slice(0, 4) !== String(taxYear)) throw new RangeError("Snapshot date must belong to the selected tax year.");
}

function normalizeNote(note: string | null | undefined): string | null {
  const normalized = note?.trim() ?? "";
  if (normalized.length > 500) throw new RangeError("Salary note must be 500 characters or fewer.");
  return normalized || null;
}

function assertYearInput(input: SalaryYearCreateInput | SalaryYearUpdateInput): void {
  if ("taxYear" in input) assertTaxYear(input.taxYear);
  assertMinor(input.annualBaseMinor, "Annual base salary");
  assertPayCount(input.payPeriodsPerYearOverride ?? null, "Pay periods override");
  normalizeNote(input.note);
}

function assertRrqYearLimitInput(input: SalaryRrqYearLimitInput): void {
  assertTaxYear(input.taxYear);
  assertMinor(input.firstMaximumMinor, "RRQ first maximum");
  assertMinor(input.additionalMaximumMinor, "RRQ additional maximum");
  assertMinor(input.ympeMinor, "RRQ YMPE");
  assertMinor(input.yampeMinor, "RRQ YAMPE");
  assertMinor(input.firstRateBps, "RRQ first rate");
  assertMinor(input.additionalRateBps, "RRQ additional rate");
  if (input.ympeMinor <= 0) throw new RangeError("RRQ YMPE must be a positive safe integer.");
  if (input.yampeMinor <= 0) throw new RangeError("RRQ YAMPE must be a positive safe integer.");
  if (input.yampeMinor < input.ympeMinor) throw new RangeError("RRQ YAMPE cannot be below YMPE.");
  if (input.firstRateBps <= 0 || input.firstRateBps > 10_000) throw new RangeError("RRQ first rate must be between 1 and 10000 basis points.");
  if (input.additionalRateBps <= 0 || input.additionalRateBps > 10_000) throw new RangeError("RRQ additional rate must be between 1 and 10000 basis points.");
}

function assertSnapshotInput(input: SalarySnapshotCreateInput, taxYear: number): void {
  assertSnapshotDate(input.snapshotOn, taxYear);
  assertMinor(input.federalCumulativeMinor, "Federal cumulative salary");
  assertMinor(input.provincialCumulativeMinor, "Provincial cumulative salary");
  assertMinor(input.rrqContributionYtdMinor ?? null, "RRQ contribution YTD");
  assertPayCount(input.completedPayNumberOverride ?? null, "Completed pay override");
  normalizeNote(input.note);
}

async function ownerYear(queryDb: SalaryQuery | SalaryTransaction, ownerId: string, salaryYearId: string) {
  const [year] = await queryDb.select().from(salaryYears)
    .where(and(eq(salaryYears.ownerId, ownerId), eq(salaryYears.id, salaryYearId)))
    .limit(1);
  if (!year) throw new Error("Salary year not found.");
  return year;
}

async function ownerSnapshot(queryDb: SalaryQuery | SalaryTransaction, ownerId: string, snapshotId: string) {
  const [row] = await queryDb.select({ snapshot: salarySnapshots, year: salaryYears })
    .from(salarySnapshots)
    .innerJoin(salaryYears, and(
      eq(salaryYears.id, salarySnapshots.salaryYearId),
      eq(salaryYears.ownerId, ownerId),
    ))
    .where(and(eq(salarySnapshots.id, snapshotId), eq(salarySnapshots.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new Error("Salary snapshot not found.");
  return row;
}

async function ownerPaydays(queryDb: SalaryQuery | SalaryTransaction, ownerId: string): Promise<readonly string[]> {
  const rows = await queryDb.select({ payDate: cashFlowPeriods.payDate })
    .from(cashFlowPeriods)
    .where(eq(cashFlowPeriods.ownerId, ownerId))
    .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id));
  return [...new Set(rows.map((row) => row.payDate))];
}

function anchorForYear(paydays: readonly string[], taxYear: number): string | null {
  const yearEnd = `${taxYear}-12-31`;
  return [...paydays].reverse().find((payday) => payday <= yearEnd) ?? paydays[0] ?? null;
}

function totalPayPeriods(year: typeof salaryYears.$inferSelect, anchorPaydayOn: string | null): number {
  return year.payPeriodsPerYearOverride
    ?? (anchorPaydayOn ? deriveBiweeklyPaydays(anchorPaydayOn, year.taxYear).length : 26);
}

function makeSnapshotViews(
  rows: readonly (typeof salarySnapshots.$inferSelect)[],
  totalPayPeriods: number,
): readonly SalarySnapshotView[] {
  let previousFederal: number | null = null;
  let previousProvincial: number | null = null;
  return rows.map((row) => {
    const view: SalarySnapshotView = {
      id: row.id,
      salaryYearId: row.salaryYearId,
      snapshotOn: row.snapshotOn,
      federalCumulativeMinor: row.federalCumulativeMinor,
      provincialCumulativeMinor: row.provincialCumulativeMinor,
      completedPayNumber: row.completedPayNumber,
      completedPayNumberOverride: row.completedPayNumberOverride,
      rrqContributionYtdMinor: row.rrqContributionYtdMinor,
      note: row.note,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      federalDeltaMinor: previousFederal === null ? null : row.federalCumulativeMinor - previousFederal,
      provincialDeltaMinor: previousProvincial === null ? null : row.provincialCumulativeMinor - previousProvincial,
      federalProjectedYearEndMinor: projectSalaryYearEndMinor({ cumulativeMinor: row.federalCumulativeMinor, completedPayNumber: row.completedPayNumber, totalPayPeriods }),
      provincialProjectedYearEndMinor: projectSalaryYearEndMinor({ cumulativeMinor: row.provincialCumulativeMinor, completedPayNumber: row.completedPayNumber, totalPayPeriods }),
    };
    previousFederal = row.federalCumulativeMinor;
    previousProvincial = row.provincialCumulativeMinor;
    return view;
  });
}

function toRrqYearLimits(row: typeof rrqYearLimits.$inferSelect): RrqYearLimitsInput {
  return {
    taxYear: row.taxYear,
    firstMaximumMinor: row.firstMaximumMinor,
    additionalMaximumMinor: row.additionalMaximumMinor,
    ympeMinor: row.ympeMinor,
    yampeMinor: row.yampeMinor,
    firstRateBps: row.firstRateBps,
    additionalRateBps: row.additionalRateBps,
  };
}

function toYearView(
  year: typeof salaryYears.$inferSelect,
  rows: readonly (typeof salarySnapshots.$inferSelect)[],
  paydays: readonly string[],
  rrqLimits: RrqYearLimitsInput | null,
): SalaryYearView {
  const paydayAnchorOn = anchorForYear(paydays, year.taxYear);
  const totalPayPeriodsValue = totalPayPeriods(year, paydayAnchorOn);
  const snapshots = makeSnapshotViews(rows, totalPayPeriodsValue);
  const latestSnapshot = snapshots.at(-1) ?? null;
  const federalCumulativeMinor = latestSnapshot?.federalCumulativeMinor ?? null;
  const provincialCumulativeMinor = latestSnapshot?.provincialCumulativeMinor ?? null;
  const federalProjectedYearEndMinor = year.finalFederalMinor ?? latestSnapshot?.federalProjectedYearEndMinor ?? null;
  const provincialProjectedYearEndMinor = latestSnapshot?.provincialProjectedYearEndMinor ?? null;
  const rrqContributionTracker = calculateRrqContributionTracker({
    limits: rrqLimits,
    observations: rows.map((row) => ({
      snapshotId: row.id,
      snapshotOn: row.snapshotOn,
      completedPayNumber: row.completedPayNumber,
      rrqContributionYtdMinor: row.rrqContributionYtdMinor,
    })),
    totalPayPeriods: totalPayPeriodsValue,
    paydays: paydayAnchorOn ? deriveBiweeklyPaydays(paydayAnchorOn, year.taxYear) : [],
    federalCumulativeMinor,
    provincialCumulativeMinor,
    provincialProjectedYearEndMinor,
  });
  return {
    id: year.id,
    ownerId: year.ownerId,
    taxYear: year.taxYear,
    annualBaseMinor: year.annualBaseMinor,
    status: year.status,
    finalFederalMinor: year.finalFederalMinor,
    payPeriodsPerYearOverride: year.payPeriodsPerYearOverride,
    totalPayPeriods: totalPayPeriodsValue,
    paydayAnchorOn,
    note: year.note,
    createdAt: year.createdAt,
    updatedAt: year.updatedAt,
    latestSnapshot,
    snapshots,
    federalCumulativeMinor,
    provincialCumulativeMinor,
    federalProjectedYearEndMinor,
    provincialProjectedYearEndMinor,
    federalVarianceToBaseMinor: federalProjectedYearEndMinor === null || year.annualBaseMinor === null
      ? null
      : salaryVarianceToBaseMinor(federalProjectedYearEndMinor, year.annualBaseMinor),
    rrqContributionTracker,
  };
}

async function readYears(queryDb: SalaryQuery | SalaryTransaction, ownerId: string, taxYear?: number): Promise<readonly SalaryYearView[]> {
  assertOwnerId(ownerId);
  if (taxYear !== undefined) assertTaxYear(taxYear);
  const [yearRows, paydayRows, rrqLimitRows, rrqOverrideRows] = await Promise.all([
    queryDb.select().from(salaryYears)
      .where(and(eq(salaryYears.ownerId, ownerId), ...(taxYear === undefined ? [] : [eq(salaryYears.taxYear, taxYear)])))
      .orderBy(desc(salaryYears.taxYear), desc(salaryYears.id)),
    ownerPaydays(queryDb, ownerId),
    queryDb.select().from(rrqYearLimits).orderBy(asc(rrqYearLimits.taxYear)),
    queryDb.select().from(rrqYearLimitOverrides).where(eq(rrqYearLimitOverrides.ownerId, ownerId)).orderBy(asc(rrqYearLimitOverrides.taxYear)),
  ]);
  if (yearRows.length === 0) return [];
  const snapshotRows = await queryDb.select().from(salarySnapshots)
    .where(and(eq(salarySnapshots.ownerId, ownerId), ...(taxYear === undefined ? [] : [eq(salarySnapshots.salaryYearId, yearRows[0]!.id)])))
    .orderBy(asc(salarySnapshots.snapshotOn), asc(salarySnapshots.id));
  const snapshotsByYear = new Map<string, (typeof snapshotRows)[number][]>();
  for (const row of snapshotRows) {
    const values = snapshotsByYear.get(row.salaryYearId) ?? [];
    values.push(row);
    snapshotsByYear.set(row.salaryYearId, values);
  }
  const rrqLimitsByYear = new Map(rrqLimitRows.map((row) => [row.taxYear, toRrqYearLimits(row)]));
  const rrqOverridesByYear = new Map(rrqOverrideRows.map((row) => [row.taxYear, toRrqYearLimits(row)]));
  return yearRows.map((year) => toYearView(year, snapshotsByYear.get(year.id) ?? [], paydayRows, rrqOverridesByYear.get(year.taxYear) ?? rrqLimitsByYear.get(year.taxYear) ?? null));
}

async function effectiveCompletedPayNumber(
  queryDb: SalaryQuery | SalaryTransaction,
  ownerId: string,
  year: typeof salaryYears.$inferSelect,
  snapshotOn: string,
  completedPayNumberOverride: number | null | undefined,
): Promise<number> {
  const paydays = await ownerPaydays(queryDb, ownerId);
  const anchor = anchorForYear(paydays, year.taxYear);
  const derived = anchor ? deriveCompletedPayNumber(anchor, snapshotOn, year.taxYear) : null;
  const completedPayNumber = completedPayNumberOverride ?? derived;
  if (completedPayNumber === null || completedPayNumber === undefined) {
    throw new Error("Snapshot date is not on the biweekly payday schedule. Enter a completed-pay override.");
  }
  const total = totalPayPeriods(year, anchor);
  if (completedPayNumber > total) throw new RangeError("Completed pay number cannot exceed total pay periods.");
  return completedPayNumber;
}

async function audit(
  queryDb: SalaryQuery | SalaryTransaction,
  ownerId: string,
  action: "created" | "updated" | "deleted",
  entityType: "salary_year" | "salary_snapshot" | "rrq_year_limit_override",
  entityId: string,
  operation: string,
  metadata: { readonly rrqContributionYtdMinor?: number | null; readonly taxYear?: number } = {},
): Promise<void> {
  await queryDb.insert(auditEvents).values({
    ownerId,
    actorUserId: ownerId,
    action,
    entityType,
    entityId,
    metadata: { operation, ...metadata },
  });
}

export function createSalaryTrackingRepository(db: Database) {
  return {
    async listByOwner(ownerId: string): Promise<readonly SalaryYearView[]> {
      return readYears(db, ownerId);
    },

    async getByTaxYear(ownerId: string, taxYear: number): Promise<SalaryYearView | null> {
      return (await readYears(db, ownerId, taxYear))[0] ?? null;
    },

    async upsertRrqYearLimits(ownerId: string, input: SalaryRrqYearLimitInput): Promise<SalaryRrqYearLimitInput> {
      assertOwnerId(ownerId);
      assertRrqYearLimitInput(input);
      await db.transaction(async (tx) => {
        const [row] = await tx.insert(rrqYearLimitOverrides).values({
          ownerId,
          taxYear: input.taxYear,
          firstMaximumMinor: input.firstMaximumMinor,
          additionalMaximumMinor: input.additionalMaximumMinor,
          ympeMinor: input.ympeMinor,
          yampeMinor: input.yampeMinor,
          firstRateBps: input.firstRateBps,
          additionalRateBps: input.additionalRateBps,
        }).onConflictDoUpdate({
          target: [rrqYearLimitOverrides.ownerId, rrqYearLimitOverrides.taxYear],
          set: {
            firstMaximumMinor: input.firstMaximumMinor,
            additionalMaximumMinor: input.additionalMaximumMinor,
            ympeMinor: input.ympeMinor,
            yampeMinor: input.yampeMinor,
            firstRateBps: input.firstRateBps,
            additionalRateBps: input.additionalRateBps,
            updatedAt: new Date(),
          },
        }).returning({ id: rrqYearLimitOverrides.id });
        if (!row) throw new Error("RRQ year limits could not be saved.");
        await audit(tx, ownerId, "updated", "rrq_year_limit_override", row.id, "update", { taxYear: input.taxYear });
      });
      return input;
    },

    async createYear(ownerId: string, input: SalaryYearCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      assertYearInput(input);
      const [created] = await db.transaction(async (tx) => {
        const [row] = await tx.insert(salaryYears).values({
          ownerId,
          taxYear: input.taxYear,
          annualBaseMinor: input.annualBaseMinor,
          status: "in_progress",
          finalFederalMinor: null,
          payPeriodsPerYearOverride: input.payPeriodsPerYearOverride ?? null,
          note: normalizeNote(input.note),
        }).returning({ id: salaryYears.id });
        if (!row) throw new Error("Salary year could not be created.");
        await audit(tx, ownerId, "created", "salary_year", row.id, "create");
        return [row] as const;
      });
      return created.id;
    },

    async createFinalizedYear(ownerId: string, input: SalaryFinalizedYearCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      assertTaxYear(input.taxYear);
      assertMinor(input.finalFederalMinor, "Final federal income");
      const note = normalizeNote(input.note);
      const [created] = await db.transaction(async (tx) => {
        const [row] = await tx.insert(salaryYears).values({
          ownerId,
          taxYear: input.taxYear,
          annualBaseMinor: null,
          status: "finalized",
          finalFederalMinor: input.finalFederalMinor,
          payPeriodsPerYearOverride: null,
          note,
        }).returning({ id: salaryYears.id });
        if (!row) throw new Error("Finalized salary year could not be created.");
        await audit(tx, ownerId, "created", "salary_year", row.id, "create_finalized");
        return [row] as const;
      });
      return created.id;
    },

    async updateYear(ownerId: string, salaryYearId: string, input: SalaryYearUpdateInput): Promise<void> {
      assertOwnerId(ownerId);
      assertYearInput(input);
      await db.transaction(async (tx) => {
        await ownerYear(tx, ownerId, salaryYearId);
        const [updated] = await tx.update(salaryYears).set({
          annualBaseMinor: input.annualBaseMinor,
          payPeriodsPerYearOverride: input.payPeriodsPerYearOverride ?? null,
          note: normalizeNote(input.note),
          updatedAt: new Date(),
        }).where(and(eq(salaryYears.id, salaryYearId), eq(salaryYears.ownerId, ownerId))).returning({ id: salaryYears.id });
        if (!updated) throw new Error("Salary year not found.");
        await audit(tx, ownerId, "updated", "salary_year", salaryYearId, "update");
      });
    },

    async deleteYear(ownerId: string, salaryYearId: string): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        await ownerYear(tx, ownerId, salaryYearId);
        await tx.delete(salarySnapshots)
          .where(and(eq(salarySnapshots.ownerId, ownerId), eq(salarySnapshots.salaryYearId, salaryYearId)));
        const [deleted] = await tx.delete(salaryYears)
          .where(and(eq(salaryYears.id, salaryYearId), eq(salaryYears.ownerId, ownerId)))
          .returning({ id: salaryYears.id });
        if (!deleted) throw new Error("Salary year not found.");
        await audit(tx, ownerId, "deleted", "salary_year", salaryYearId, "delete");
      });
    },

    async createSnapshot(ownerId: string, salaryYearId: string, input: SalarySnapshotCreateInput): Promise<string> {
      assertOwnerId(ownerId);
      const [created] = await db.transaction(async (tx) => {
        const year = await ownerYear(tx, ownerId, salaryYearId);
        assertSnapshotInput(input, year.taxYear);
        const completedPayNumber = await effectiveCompletedPayNumber(tx, ownerId, year, input.snapshotOn, input.completedPayNumberOverride);
        const [row] = await tx.insert(salarySnapshots).values({
          ownerId,
          salaryYearId,
          snapshotOn: input.snapshotOn,
          federalCumulativeMinor: input.federalCumulativeMinor,
          provincialCumulativeMinor: input.provincialCumulativeMinor,
          completedPayNumber,
          completedPayNumberOverride: input.completedPayNumberOverride ?? null,
          rrqContributionYtdMinor: input.rrqContributionYtdMinor ?? null,
          note: normalizeNote(input.note),
        }).returning({ id: salarySnapshots.id });
        if (!row) throw new Error("Salary snapshot could not be created.");
        await audit(tx, ownerId, "created", "salary_snapshot", row.id, "create", { rrqContributionYtdMinor: input.rrqContributionYtdMinor ?? null });
        return [row] as const;
      });
      return created.id;
    },

    async updateSnapshot(ownerId: string, snapshotId: string, input: SalarySnapshotUpdateInput): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        const { year } = await ownerSnapshot(tx, ownerId, snapshotId);
        assertSnapshotInput(input, year.taxYear);
        const completedPayNumber = await effectiveCompletedPayNumber(tx, ownerId, year, input.snapshotOn, input.completedPayNumberOverride);
        const [updated] = await tx.update(salarySnapshots).set({
          snapshotOn: input.snapshotOn,
          federalCumulativeMinor: input.federalCumulativeMinor,
          provincialCumulativeMinor: input.provincialCumulativeMinor,
          completedPayNumber,
          ...(input.rrqContributionYtdMinor === undefined ? {} : { rrqContributionYtdMinor: input.rrqContributionYtdMinor }),
          completedPayNumberOverride: input.completedPayNumberOverride ?? null,
          note: normalizeNote(input.note),
          updatedAt: new Date(),
        }).where(and(eq(salarySnapshots.id, snapshotId), eq(salarySnapshots.ownerId, ownerId))).returning({ id: salarySnapshots.id });
        if (!updated) throw new Error("Salary snapshot not found.");
        await audit(tx, ownerId, "updated", "salary_snapshot", snapshotId, "update", input.rrqContributionYtdMinor === undefined ? {} : { rrqContributionYtdMinor: input.rrqContributionYtdMinor });
      });
    },

    async deleteSnapshot(ownerId: string, snapshotId: string): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        await ownerSnapshot(tx, ownerId, snapshotId);
        const [deleted] = await tx.delete(salarySnapshots)
          .where(and(eq(salarySnapshots.id, snapshotId), eq(salarySnapshots.ownerId, ownerId)))
          .returning({ id: salarySnapshots.id });
        if (!deleted) throw new Error("Salary snapshot not found.");
        await audit(tx, ownerId, "deleted", "salary_snapshot", snapshotId, "delete");
      });
    },

    async finalizeYear(ownerId: string, salaryYearId: string, finalFederalMinor?: number): Promise<void> {
      assertOwnerId(ownerId);
      assertMinor(finalFederalMinor ?? null, "Final federal income");
      await db.transaction(async (tx) => {
        const year = await ownerYear(tx, ownerId, salaryYearId);
        if (year.status === "finalized") throw new Error("Salary year is already finalized.");
        const [latest] = await tx.select({ id: salarySnapshots.id, federalCumulativeMinor: salarySnapshots.federalCumulativeMinor })
          .from(salarySnapshots)
          .where(and(eq(salarySnapshots.ownerId, ownerId), eq(salarySnapshots.salaryYearId, salaryYearId)))
          .orderBy(desc(salarySnapshots.snapshotOn), desc(salarySnapshots.id))
          .limit(1);
        if (!latest) throw new Error("Salary year needs a snapshot before it can be finalized.");
        const officialFederalMinor = finalFederalMinor ?? latest.federalCumulativeMinor;
        assertMinor(officialFederalMinor, "Final federal income");
        const [updated] = await tx.update(salaryYears).set({ status: "finalized", finalFederalMinor: officialFederalMinor, updatedAt: new Date() })
          .where(and(eq(salaryYears.id, salaryYearId), eq(salaryYears.ownerId, ownerId), eq(salaryYears.status, "in_progress")))
          .returning({ id: salaryYears.id });
        if (!updated) throw new Error("Salary year could not be finalized.");
        await audit(tx, ownerId, "updated", "salary_year", salaryYearId, "finalize");
      });
    },

    async updateFinalFederal(ownerId: string, salaryYearId: string, finalFederalMinor: number): Promise<void> {
      assertOwnerId(ownerId);
      assertMinor(finalFederalMinor, "Final federal income");
      await db.transaction(async (tx) => {
        const year = await ownerYear(tx, ownerId, salaryYearId);
        if (year.status !== "finalized") throw new Error("Salary year is not finalized.");
        const [updated] = await tx.update(salaryYears).set({ finalFederalMinor, updatedAt: new Date() })
          .where(and(eq(salaryYears.id, salaryYearId), eq(salaryYears.ownerId, ownerId), eq(salaryYears.status, "finalized")))
          .returning({ id: salaryYears.id });
        if (!updated) throw new Error("Salary year could not update its final federal amount.");
        await audit(tx, ownerId, "updated", "salary_year", salaryYearId, "update_final_federal");
      });
    },

    async reopenYear(ownerId: string, salaryYearId: string): Promise<void> {
      assertOwnerId(ownerId);
      await db.transaction(async (tx) => {
        const year = await ownerYear(tx, ownerId, salaryYearId);
        if (year.status === "in_progress") throw new Error("Salary year is already in progress.");
        const [updated] = await tx.update(salaryYears).set({ status: "in_progress", finalFederalMinor: null, updatedAt: new Date() })
          .where(and(eq(salaryYears.id, salaryYearId), eq(salaryYears.ownerId, ownerId), eq(salaryYears.status, "finalized")))
          .returning({ id: salaryYears.id });
        if (!updated) throw new Error("Salary year could not be reopened.");
        await audit(tx, ownerId, "updated", "salary_year", salaryYearId, "reopen");
      });
    },
  };
}
