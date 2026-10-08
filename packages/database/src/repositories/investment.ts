import { asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  investmentAccounts,
  investmentScenarios,
  investmentSnapshots,
} from "../drizzle-schema";

export interface InvestmentAccountView {
  readonly id: string;
  readonly name: string;
  readonly kind: (typeof investmentAccounts.$inferSelect)["kind"];
  readonly currency: (typeof investmentAccounts.$inferSelect)["currency"];
  readonly latest: {
    readonly asOf: string;
    readonly balanceMinor: number;
    readonly contributionMinor: number;
    readonly withdrawalMinor: number;
  } | null;
}


export type InvestmentScenarioView = Pick<
  typeof investmentScenarios.$inferSelect,
  "id" | "name" | "startsOn" | "initialValueMinor" | "periodicContributionMinor" | "contributionFrequency" | "annualReturnBps" | "compoundingPeriodsPerYear" | "horizonYears" | "status" | "currency"
>;


export function createInvestmentRepository(db: Database) {
  async function listAccounts(ownerId: string): Promise<readonly InvestmentAccountView[]> {
    const [accountRows, snapshotRows] = await Promise.all([
      db.select({ id: investmentAccounts.id, name: investmentAccounts.name, kind: investmentAccounts.kind, currency: investmentAccounts.currency })
        .from(investmentAccounts)
        .where(eq(investmentAccounts.ownerId, ownerId))
        .orderBy(asc(investmentAccounts.name), asc(investmentAccounts.id)),
      (() => {
        const ranked = db.$with("ranked").as(
          db.select({
            investmentAccountId: investmentSnapshots.investmentAccountId,
            asOf: investmentSnapshots.asOf,
            balanceMinor: investmentSnapshots.balanceMinor,
            contributionMinor: investmentSnapshots.contributionMinor,
            withdrawalMinor: investmentSnapshots.withdrawalMinor,
            id: investmentSnapshots.id,
            rn: sql`row_number() over (partition by ${investmentSnapshots.investmentAccountId} order by ${investmentSnapshots.asOf} desc, ${investmentSnapshots.id} asc)`.as("rn"),
          }).from(investmentSnapshots)
            .where(eq(investmentSnapshots.ownerId, ownerId)),
        );
        return db.with(ranked).select({
          investmentAccountId: ranked.investmentAccountId,
          asOf: ranked.asOf,
          balanceMinor: ranked.balanceMinor,
          contributionMinor: ranked.contributionMinor,
          withdrawalMinor: ranked.withdrawalMinor,
        }).from(ranked)
          .where(sql`rn = 1`)
          .orderBy(asc(ranked.investmentAccountId));
      })(),
    ]);
    const latestByAccount = new Map(snapshotRows.map((row) => [row.investmentAccountId, row] as const));
    return accountRows.map((account) => {
      const latest = latestByAccount.get(account.id);
      return {
        ...account,
        latest: latest ? {
          asOf: latest.asOf,
          balanceMinor: latest.balanceMinor,
          contributionMinor: latest.contributionMinor,
          withdrawalMinor: latest.withdrawalMinor,
        } : null,
      };
    });
  }

  async function listScenarios(ownerId: string): Promise<readonly InvestmentScenarioView[]> {
    return db.select({
      id: investmentScenarios.id,
      name: investmentScenarios.name,
      startsOn: investmentScenarios.startsOn,
      initialValueMinor: investmentScenarios.initialValueMinor,
      periodicContributionMinor: investmentScenarios.periodicContributionMinor,
      contributionFrequency: investmentScenarios.contributionFrequency,
      annualReturnBps: investmentScenarios.annualReturnBps,
      compoundingPeriodsPerYear: investmentScenarios.compoundingPeriodsPerYear,
      horizonYears: investmentScenarios.horizonYears,
      status: investmentScenarios.status,
      currency: investmentScenarios.currency,
    }).from(investmentScenarios)
      .where(eq(investmentScenarios.ownerId, ownerId))
      .orderBy(desc(investmentScenarios.status), desc(investmentScenarios.annualReturnBps), asc(investmentScenarios.name), asc(investmentScenarios.id));
  }

  return {
    listAccounts,
    listScenarios,
    async getSummary(ownerId: string) {
      const [accountsForOwner, scenarios] = await Promise.all([listAccounts(ownerId), listScenarios(ownerId)]);
      return {
        accounts: accountsForOwner,
        scenarios,
        currentValueMinor: accountsForOwner.reduce((sum, account) => sum + (account.latest?.balanceMinor ?? 0), 0),
        monthlyContributionMinor: scenarios.find((scenario) => scenario.status === "accepted")?.periodicContributionMinor ?? 0,
      };
    },
  };
}
