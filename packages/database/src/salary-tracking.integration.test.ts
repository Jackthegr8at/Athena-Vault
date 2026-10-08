import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client";
import { createSalaryTrackingRepository } from "./salary-tracking";
import { expectIntegrationRollback } from "./integration-test-helpers";
import { auditEvents, cashFlowPeriods, rrqYearLimits, salarySnapshots, salaryYears, users } from "./drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;
const ownerA = "00000000-0000-4000-8000-0000000000f1";
const ownerB = "00000000-0000-4000-8000-0000000000f2";

describe.skipIf(!database)("salary tracking repository", () => {
  it("keeps years and snapshots owner-scoped and supports the complete lifecycle", async () => {
    if (!database) return;
    const rollbackMarker = new Error("salary tracking integration rollback");

    await expectIntegrationRollback(database.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: ownerA, email: "salary-tracking-owner-a@athena-vault.local" },
        { id: ownerB, email: "salary-tracking-owner-b@athena-vault.local" },
      ]);
      await tx.insert(cashFlowPeriods).values({
        ownerId: ownerA,
        label: "Salary payday anchor",
        startsOn: "2026-07-23",
        endsOn: "2026-08-05",
        payDate: "2026-08-05",
        openingBalanceMinor: 0,
        currency: "CAD",
        status: "actual",
      });

      const [rrqLimit] = await tx.select().from(rrqYearLimits).where(eq(rrqYearLimits.taxYear, 2026));
      expect(rrqLimit).toMatchObject({ taxYear: 2026, firstMaximumMinor: 447930, additionalMaximumMinor: 41600, ympeMinor: 7460000, yampeMinor: 8500000, firstRateBps: 630, additionalRateBps: 400 });
      const repository = createSalaryTrackingRepository(tx as unknown as Database);
      const historicalYear = await repository.createFinalizedYear(ownerA, {
        taxYear: 2024,
        finalFederalMinor: 8_009_925,
        note: "Official T4",
      });
      expect(await repository.getByTaxYear(ownerA, 2024)).toMatchObject({
        id: historicalYear,
        status: "finalized",
        annualBaseMinor: null,
        finalFederalMinor: 8_009_925,
        snapshots: [],
      });
      await expect(repository.getByTaxYear(ownerB, 2024)).resolves.toBeNull();
      const yearA = await repository.createYear(ownerA, { taxYear: 2026, annualBaseMinor: 8_250_200 });
      const yearB = await repository.createYear(ownerB, { taxYear: 2026, annualBaseMinor: 1_000_000 });
      await repository.upsertRrqYearLimits(ownerA, {
        taxYear: 2026,
        firstMaximumMinor: 447_930,
        additionalMaximumMinor: 41_600,
        ympeMinor: 7_460_000,
        yampeMinor: 8_500_000,
        firstRateBps: 600,
        additionalRateBps: 400,
      });
      const snapshotA = await repository.createSnapshot(ownerA, yearA, {
        snapshotOn: "2026-08-05",
        federalCumulativeMinor: 6_558_710,
        provincialCumulativeMinor: 6_715_359,
        rrqContributionYtdMinor: 299_200,
      });
      await repository.createSnapshot(ownerA, yearA, {
        snapshotOn: "2026-08-19",
        federalCumulativeMinor: 7_000_000,
        provincialCumulativeMinor: 7_100_000,
        rrqContributionYtdMinor: 317_900,
      });

      const ownerView = await repository.getByTaxYear(ownerA, 2026);
      expect(ownerView).toMatchObject({
        id: yearA,
        totalPayPeriods: 26,
        latestSnapshot: { snapshotOn: "2026-08-19", completedPayNumber: 17 },
        rrqContributionTracker: {
          limits: { firstRateBps: 600, additionalRateBps: 400 },
          provincialCumulativeMinor: 7_100_000,
          tierAwareForecastPerPayMinor: expect.any(Number),
        },
      });
      expect(ownerView?.snapshots[0]).toMatchObject({
        id: snapshotA,
        completedPayNumber: 16,
        rrqContributionYtdMinor: 299_200,
        federalProjectedYearEndMinor: 10_657_904,
        provincialProjectedYearEndMinor: 10_912_458,
      });
      expect(ownerView?.rrqContributionTracker).toMatchObject({
        status: "available",
        paidYtdMinor: 317_900,
        remainingMinor: 171_630,
        weightedPerPayMinor: 18_700,
        unavailableReason: "maximum-not-reached-within-year",
      });
      expect((await repository.listByOwner(ownerB)).map((year) => year.id)).toEqual([yearB]);
      await expect(repository.getByTaxYear(ownerB, 2026)).resolves.toMatchObject({
        id: yearB,
        rrqContributionTracker: { limits: { firstRateBps: 630, additionalRateBps: 400 } },
      });
      await expect(repository.updateSnapshot(ownerB, snapshotA, {
        snapshotOn: "2026-08-05",
        federalCumulativeMinor: 1,
        provincialCumulativeMinor: 1,
      })).rejects.toThrow("Salary snapshot not found.");

      await repository.updateSnapshot(ownerA, snapshotA, {
        snapshotOn: "2026-08-05",
        federalCumulativeMinor: 6_600_000,
        provincialCumulativeMinor: 6_750_000,
      });
      const afterUpdate = await repository.getByTaxYear(ownerA, 2026);
      expect(afterUpdate?.snapshots[0]).toMatchObject({ federalCumulativeMinor: 6_600_000, provincialCumulativeMinor: 6_750_000, rrqContributionYtdMinor: 299_200 });
      await repository.updateSnapshot(ownerA, snapshotA, {
        snapshotOn: "2026-08-05",
        federalCumulativeMinor: 6_600_000,
        provincialCumulativeMinor: 6_750_000,
        rrqContributionYtdMinor: null,
      });
      expect((await repository.getByTaxYear(ownerA, 2026))?.snapshots[0]?.rrqContributionYtdMinor).toBeNull();
      const snapshotAudits = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityType, "salary_snapshot"), eq(auditEvents.entityId, snapshotA)));
      expect(snapshotAudits.some((row) => row.metadata.rrqContributionYtdMinor === 299_200)).toBe(true);
      expect(snapshotAudits.at(-1)?.metadata).toMatchObject({ rrqContributionYtdMinor: null });

      await repository.deleteSnapshot(ownerA, snapshotA);
      expect((await repository.getByTaxYear(ownerA, 2026))?.snapshots).toHaveLength(1);
      await expect(repository.finalizeYear(ownerA, yearA)).resolves.toBeUndefined();
      expect(await repository.getByTaxYear(ownerA, 2026)).toMatchObject({ status: "finalized", finalFederalMinor: 7_000_000 });
      await expect(repository.updateFinalFederal(ownerA, yearA, 7_050_025)).resolves.toBeUndefined();
      expect(await repository.getByTaxYear(ownerA, 2026)).toMatchObject({ status: "finalized", finalFederalMinor: 7_050_025 });
      await expect(repository.updateFinalFederal(ownerB, yearA, 7_060_000)).rejects.toThrow("Salary year not found.");
      await repository.reopenYear(ownerA, yearA);
      expect(await repository.getByTaxYear(ownerA, 2026)).toMatchObject({ status: "in_progress", finalFederalMinor: null });

      const auditRows = await tx.select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(and(eq(auditEvents.ownerId, ownerA), eq(auditEvents.entityType, "salary_year")));
      expect(auditRows.map((row) => row.action)).toEqual(expect.arrayContaining(["created", "updated"]));
      expect(auditRows.some((row) => row.metadata.operation === "finalize")).toBe(true);
      expect(auditRows.some((row) => row.metadata.operation === "update_final_federal")).toBe(true);
      expect(auditRows.some((row) => row.metadata.operation === "reopen")).toBe(true);

      await repository.deleteYear(ownerA, yearA);
      expect(await tx.select({ id: salaryYears.id }).from(salaryYears).where(eq(salaryYears.id, yearA))).toHaveLength(0);
      expect(await tx.select({ id: salarySnapshots.id }).from(salarySnapshots).where(eq(salarySnapshots.salaryYearId, yearA))).toHaveLength(0);
      throw rollbackMarker;
    }), rollbackMarker);

    expect(await database.select({ id: salaryYears.id }).from(salaryYears).where(eq(salaryYears.ownerId, ownerA))).toHaveLength(0);
  });

  it("requires an explicit completed-pay override for an off-cycle snapshot", async () => {
    if (!database) return;
    const rollbackMarker = new Error("salary off-cycle integration rollback");
    await expect(database.transaction(async (tx) => {
      const owner = "00000000-0000-4000-8000-0000000000f3";
      await tx.insert(users).values({ id: owner, email: "salary-tracking-owner-off-cycle@athena-vault.local" });
      const repository = createSalaryTrackingRepository(tx as unknown as Database);
      const yearId = await repository.createYear(owner, { taxYear: 2026, annualBaseMinor: 8_250_200 });
      await expect(repository.createSnapshot(owner, yearId, {
        snapshotOn: "2026-08-06",
        federalCumulativeMinor: 1,
        provincialCumulativeMinor: 1,
      })).rejects.toThrow("completed-pay override");
      const snapshotId = await repository.createSnapshot(owner, yearId, {
        snapshotOn: "2026-08-06",
        federalCumulativeMinor: 1,
        provincialCumulativeMinor: 1,
        completedPayNumberOverride: 16,
      });
      expect((await repository.getByTaxYear(owner, 2026))?.snapshots[0]).toMatchObject({ id: snapshotId, completedPayNumber: 16, completedPayNumberOverride: 16 });
      throw rollbackMarker;
    })).rejects.toThrow(rollbackMarker.message);
  });
});
