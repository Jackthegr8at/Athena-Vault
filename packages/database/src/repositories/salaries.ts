import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import {
  salaryScenarios,
} from "../drizzle-schema";

export type SalaryScenarioView = Pick<
  typeof salaryScenarios.$inferSelect,
  "id" | "name" | "effectiveOn" | "annualGrossMinor" | "annualNetMinor" | "perPayMinor" | "payPeriodsPerYear" | "status" | "currency"
>;


export function createSalaryRepository(db: Database) {
  async function listByOwner(ownerId: string): Promise<readonly SalaryScenarioView[]> {
    return db.select({
      id: salaryScenarios.id,
      name: salaryScenarios.name,
      effectiveOn: salaryScenarios.effectiveOn,
      annualGrossMinor: salaryScenarios.annualGrossMinor,
      annualNetMinor: salaryScenarios.annualNetMinor,
      perPayMinor: salaryScenarios.perPayMinor,
      payPeriodsPerYear: salaryScenarios.payPeriodsPerYear,
      status: salaryScenarios.status,
      currency: salaryScenarios.currency,
    }).from(salaryScenarios)
      .where(eq(salaryScenarios.ownerId, ownerId))
      .orderBy(desc(salaryScenarios.effectiveOn), asc(salaryScenarios.name), asc(salaryScenarios.id));
  }

  return {
    listByOwner,
    async getCurrent(ownerId: string, asOfIso = new Date().toISOString().slice(0, 10)): Promise<SalaryScenarioView | null> {
      const scenarios = await listByOwner(ownerId);
      return scenarios.find((scenario) => scenario.status === "accepted" && scenario.effectiveOn <= asOfIso)
        ?? scenarios.find((scenario) => scenario.status === "accepted")
        ?? scenarios[0]
        ?? null;
    },
  };
}
