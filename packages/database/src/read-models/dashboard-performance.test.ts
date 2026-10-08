import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  withDatabaseObservation,
  type Database,
} from "../client";
import { expectIntegrationRollback } from "../integration-test-helpers";
import { toTorontoDateIso } from "../account-timeline";
import { addIsoDays } from "../account-contributions";
import { createCashFlowRepository } from "../repositories/cash-flow";
import { createHomeRepository } from "../home";
import { createNetWorthHistoryRepository } from "../net-worth-history";
import { addNetWorthHistoryMonths, NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS } from "@athena/finance-engine";
import { getDashboardReadModel } from "./dashboard";
import {
  accounts,
  balanceSnapshots,
  cashFlowPeriods,
  homes,
  institutions,
  users,
} from "../drizzle-schema";

const connectionString = process.env.DATABASE_URL;
const database = connectionString ? createDatabase(connectionString) : undefined;

describe.skipIf(!database)("getDashboardReadModel performance regression", () => {
  it("stays at or below the Phase 2 statement ceiling and matches the pre-change composition", async () => {
    if (!database) return;

    const owner = randomUUID();
    const institutionId = randomUUID();
    const linkedAccountId = randomUUID();
    const reserveAccountId = randomUUID();
    const homeId = randomUUID();

    const asOf = toTorontoDateIso();
    const homeTimelineThrough = addNetWorthHistoryMonths(asOf, NET_WORTH_HISTORY_DEFAULT_PROJECTED_MONTHS);
    const rollbackMarker = new Error("dashboard performance rollback");

    await expectIntegrationRollback(
      database.transaction(async (tx) => {
        await tx.insert(users).values({
          id: owner,
          email: `dashboard-perf-${owner}@athena-vault.local`,
        });

        await tx.insert(institutions).values({
          id: institutionId,
          ownerId: owner,
          name: "Dashboard Performance Bank",
          currency: "CAD",
        });

        await tx.insert(accounts).values([
          {
            id: linkedAccountId,
            ownerId: owner,
            institutionId,
            name: "Linked",
            kind: "checking",
            currency: "CAD",
            timelineOrder: 0,
            includeInAvailableCash: true,
            useCashFlowPlannedTimeline: true,
          },
          {
            id: reserveAccountId,
            ownerId: owner,
            institutionId,
            name: "Reserve",
            kind: "savings",
            currency: "CAD",
            timelineOrder: 1,
          },
        ]);

        // Three past pay periods, one current, and three future so the
        // dashboard window (past 2 / future 3) covers every upcoming period.
        await tx.insert(cashFlowPeriods).values(
          [-3, -2, -1, 0, 1, 2, 3].map((offset) => {
            const payDate = addIsoDays(asOf, offset * 14);
            return {
              ownerId: owner,
              label: `Pay period ${payDate}`,
              startsOn: addIsoDays(payDate, -13),
              endsOn: payDate,
              payDate,
              openingBalanceMinor: 0,
              currency: "CAD" as const,
              status: "planned" as const,
            };
          }),
        );

        await tx.insert(balanceSnapshots).values({
          ownerId: owner,
          accountId: linkedAccountId,
          asOf,
          balanceMinor: 12_500,
          status: "actual",
          isGenerated: false,
          currency: "CAD",
        });

        await tx.insert(homes).values({
          id: homeId,
          ownerId: owner,
          name: "Home A",
          currency: "CAD",
        });

        // Pre-change composition: the same repositories called the way the
        // read model used to orchestrate them (no shared preloads).
        const oldObservation = { queryCount: 0 };
        const oldModel = await withDatabaseObservation(
          "dashboard-pre-change-composition",
          async () => {
            const cashFlow = createCashFlowRepository(tx as unknown as Database);
            const netWorthHistory = createNetWorthHistoryRepository(tx as unknown as Database);
            const [periodWindow, upcomingPeriods, home, history] = await Promise.all([
              cashFlow.getPeriodWindow(owner, { asOfIso: asOf, pastPeriods: 2, futurePeriods: 3 }),
              cashFlow.listUpcoming(owner, asOf),
              createHomeRepository(tx as unknown as Database).getHome(owner, { timelineThrough: homeTimelineThrough }),
              netWorthHistory.getHistory(owner, { evaluationDate: asOf }),
            ]);
            return { periodWindow, upcomingPeriods, home, netWorthHistory: history };
          },
          {
            onObservation: (observation) => {
              oldObservation.queryCount = observation.queryCount;
            },
          },
        );

        const newObservation = { queryCount: 0 };
        const newModel = await withDatabaseObservation(
          "dashboard-getDashboardReadModel",
          async () => getDashboardReadModel(tx as unknown as Database, owner, asOf),
          {
            onObservation: (observation) => {
              newObservation.queryCount = observation.queryCount;
            },
          },
        );

        // Behaviour-preserving: the fields the Phase 2 refactor rewires must
        // be identical to the pre-change composition on this fixture.
        expect(newModel.upcomingPeriods).toEqual(oldModel.upcomingPeriods);
        expect(newModel.upcomingPeriods).toHaveLength(4);
        expect(newModel.periodWindow).toEqual(oldModel.periodWindow);
        expect(newModel.home).toEqual(oldModel.home);
        expect(newModel.netWorthHistory).toEqual(oldModel.netWorthHistory);

        expect(oldObservation.queryCount).toBeGreaterThan(0);
        expect(newObservation.queryCount).toBeLessThan(oldObservation.queryCount);
        // Measured Phase 2 composition for this fixture: 1 listPeriods +
        // 8 getPeriodWindow (period rows now preloaded) + 2 annual + 3
        // investment + 3 latest balances + 4 getHome + 10 getTimeline
        // (preloaded paydays) = 31 statements. Headroom of one guards against
        // a single instrumentation-level statement; a reintroduced N+1 far
        // exceeds it.
        expect(newObservation.queryCount).toBeLessThanOrEqual(32);

        throw rollbackMarker;
      }),
      rollbackMarker,
    );
  });
});
