import { and, asc, eq } from "drizzle-orm";
import {
  calculateMortgagePayment,
  projectMortgageTimeline,
  type MortgageCompoundingConvention,
  type MortgageProjectionAnchor,
  type MortgageProjectionPoint,
  type MortgageProjectionTerm,
  type MortgageProjectionStatus,
} from "@athena/finance-engine";
import type { Database } from "./client";
import { addIsoDays, isIsoDate } from "./account-contributions";
import { toTorontoDateIso } from "./account-timeline";
import {
  auditEvents,
  homeMortgageAnchors,
  homeMortgageTerms,
  homeValueSnapshots,
  homes,
  householdExpenses,
} from "./drizzle-schema";

export interface HomeValueSnapshotView {
  readonly id: string;
  readonly asOf: string;
  readonly marketValueMinor: number;
}

export interface HomeMortgageTermView {
  readonly id: string;
  readonly effectiveOn: string;
  readonly annualRateBps: number;
  readonly compoundingConvention: MortgageCompoundingConvention;
  readonly paymentExpenseId: string;
  readonly paymentExpenseName: string;
  readonly paymentMinor: number;
  readonly nextPaymentOn: string;
  readonly renewalOn: string;
  readonly payoffOn: string;
}

export interface HomeMortgageAnchorView {
  readonly id: string;
  readonly asOf: string;
  readonly principalMinor: number;
}

export interface HomeTimelineRow {
  readonly asOf: string;
  readonly marketValueMinor: number | null;
  readonly marketValueStatus: "actual" | "projected" | null;
  readonly mortgagePrincipalMinor: number | null;
  readonly mortgageStatus: MortgageProjectionStatus | null;
  readonly paymentMinor: number | null;
  readonly interestMinor: number | null;
  readonly principalPortionMinor: number | null;
  readonly equityMinor: number | null;
}

export interface HomeView {
  readonly id: string;
  readonly name: string;
  readonly currency: "CAD" | "USD" | "EUR";
  readonly values: readonly HomeValueSnapshotView[];
  readonly mortgageTerms: readonly HomeMortgageTermView[];
  readonly mortgageAnchors: readonly HomeMortgageAnchorView[];
  readonly timeline: readonly HomeTimelineRow[];
  /** Horizon used to build timeline; consumers may safely slice through this date. */
  readonly timelineThrough?: string;
  readonly currentEquityMinor: number | null;
  readonly mortgageConfigured: boolean;
}

export interface HomeMarketValueInput {
  readonly asOf: string;
  readonly marketValueMinor: number;
}

export interface HomeMortgageAnchorInput {
  readonly asOf: string;
  readonly principalMinor: number;
}

export interface HomeMortgageTermInput {
  readonly id?: string;
  readonly effectiveOn: string;
  readonly annualRateBps: number;
  readonly compoundingConvention: MortgageCompoundingConvention;
  readonly paymentExpenseId: string;
  readonly nextPaymentOn: string;
  readonly renewalOn: string;
  readonly payoffOn: string;
}

interface HomeTermRow {
  readonly id: string;
  readonly effectiveOn: string;
  readonly annualRateBps: number;
  readonly compoundingConvention: MortgageCompoundingConvention;
  readonly paymentExpenseId: string;
  readonly paymentExpenseName: string;
  readonly paymentMinor: number;
  readonly nextPaymentOn: string;
  readonly renewalOn: string;
  readonly payoffOn: string;
}

interface HomeProjectionInput {
  readonly home: { readonly id: string; readonly name: string; readonly currency: "CAD" | "USD" | "EUR" };
  readonly values: readonly HomeValueSnapshotView[];
  readonly terms: readonly HomeTermRow[];
  readonly anchors: readonly HomeMortgageAnchorView[];
  readonly todayIso?: string;
}

const MAX_HOME_TIMELINE_POINTS = 2_000;

function assertSafeNonnegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function assertIsoDate(value: string, label: string): void {
  if (!isIsoDate(value)) throw new RangeError(`${label} must be a valid ISO date.`);
}

function safeSubtract(left: number, right: number, label: string): number {
  const result = BigInt(left) - BigInt(right);
  if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} is outside the safe integer range.`);
  return Number(result);
}

function minIsoDate(values: readonly string[]): string | null {
  return values.reduce<string | null>((current, value) => current === null || value < current ? value : current, null);
}

function maxIsoDate(values: readonly string[]): string | null {
  return values.reduce<string | null>((current, value) => current === null || value > current ? value : current, null);
}

function paymentDatesForTerms(terms: readonly HomeTermRow[]): string[] {
  const dates = new Set<string>();
  for (const term of terms) {
    let date = term.nextPaymentOn;
    let count = 0;
    while (date <= term.payoffOn && count < MAX_HOME_TIMELINE_POINTS) {
      dates.add(date);
      date = addIsoDays(date, 14);
      count += 1;
    }
  }
  return [...dates];
}

function mortgageProjectionDates(terms: readonly HomeTermRow[], anchors: readonly HomeMortgageAnchorView[]): string[] {
  if (terms.length === 0 || anchors.length === 0) return [];
  return [...new Set([...paymentDatesForTerms(terms), ...anchors.map((anchor) => anchor.asOf)])];
}

function pointByDate(points: readonly MortgageProjectionPoint[]): ReadonlyMap<string, MortgageProjectionPoint> {
  return new Map(points.map((point) => [point.asOf, point]));
}

export function buildHomeTimeline(input: HomeProjectionInput): readonly HomeTimelineRow[] {
  const todayIso = input.todayIso ?? toTorontoDateIso();
  assertIsoDate(todayIso, "Home timeline date");
  const knownDates = [
    ...input.values.map((value) => value.asOf),
    ...input.anchors.map((anchor) => anchor.asOf),
    ...input.terms.flatMap((term) => [term.effectiveOn, term.nextPaymentOn, term.renewalOn, term.payoffOn]),
    todayIso,
  ];
  const start = minIsoDate(knownDates);
  const end = maxIsoDate(knownDates);
  if (!start || !end) return [];

  const axisDates = new Set<string>();
  let axisDate = start;
  let axisCount = 0;
  while (axisDate <= end && axisCount < MAX_HOME_TIMELINE_POINTS) {
    axisDates.add(axisDate);
    axisDate = addIsoDays(axisDate, 14);
    axisCount += 1;
  }
  for (const date of knownDates) axisDates.add(date);
  for (const date of mortgageProjectionDates(input.terms, input.anchors)) axisDates.add(date);

  const sortedValues = [...input.values].sort((left, right) => left.asOf.localeCompare(right.asOf));
  const valuesByDate = new Map(sortedValues.map((value) => [value.asOf, value]));
  const sortedDates = [...axisDates].sort();
  const mortgagePoints = projectMortgageTimeline(
    sortedDates,
    input.anchors.map<MortgageProjectionAnchor>((anchor) => ({ asOf: anchor.asOf, principalMinor: anchor.principalMinor })),
    input.terms.map<MortgageProjectionTerm>((term) => ({
      effectiveOn: term.effectiveOn,
      annualRateBps: term.annualRateBps,
      compoundingConvention: term.compoundingConvention,
      paymentMinor: term.paymentMinor,
      nextPaymentOn: term.nextPaymentOn,
      renewalOn: term.renewalOn,
      payoffOn: term.payoffOn,
    })),
  );
  const mortgageByDate = pointByDate(mortgagePoints);
  const rows: HomeTimelineRow[] = [];
  let carriedValue: HomeValueSnapshotView | null = null;

  for (const asOf of sortedDates) {
    const exactValue = valuesByDate.get(asOf);
    if (exactValue) carriedValue = exactValue;
    const mortgage = mortgageByDate.get(asOf);
    const marketValueMinor = carriedValue?.marketValueMinor ?? null;
    const mortgagePrincipalMinor = mortgage?.principalMinor ?? null;
    const equityMinor = marketValueMinor === null
      ? null
      : input.terms.length === 0 && input.anchors.length === 0
        ? marketValueMinor
        : mortgagePrincipalMinor === null
          ? null
          : safeSubtract(marketValueMinor, mortgagePrincipalMinor, "Home equity");
    rows.push({
      asOf,
      marketValueMinor,
      marketValueStatus: carriedValue ? (exactValue ? "actual" : "projected") : null,
      mortgagePrincipalMinor,
      mortgageStatus: mortgage?.status ?? null,
      paymentMinor: mortgage?.paymentMinor ?? null,
      interestMinor: mortgage ? mortgage.interestMinor : null,
      principalPortionMinor: mortgage ? mortgage.principalPortionMinor : null,
      equityMinor,
    });
  }
  return rows;
}

function homeView(input: HomeProjectionInput): HomeView {
  const timeline = buildHomeTimeline(input);
  const timelineThrough = input.todayIso;
  const currentDateIso = toTorontoDateIso();
  const currentEquityMinor = [...timeline].reverse().find((row) => row.asOf <= currentDateIso && row.equityMinor !== null)?.equityMinor ?? null;
  return {
    id: input.home.id,
    name: input.home.name,
    currency: input.home.currency,
    values: input.values,
    mortgageTerms: input.terms,
    mortgageAnchors: input.anchors,
    timeline,
    ...(timelineThrough ? { timelineThrough } : {}),
    currentEquityMinor,
    mortgageConfigured: input.terms.length > 0 || input.anchors.length > 0,
  };
}

async function ownerHome(db: Database, ownerId: string): Promise<{ id: string; name: string; currency: "CAD" | "USD" | "EUR" }> {
  const [home] = await db.select({ id: homes.id, name: homes.name, currency: homes.currency })
    .from(homes)
    .where(eq(homes.ownerId, ownerId))
    .limit(1);
  if (!home) throw new Error("Home profile not found.");
  return home;
}

export function createHomeRepository(db: Database) {
  async function getHome(ownerId: string, options: { readonly timelineThrough?: string } = {}): Promise<HomeView | null> {
    const [home] = await db.select({ id: homes.id, name: homes.name, currency: homes.currency })
      .from(homes)
      .where(eq(homes.ownerId, ownerId))
      .limit(1);
    if (!home) return null;
    const [values, termRows, anchors] = await Promise.all([
      db.select({ id: homeValueSnapshots.id, asOf: homeValueSnapshots.asOf, marketValueMinor: homeValueSnapshots.marketValueMinor })
        .from(homeValueSnapshots)
        .where(and(eq(homeValueSnapshots.ownerId, ownerId), eq(homeValueSnapshots.homeId, home.id)))
        .orderBy(asc(homeValueSnapshots.asOf), asc(homeValueSnapshots.id)),
      db.select({
        id: homeMortgageTerms.id,
        effectiveOn: homeMortgageTerms.effectiveOn,
        annualRateBps: homeMortgageTerms.annualRateBps,
        compoundingConvention: homeMortgageTerms.compoundingConvention,
        paymentExpenseId: homeMortgageTerms.paymentExpenseId,
        paymentExpenseName: householdExpenses.name,
        paymentMinor: homeMortgageTerms.paymentMinor,
        nextPaymentOn: homeMortgageTerms.nextPaymentOn,
        renewalOn: homeMortgageTerms.renewalOn,
        payoffOn: homeMortgageTerms.payoffOn,
      })
        .from(homeMortgageTerms)
        .innerJoin(householdExpenses, and(eq(householdExpenses.id, homeMortgageTerms.paymentExpenseId), eq(householdExpenses.ownerId, ownerId)))
        .where(and(eq(homeMortgageTerms.ownerId, ownerId), eq(homeMortgageTerms.homeId, home.id)))
        .orderBy(asc(homeMortgageTerms.effectiveOn), asc(homeMortgageTerms.id)),
      db.select({ id: homeMortgageAnchors.id, asOf: homeMortgageAnchors.asOf, principalMinor: homeMortgageAnchors.principalMinor })
        .from(homeMortgageAnchors)
        .where(and(eq(homeMortgageAnchors.ownerId, ownerId), eq(homeMortgageAnchors.homeId, home.id)))
        .orderBy(asc(homeMortgageAnchors.asOf), asc(homeMortgageAnchors.id)),
    ]);
    return homeView({ home, values, terms: termRows, anchors, todayIso: options.timelineThrough });
  }

  return {
    getHome,
    async getCurrentEquity(ownerId: string, asOf = toTorontoDateIso()): Promise<number | null> {
      const home = await getHome(ownerId);
      if (!home || !isIsoDate(asOf)) return null;
      return [...home.timeline].reverse().find((row) => row.asOf <= asOf && row.equityMinor !== null)?.equityMinor ?? null;
    },
    async createHome(ownerId: string): Promise<string> {
      try {
        const [created] = await db.transaction(async (tx) => {
          const [row] = await tx.insert(homes).values({ ownerId, name: "Home", currency: "CAD" }).returning({ id: homes.id });
          if (!row) throw new Error("Home profile insert returned no row.");
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "created", entityType: "home", entityId: row.id, metadata: {} });
          return [row] as const;
        });
        if (!created) throw new Error("Home profile insert returned no row.");
        return created.id;
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("A Home profile already exists.");
        throw error;
      }
    },
    async upsertMarketValue(ownerId: string, input: HomeMarketValueInput): Promise<void> {
      assertIsoDate(input.asOf, "Market value date");
      assertSafeNonnegative(input.marketValueMinor, "Market value");
      const home = await ownerHome(db, ownerId);
      await db.transaction(async (tx) => {
        const [saved] = await tx.insert(homeValueSnapshots).values({
          ownerId,
          homeId: home.id,
          asOf: input.asOf,
          marketValueMinor: input.marketValueMinor,
        }).onConflictDoUpdate({
          target: [homeValueSnapshots.homeId, homeValueSnapshots.asOf],
          set: { marketValueMinor: input.marketValueMinor, updatedAt: new Date() },
        }).returning({ id: homeValueSnapshots.id });
        if (!saved) throw new Error("Home market value save returned no row.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "home_value_snapshot", entityId: saved.id, metadata: { asOf: input.asOf } });
      });
    },
    async deleteMarketValue(ownerId: string, asOf: string): Promise<void> {
      assertIsoDate(asOf, "Market value date");
      const home = await ownerHome(db, ownerId);
      await db.transaction(async (tx) => {
        const deleted = await tx.delete(homeValueSnapshots)
          .where(and(eq(homeValueSnapshots.ownerId, ownerId), eq(homeValueSnapshots.homeId, home.id), eq(homeValueSnapshots.asOf, asOf)))
          .returning({ id: homeValueSnapshots.id });
        if (deleted.length === 0) throw new Error("Home market value not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "deleted", entityType: "home_value_snapshot", entityId: deleted[0]!.id, metadata: { asOf } });
      });
    },
    async upsertMortgageAnchor(ownerId: string, input: HomeMortgageAnchorInput): Promise<void> {
      assertIsoDate(input.asOf, "Mortgage balance date");
      if (input.asOf > toTorontoDateIso()) throw new RangeError("Actual mortgage balances cannot be future-dated.");
      assertSafeNonnegative(input.principalMinor, "Mortgage principal");
      const home = await ownerHome(db, ownerId);
      await db.transaction(async (tx) => {
        const [saved] = await tx.insert(homeMortgageAnchors).values({
          ownerId,
          homeId: home.id,
          asOf: input.asOf,
          principalMinor: input.principalMinor,
        }).onConflictDoUpdate({
          target: [homeMortgageAnchors.homeId, homeMortgageAnchors.asOf],
          set: { principalMinor: input.principalMinor, updatedAt: new Date() },
        }).returning({ id: homeMortgageAnchors.id });
        if (!saved) throw new Error("Mortgage balance anchor save returned no row.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "home_mortgage_anchor", entityId: saved.id, metadata: { asOf: input.asOf } });
      });
    },
    async deleteMortgageAnchor(ownerId: string, asOf: string): Promise<void> {
      assertIsoDate(asOf, "Mortgage balance date");
      const home = await ownerHome(db, ownerId);
      await db.transaction(async (tx) => {
        const deleted = await tx.delete(homeMortgageAnchors)
          .where(and(eq(homeMortgageAnchors.ownerId, ownerId), eq(homeMortgageAnchors.homeId, home.id), eq(homeMortgageAnchors.asOf, asOf)))
          .returning({ id: homeMortgageAnchors.id });
        if (deleted.length === 0) throw new Error("Mortgage balance anchor not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "deleted", entityType: "home_mortgage_anchor", entityId: deleted[0]!.id, metadata: { asOf } });
      });
    },
    async saveMortgageTerms(ownerId: string, input: HomeMortgageTermInput): Promise<void> {
      for (const [value, label] of [
        [input.effectiveOn, "Mortgage effective date"],
        [input.nextPaymentOn, "Next mortgage payment date"],
        [input.renewalOn, "Mortgage renewal date"],
        [input.payoffOn, "Mortgage payoff date"],
      ] as const) assertIsoDate(value, label);
      if (!Number.isSafeInteger(input.annualRateBps) || input.annualRateBps < 0 || input.annualRateBps > 10_000) throw new RangeError("Annual mortgage rate must be between 0% and 100%.");
      if (!( ["canadian_semi_annual", "annual", "monthly"] as readonly string[]).includes(input.compoundingConvention)) throw new RangeError("Mortgage compounding convention is invalid.");
      if (input.nextPaymentOn < input.effectiveOn || input.renewalOn <= input.effectiveOn || input.payoffOn <= input.effectiveOn) throw new RangeError("Mortgage term dates are not in a valid order.");
      const home = await ownerHome(db, ownerId);
      await db.transaction(async (tx) => {
        const [expense] = await tx.select({ id: householdExpenses.id, amountMinor: householdExpenses.amountMinor, frequency: householdExpenses.frequency, isActive: householdExpenses.isActive })
          .from(householdExpenses)
          .where(and(eq(householdExpenses.ownerId, ownerId), eq(householdExpenses.id, input.paymentExpenseId), eq(householdExpenses.isActive, true)))
          .limit(1);
        if (!expense) throw new Error("Payment expense not found.");
        if (expense.frequency !== "biweekly" || expense.amountMinor <= 0) throw new Error("Mortgage payment source must be an active biweekly household expense greater than zero.");
        const values = {
          ownerId,
          homeId: home.id,
          effectiveOn: input.effectiveOn,
          annualRateBps: input.annualRateBps,
          compoundingConvention: input.compoundingConvention,
          paymentExpenseId: expense.id,
          paymentMinor: expense.amountMinor,
          nextPaymentOn: input.nextPaymentOn,
          renewalOn: input.renewalOn,
          payoffOn: input.payoffOn,
          updatedAt: new Date(),
        };
        let savedId: string | null = null;
        if (input.id) {
          const [updated] = await tx.update(homeMortgageTerms).set(values)
            .where(and(eq(homeMortgageTerms.id, input.id), eq(homeMortgageTerms.ownerId, ownerId), eq(homeMortgageTerms.homeId, home.id)))
            .returning({ id: homeMortgageTerms.id });
          if (!updated) throw new Error("Mortgage term not found.");
          savedId = updated.id;
        } else {
          const [created] = await tx.insert(homeMortgageTerms).values(values).onConflictDoUpdate({
            target: [homeMortgageTerms.homeId, homeMortgageTerms.effectiveOn],
            set: values,
          }).returning({ id: homeMortgageTerms.id });
          if (!created) throw new Error("Mortgage term save returned no row.");
          savedId = created.id;
        }
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: input.id ? "updated" : "created", entityType: "home_mortgage_terms", entityId: savedId, metadata: { effectiveOn: input.effectiveOn, paymentExpenseId: expense.id } });
      });
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

export { calculateMortgagePayment };
