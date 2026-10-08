import { money, type InvestmentContributionEvent } from "@athena/finance-engine";
import {
  expandRecurringCashFlowOccurrences,
  isRecurringCashFlowIsoDate,
  type RecurringCashFlowFrequency,
  type RecurringCashFlowVersionSchedule,
  type RecurringOccurrenceException,
} from "./recurring-cash-flow";

export type InvestmentCashFlowSeriesState = "active" | "paused" | "ended";

export interface InvestmentCashFlowSeriesSource {
  readonly seriesId: string;
  readonly state: InvestmentCashFlowSeriesState;
  readonly endedOn: string | null;
  readonly versions: readonly RecurringCashFlowVersionSchedule[];
  readonly exceptions: readonly RecurringOccurrenceException[];
}

/**
 * The endpoint route for one recurring Cash Flow transfer matched to an
 * investment account.  The route is kept separate from the contribution
 * amount so a destination contribution cannot be mistaken for a source
 * account outflow.
 */
export interface InvestmentCashFlowTransferRoute {
  readonly seriesId: string;
  readonly versionId: string;
  readonly scheduledOccurrenceOn: string;
  readonly effectiveDate: string;
  readonly fromAccountId: string | null;
  readonly toAccountId: string;
}

/**
 * One funding-side transfer-out event.  Its amount is signed negative for
 * the funding account, while the corresponding `events` contribution remains
 * positive for the investment projection.  This resolver only returns the
 * view; it never writes or regenerates Cash Flow rows.
 */
export interface InvestmentCashFlowTransferOutEvent extends InvestmentCashFlowTransferRoute {
  readonly amountMinor: number;
}

export interface InvestmentCashFlowSourceView {
  readonly seriesId: string;
  readonly name: string;
  readonly frequency: RecurringCashFlowFrequency | "mixed";
  readonly amountMinor: number;
  readonly occurrenceCount: number;
  readonly totalAmountMinor: number;
  readonly firstOccurrenceOn: string | null;
  readonly lastOccurrenceOn: string | null;
  readonly routes: readonly InvestmentCashFlowTransferRoute[];
}

export interface InvestmentCashFlowContributionResolution {
  readonly events: readonly InvestmentContributionEvent[];
  readonly transferOutEvents: readonly InvestmentCashFlowTransferOutEvent[];
  readonly sources: readonly InvestmentCashFlowSourceView[];
  readonly warnings: readonly string[];
}

export interface ResolveInvestmentCashFlowContributionInput {
  readonly targetAccountId: string | null;
  readonly baselineDate: string;
  readonly horizonYears: number;
  readonly sources: readonly InvestmentCashFlowSeriesSource[];
}

export interface InvestmentCashFlowDestinationCandidate {
  readonly id: string;
  readonly name: string;
}

export type InvestmentCashFlowLinkSource = "saved" | "detected" | "none";

export interface InvestmentCashFlowDestinationResolution {
  readonly accountId: string | null;
  readonly source: InvestmentCashFlowLinkSource;
}

function normalizeDestinationName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Finds the operational Cash Flow destination for an investment account when
 * the explicit link has not been saved yet.  This is intentionally a strict
 * convenience inference: recurring transfer destination IDs are collected
 * first, then matched to exactly one operational account by normalized name.
 * The recurring resolver still matches occurrences by ID, and this helper
 * never writes the inferred link back to the database.
 */
export function inferInvestmentCashFlowDestination(
  investmentAccountName: string,
  savedAccountId: string | null,
  candidates: readonly InvestmentCashFlowDestinationCandidate[],
  sources: readonly InvestmentCashFlowSeriesSource[],
): InvestmentCashFlowDestinationResolution {
  if (savedAccountId) return { accountId: savedAccountId, source: "saved" };

  const destinationIds = new Set<string>();
  for (const source of sources) {
    if (source.state !== "active") continue;
    for (const version of source.versions) {
      if (version.toAccountId) destinationIds.add(version.toAccountId);
    }
    for (const exception of source.exceptions) {
      if (exception.isActive && exception.toAccountOverrideId) destinationIds.add(exception.toAccountOverrideId);
    }
  }

  const normalizedName = normalizeDestinationName(investmentAccountName);
  const matches = candidates.filter((candidate) =>
    destinationIds.has(candidate.id) && normalizeDestinationName(candidate.name) === normalizedName,
  );
  return matches.length === 1
    ? { accountId: matches[0]!.id, source: "detected" }
    : { accountId: null, source: "none" };
}

const supportedContributionFrequencies = new Set<RecurringCashFlowFrequency>(["monthly", "biweekly"]);

function parseIsoDate(value: string): Date {
  if (!isRecurringCashFlowIsoDate(value)) throw new RangeError("Investment Cash Flow dates must be valid ISO dates.");
  return new Date(`${value}T00:00:00Z`);
}

function toIsoDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function addYearsClamped(value: string, years: number): string {
  const date = parseIsoDate(value);
  const targetYear = date.getUTCFullYear() + years;
  const targetMonth = date.getUTCMonth();
  const targetDay = Math.min(date.getUTCDate(), new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  return toIsoDate(new Date(Date.UTC(targetYear, targetMonth, targetDay)));
}

function assertSafeMinorAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Investment Cash Flow amounts must be positive integer minor units.");
}

function versionById(source: InvestmentCashFlowSeriesSource): ReadonlyMap<string, RecurringCashFlowVersionSchedule> {
  return new Map(source.versions.map((version) => [version.id, version] as const));
}

function sourceName(source: InvestmentCashFlowSeriesSource): string {
  const latest = [...source.versions].sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  return latest?.name ?? "Unnamed recurring transfer";
}

function sourceFrequency(source: InvestmentCashFlowSeriesSource): RecurringCashFlowFrequency | "mixed" {
  const frequencies = new Set(source.versions.map((version) => version.frequency));
  if (frequencies.size === 1) return [...frequencies][0]!;
  return "mixed";
}

function terminalVersionForSource(source: InvestmentCashFlowSeriesSource): RecurringCashFlowVersionSchedule | undefined {
  return [...source.versions]
    .filter((version) => version.seriesId === source.seriesId)
    .sort((left, right) =>
      left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id),
    )
    .at(-1);
}

function sourceTargetsAccount(source: InvestmentCashFlowSeriesSource, targetAccountId: string): boolean {
  const terminalVersion = terminalVersionForSource(source);
  if (!terminalVersion) return false;

  return terminalVersion.toAccountId === targetAccountId
    || source.exceptions.some((exception) =>
      exception.isActive
      && exception.seriesId === source.seriesId
      && exception.versionId === terminalVersion.id
      && exception.toAccountOverrideId === targetAccountId,
    );
}

function inactiveSourceWarning(source: InvestmentCashFlowSeriesSource): string {
  if (source.state === "paused") {
    return `${sourceName(source)} is paused in Cash Flow; resume it to include future automatic contributions.`;
  }
  return `${sourceName(source)} ended in Cash Flow${source.endedOn ? ` on ${source.endedOn}` : ""}; create a new active source to include future automatic contributions.`;
}

function addSafe(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new RangeError("Investment Cash Flow contributions exceed the safe integer range.");
  return total;
}

/**
 * Resolves active recurring Cash Flow transfers into dated investment events
 * and reports linked paused/ended sources without including their events.
 * This is deliberately a pure boundary: it never creates or edits Cash Flow rows.
 */
export function resolveInvestmentCashFlowContributions(
  input: ResolveInvestmentCashFlowContributionInput,
): InvestmentCashFlowContributionResolution {
  if (!isRecurringCashFlowIsoDate(input.baselineDate)) throw new RangeError("Investment Cash Flow baseline date must be valid.");
  if (!Number.isSafeInteger(input.horizonYears) || input.horizonYears < 1 || input.horizonYears > 35) throw new RangeError("Investment Cash Flow horizon must be between 1 and 35 years.");
  const targetAccountId = input.targetAccountId;
  if (!targetAccountId) {
    return {
      events: [],
      transferOutEvents: [],
      sources: [],
      warnings: ["This investment account is not linked to a Cash Flow account."],
    };
  }

  const requestedStart = addYearsClamped(input.baselineDate, -1);
  const requestedEnd = addYearsClamped(input.baselineDate, input.horizonYears);
  const eventTotals = new Map<string, number>();
  const transferOutEvents: InvestmentCashFlowTransferOutEvent[] = [];
  const sourceViews: InvestmentCashFlowSourceView[] = [];
  const warnings: string[] = [];

  for (const source of input.sources) {
    if (source.state !== "active") {
      if (sourceTargetsAccount(source, targetAccountId)) warnings.push(inactiveSourceWarning(source));
      continue;
    }
    const occurrences = expandRecurringCashFlowOccurrences(
      source.seriesId,
      source.versions,
      source.exceptions,
      requestedStart,
      requestedEnd,
    );
    const versions = versionById(source);
    const matching = occurrences.filter((occurrence) => {
      const version = versions.get(occurrence.versionId);
      const effectiveDate = occurrence.transactionDate ?? occurrence.scheduledOccurrenceOn;
      return occurrence.kind === "transfer"
        && occurrence.toAccountId === targetAccountId
        && !occurrence.isSkipped
        && occurrence.status === "planned"
        && effectiveDate > input.baselineDate
        && effectiveDate <= requestedEnd
        && version !== undefined
        && supportedContributionFrequencies.has(version.frequency);
    });
    const unsupportedMatching = occurrences.some((occurrence) => {
      const version = versions.get(occurrence.versionId);
      return occurrence.kind === "transfer"
        && occurrence.toAccountId === targetAccountId
        && !occurrence.isSkipped
        && occurrence.status === "planned"
        && version !== undefined
        && !supportedContributionFrequencies.has(version.frequency);
    });
    if (unsupportedMatching) {
      warnings.push(`${sourceName(source)} uses an unsupported recurring frequency; only monthly and biweekly transfers are included.`);
    }
    if (matching.length === 0) continue;

    let totalAmountMinor = 0;
    const routes: InvestmentCashFlowTransferRoute[] = [];
    for (const occurrence of matching) {
      assertSafeMinorAmount(occurrence.amountMinor);
      const effectiveDate = occurrence.transactionDate ?? occurrence.scheduledOccurrenceOn;
      eventTotals.set(effectiveDate, addSafe(eventTotals.get(effectiveDate) ?? 0, occurrence.amountMinor));
      totalAmountMinor = addSafe(totalAmountMinor, occurrence.amountMinor);

      const route = {
        seriesId: occurrence.seriesId,
        versionId: occurrence.versionId,
        scheduledOccurrenceOn: occurrence.scheduledOccurrenceOn,
        effectiveDate,
        fromAccountId: occurrence.fromAccountId,
        // The match proves this is the requested destination.  Use the
        // target ID here to keep the route non-null for consumers.
        toAccountId: targetAccountId,
      } satisfies InvestmentCashFlowTransferRoute;
      routes.push(route);
      transferOutEvents.push({
        ...route,
        amountMinor: money(-occurrence.amountMinor),
      });
    }
    sourceViews.push({
      seriesId: source.seriesId,
      name: sourceName(source),
      frequency: sourceFrequency(source),
      amountMinor: matching.at(-1)?.amountMinor ?? 0,
      occurrenceCount: matching.length,
      totalAmountMinor,
      firstOccurrenceOn: routes[0]?.effectiveDate ?? null,
      lastOccurrenceOn: routes.at(-1)?.effectiveDate ?? null,
      routes,
    });
  }

  if (sourceViews.length === 0) warnings.push("No active monthly or biweekly Cash Flow transfer was found for this investment account.");
  if (sourceViews.length > 1) warnings.push("Multiple active Cash Flow transfer sources are aggregated for this investment account.");

  const events = [...eventTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([on, amountMinor]) => ({ on, amountMinor: money(amountMinor) } satisfies InvestmentContributionEvent));
  transferOutEvents.sort((left, right) =>
    left.effectiveDate.localeCompare(right.effectiveDate)
    || left.seriesId.localeCompare(right.seriesId)
    || left.versionId.localeCompare(right.versionId)
    || left.scheduledOccurrenceOn.localeCompare(right.scheduledOccurrenceOn),
  );
  return { events, transferOutEvents, sources: sourceViews, warnings: [...new Set(warnings)] };
}
