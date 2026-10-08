import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  withDatabaseContext,
  withDatabaseObservation,
  type Database,
} from "../client";
import { toTorontoDateIso } from "../account-timeline";
import { createAccountTimelineRepository } from "../repositories/account-timeline";
import { createAnnualBudgetRepository } from "../annual-budgets";
import { getAnnualExpensesReadModel } from "./annual-expenses";
import {
  accounts,
  annualBudgets,
  annualExpenses,
  annualExpenseValues,
  institutions,
  users,
} from "../drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;
const runPerformance = Boolean(database && process.env.PERFORMANCE);

describe.skipIf(!runPerformance)("Phase 6 read-model performance check", () => {
  it("compares old N+1 query count and elapsed time with the new batched read model", async () => {
    if (!database) return;

    const owner = randomUUID();
    const institutionId = randomUUID();
    const linkedAccountId = randomUUID();
    const eligibleAccountId = randomUUID();
    const budgetId = randomUUID();
    const expenseId = randomUUID();

    const todayIso = toTorontoDateIso();
    const currentYear = Number(todayIso.slice(0, 4));
    const futureYear = currentYear + 2;

    const context = { ownerId: owner, authUserId: owner };
    const rollbackMarker = new Error("phase6 performance rollback");

    await expect(
      withDatabaseContext(database as Database, context, async (db) => {
        await db.insert(users).values({
          id: owner,
          email: `phase6-${owner}@athena-vault.local`,
        });

        await db.insert(institutions).values({
          id: institutionId,
          ownerId: owner,
          name: "Performance Bank",
          currency: "CAD",
        });

        await db.insert(accounts).values([
          {
            id: linkedAccountId,
            ownerId: owner,
            institutionId,
            name: "Linked",
            kind: "checking",
            currency: "CAD",
            timelineOrder: 0,
          },
          {
            id: eligibleAccountId,
            ownerId: owner,
            institutionId,
            name: "Eligible",
            kind: "checking",
            currency: "CAD",
            timelineOrder: 1,
          },
        ]);

        await db.insert(annualBudgets).values({
          id: budgetId,
          ownerId: owner,
          name: "Performance Budget",
          linkedAccountId,
          isActive: true,
          displayOrder: 0,
        });

        await db.insert(annualExpenses).values({
          id: expenseId,
          ownerId: owner,
          budgetId,
          name: "Insurance",
          amountMinor: 10_000,
          fundedMinor: 0,
          dueMonth: 4,
          dueDay: 15,
          currency: "CAD",
          isActive: true,
        });

        await db.insert(annualExpenseValues).values([
          {
            ownerId: owner,
            annualExpenseId: expenseId,
            budgetId,
            taxYear: currentYear,
            amountMinor: 12_000,
            amountOverrideMinor: 11_000,
            dueMonthOverride: 3,
            dueDayOverride: 10,
            fundedMinor: 0,
            currency: "CAD",
          },
          {
            ownerId: owner,
            annualExpenseId: expenseId,
            budgetId,
            taxYear: futureYear,
            amountMinor: 13_000,
            amountOverrideMinor: 12_000,
            dueMonthOverride: 5,
            dueDayOverride: 20,
            fundedMinor: 0,
            currency: "CAD",
          },
        ]);

        const oldObservation = { queryCount: 0, elapsedMs: 0 };
        const newObservation = { queryCount: 0, elapsedMs: 0 };

        await withDatabaseObservation(
          "old-full-page",
          async () => {
            const repository = createAnnualBudgetRepository(db);
            const timelineRepository = createAccountTimelineRepository(db);

            await repository.getSummary(owner, currentYear);
            await repository.listEligibleFundingAccounts(owner);
            await repository.getSummary(owner, futureYear);

            for (let year = currentYear; year <= futureYear; year++) {
              await repository.getSummary(owner, year);
            }

            await timelineRepository.getTimeline(owner, { includeArchived: true });
          },
          {
            onObservation: (observation) => {
              oldObservation.queryCount = observation.queryCount;
              oldObservation.elapsedMs = observation.elapsedMs;
            },
          },
        );

        const newModel = await withDatabaseObservation(
          "new-getAnnualExpensesReadModel",
          async () => getAnnualExpensesReadModel(db, owner, String(futureYear), todayIso),
          {
            onObservation: (observation) => {
              newObservation.queryCount = observation.queryCount;
              newObservation.elapsedMs = observation.elapsedMs;
            },
          },
        );

        expect(newModel.taxYear).toBe(futureYear);
        expect(newModel.years).toContain(currentYear);
        expect(newModel.years).toContain(futureYear);
        expect(newModel.projectionSummaries).toHaveLength(futureYear - currentYear + 1);
        expect(newModel.projectionSummaries.map((summary) => summary.taxYear)).toEqual([
          currentYear,
          currentYear + 1,
          futureYear,
        ]);
        expect(newModel.eligibleAccounts.map((account) => account.id)).toContain(eligibleAccountId);

        expect(oldObservation.queryCount).toBeGreaterThan(0);
        expect(newObservation.queryCount).toBeGreaterThan(0);
        expect(newObservation.queryCount).toBeLessThan(oldObservation.queryCount);

        expect(oldObservation.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(newObservation.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(oldObservation.elapsedMs)).toBe(true);
        expect(Number.isFinite(newObservation.elapsedMs)).toBe(true);

        // Record the elapsed-time delta and enforce a deliberately broad local bound
        // so a catastrophic regression (new path far slower) cannot pass.
        const deltaMs = newObservation.elapsedMs - oldObservation.elapsedMs;
        const broadRegressionBoundMs = 5_000;
        expect(Number.isFinite(deltaMs)).toBe(true);
        expect(deltaMs).toBeLessThanOrEqual(broadRegressionBoundMs);

        throw rollbackMarker;
      }),
    ).rejects.toThrow(rollbackMarker.message);
  });
});
