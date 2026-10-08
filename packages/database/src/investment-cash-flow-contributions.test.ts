import { describe, expect, it } from "vitest";
import {
  inferInvestmentCashFlowDestination,
  resolveInvestmentCashFlowContributions,
  type InvestmentCashFlowSeriesSource,
  type ResolveInvestmentCashFlowContributionInput,
} from "./investment-cash-flow-contributions";
import type { RecurringCashFlowVersionSchedule, RecurringOccurrenceException } from "./recurring-cash-flow";

const targetAccountId = "investment-account";

function version(overrides: Partial<RecurringCashFlowVersionSchedule> = {}): RecurringCashFlowVersionSchedule {
  return {
    id: "series-1-version-1",
    seriesId: "series-1",
    name: "Investment transfer",
    kind: "transfer",
    accountId: null,
    fromAccountId: "operating-account",
    toAccountId: targetAccountId,
    amountMinor: 100,
    frequency: "monthly",
    weekdayAdjustment: "none",
    startsOn: "2026-01-01",
    endsOn: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...overrides,
  };
}

function exception(overrides: Partial<RecurringOccurrenceException> = {}): RecurringOccurrenceException {
  return {
    id: "exception-1",
    seriesId: "series-1",
    versionId: "series-1-version-1",
    scheduledOccurrenceOn: "2026-02-01",
    kind: "override",
    dateOverride: null,
    amountOverrideMinor: null,
    accountOverrideId: null,
    fromAccountOverrideId: null,
    toAccountOverrideId: null,
    transferId: null,
    statusOverride: null,
    note: null,
    overrideGroupId: null,
    isActive: true,
    ...overrides,
  };
}

function source(overrides: Partial<InvestmentCashFlowSeriesSource> = {}): InvestmentCashFlowSeriesSource {
  return {
    seriesId: "series-1",
    state: "active",
    endedOn: null,
    versions: [version()],
    exceptions: [],
    ...overrides,
  };
}

function resolve(sources: readonly InvestmentCashFlowSeriesSource[], overrides: Partial<ResolveInvestmentCashFlowContributionInput> = {}) {
  return resolveInvestmentCashFlowContributions({
    targetAccountId,
    baselineDate: "2026-01-01",
    horizonYears: 1,
    sources,
    ...overrides,
  });
}

describe("resolveInvestmentCashFlowContributions", () => {
  it("detects a unique operational destination from an active recurring transfer", () => {
    expect(inferInvestmentCashFlowDestination(
      "Primerica",
      null,
      [{ id: targetAccountId, name: "Primerica" }, { id: "other-account", name: "Other" }],
      [source()],
    )).toEqual({ accountId: targetAccountId, source: "detected" });
  });

  it("prefers a saved destination and leaves ambiguous name matches unlinked", () => {
    expect(inferInvestmentCashFlowDestination(
      "Primerica",
      "saved-account",
      [{ id: targetAccountId, name: "Primerica" }],
      [source()],
    )).toEqual({ accountId: "saved-account", source: "saved" });
    expect(inferInvestmentCashFlowDestination(
      "Primerica",
      null,
      [{ id: targetAccountId, name: "Primerica" }, { id: "duplicate-account", name: "PRIMERICA" }],
      [source(), source({ seriesId: "series-2", versions: [version({ seriesId: "series-2", id: "series-2-version-1", toAccountId: "duplicate-account" })] })],
    )).toEqual({ accountId: null, source: "none" });
  });

  it("returns a warning and no events when the investment account has no Cash Flow link", () => {
    const result = resolve([source()], { targetAccountId: null });

    expect(result.events).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toContain("This investment account is not linked to a Cash Flow account.");
  });

  it("warns for a paused linked source without adding future automatic contributions", () => {
    const result = resolve([source({ state: "paused" })]);

    expect(result.events).toEqual([]);
    expect(result.transferOutEvents).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toContain("Investment transfer is paused in Cash Flow; resume it to include future automatic contributions.");
    expect(result.warnings).toContain("No active monthly or biweekly Cash Flow transfer was found for this investment account.");
  });

  it("warns for an ended linked source without adding future automatic contributions", () => {
    const result = resolve([source({ state: "ended", endedOn: "2026-03-01" })]);

    expect(result.events).toEqual([]);
    expect(result.transferOutEvents).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.warnings).toContain("Investment transfer ended in Cash Flow on 2026-03-01; create a new active source to include future automatic contributions.");
    expect(result.warnings).toContain("No active monthly or biweekly Cash Flow transfer was found for this investment account.");
  });

  it("does not warn for inactive sources that target another account", () => {
    const result = resolve([source({ state: "paused", versions: [version({ toAccountId: "other-account" })] })]);

    expect(result.warnings).not.toContain("Investment transfer is paused in Cash Flow; resume it to include future automatic contributions.");
    expect(result.warnings).toContain("No active monthly or biweekly Cash Flow transfer was found for this investment account.");
  });

  it("matches inactive warnings to the terminal destination instead of obsolete destinations", () => {
    const obsoleteVersion = version({
      id: "series-1-version-1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-05-01",
      toAccountId: targetAccountId,
    });
    const terminalVersion = version({
      id: "series-1-version-2",
      effectiveFrom: "2026-05-02",
      startsOn: "2026-05-02",
      toAccountId: "other-account",
    });
    const result = resolve([source({
      state: "paused",
      versions: [terminalVersion, obsoleteVersion],
      exceptions: [exception({
        id: "obsolete-destination-override",
        versionId: obsoleteVersion.id,
        toAccountOverrideId: targetAccountId,
      }), exception({
        id: "inactive-terminal-destination-override",
        versionId: terminalVersion.id,
        toAccountOverrideId: targetAccountId,
        isActive: false,
      })],
    })]);

    expect(result.events).toEqual([]);
    expect(result.transferOutEvents).toEqual([]);
    expect(result.warnings).not.toContain("Investment transfer is paused in Cash Flow; resume it to include future automatic contributions.");
    expect(result.warnings).toContain("No active monthly or biweekly Cash Flow transfer was found for this investment account.");
  });

  it("warns for an inactive source whose terminal version targets the investment account", () => {
    const priorVersion = version({
      id: "series-1-version-1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-05-01",
      toAccountId: "other-account",
    });
    const terminalVersion = version({
      id: "series-1-version-2",
      effectiveFrom: "2026-05-02",
      startsOn: "2026-05-02",
      toAccountId: targetAccountId,
    });
    const result = resolve([source({
      state: "ended",
      endedOn: "2026-06-01",
      versions: [terminalVersion, priorVersion],
    })]);

    expect(result.events).toEqual([]);
    expect(result.transferOutEvents).toEqual([]);
    expect(result.warnings).toContain("Investment transfer ended in Cash Flow on 2026-06-01; create a new active source to include future automatic contributions.");
    expect(result.warnings).toContain("No active monthly or biweekly Cash Flow transfer was found for this investment account.");
  });

  it("matches an active destination override attached to the terminal version", () => {
    const priorVersion = version({
      id: "series-1-version-1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-05-01",
      toAccountId: "other-account",
    });
    const terminalVersion = version({
      id: "series-1-version-2",
      effectiveFrom: "2026-05-02",
      startsOn: "2026-05-02",
      toAccountId: "other-account",
    });
    const result = resolve([source({
      state: "paused",
      versions: [priorVersion, terminalVersion],
      exceptions: [exception({
        id: "terminal-destination-override",
        versionId: terminalVersion.id,
        toAccountOverrideId: targetAccountId,
      })],
    })]);

    expect(result.events).toEqual([]);
    expect(result.transferOutEvents).toEqual([]);
    expect(result.warnings).toContain("Investment transfer is paused in Cash Flow; resume it to include future automatic contributions.");
    expect(result.warnings).toContain("No active monthly or biweekly Cash Flow transfer was found for this investment account.");
  });

  it("aggregates all matching sources by effective payment date", () => {
    const second = source({
      seriesId: "series-2",
      versions: [version({ id: "series-2-version-1", seriesId: "series-2", amountMinor: 250, fromAccountId: "second-operating-account" })],
    });

    const result = resolve([source(), second]);

    expect(result.events[0]).toEqual({ on: "2026-02-01", amountMinor: 350 });
    expect(result.transferOutEvents.filter((event) => event.effectiveDate === "2026-02-01")).toEqual([
      expect.objectContaining({
        amountMinor: -100,
        fromAccountId: "operating-account",
        toAccountId: targetAccountId,
        seriesId: "series-1",
      }),
      expect.objectContaining({
        amountMinor: -250,
        fromAccountId: "second-operating-account",
        toAccountId: targetAccountId,
        seriesId: "series-2",
      }),
    ]);
    expect(result.sources[0]?.routes[0]).toMatchObject({
      fromAccountId: "operating-account",
      toAccountId: targetAccountId,
      effectiveDate: "2026-02-01",
    });
    expect(result.sources[1]?.routes[0]).toMatchObject({
      fromAccountId: "second-operating-account",
      toAccountId: targetAccountId,
    });
    expect(result.sources).toHaveLength(2);
    expect(result.warnings).toContain("Multiple active Cash Flow transfer sources are aggregated for this investment account.");
  });

  it("honors date, amount, and skip exceptions", () => {
    const result = resolve([source({
      exceptions: [
        exception({ dateOverride: "2026-02-03", amountOverrideMinor: 275, fromAccountOverrideId: "alternate-operating-account" }),
        exception({ id: "exception-2", scheduledOccurrenceOn: "2026-03-01", kind: "skip" }),
      ],
    })]);

    expect(result.events[0]).toEqual({ on: "2026-02-03", amountMinor: 275 });
    expect(result.events.some((event) => event.on === "2026-03-01")).toBe(false);
    expect(result.sources[0]?.routes[0]).toEqual({
      seriesId: "series-1",
      versionId: "series-1-version-1",
      scheduledOccurrenceOn: "2026-02-01",
      effectiveDate: "2026-02-03",
      fromAccountId: "alternate-operating-account",
      toAccountId: targetAccountId,
    });
    expect(result.transferOutEvents[0]).toEqual({
      seriesId: "series-1",
      versionId: "series-1-version-1",
      scheduledOccurrenceOn: "2026-02-01",
      effectiveDate: "2026-02-03",
      fromAccountId: "alternate-operating-account",
      toAccountId: targetAccountId,
      amountMinor: -275,
    });
    expect(result.transferOutEvents.some((event) => event.scheduledOccurrenceOn === "2026-03-01")).toBe(false);
  });

  it("keeps destination contributions and funding outflows separate without double counting", () => {
    const result = resolve([source()]);

    const contributionTotal = result.events.reduce((total, event) => total + event.amountMinor, 0);
    const fundingOutflowTotal = result.transferOutEvents.reduce((total, event) => total + event.amountMinor, 0);

    expect(contributionTotal).toBe(1_200);
    expect(fundingOutflowTotal).toBe(-1_200);
    expect(result.events.every((event) => event.amountMinor > 0 && !("fromAccountId" in event))).toBe(true);
    expect(result.transferOutEvents).toHaveLength(result.events.length);
  });

  it("uses the effective version for each occurrence and warns on unsupported cadence", () => {
    const result = resolve([source({
      versions: [
        version({ endsOn: "2026-03-01", effectiveTo: "2026-03-01" }),
        version({
          id: "series-1-version-2",
          startsOn: "2026-04-01",
          effectiveFrom: "2026-04-01",
          amountMinor: 200,
          frequency: "weekly",
        }),
      ],
    })]);

    expect(result.events.find((event) => event.on === "2026-02-01")).toEqual({ on: "2026-02-01", amountMinor: 100 });
    expect(result.events.some((event) => event.on === "2026-04-01")).toBe(false);
    expect(result.warnings).toContain("Investment transfer uses an unsupported recurring frequency; only monthly and biweekly transfers are included.");
  });

  it("supports biweekly sources and matches the destination ID rather than a source name", () => {
    const biweekly = source({
      versions: [version({ frequency: "biweekly", startsOn: "2026-01-08", effectiveFrom: "2026-01-08", amountMinor: 125 })],
    });
    const nameOnlyMatch = source({
      seriesId: "series-2",
      versions: [version({ id: "series-2-version-1", seriesId: "series-2", name: targetAccountId, toAccountId: "different-account" })],
    });

    const result = resolve([biweekly, nameOnlyMatch]);

    expect(result.events[0]).toEqual({ on: "2026-01-08", amountMinor: 125 });
    expect(result.transferOutEvents[0]).toMatchObject({
      amountMinor: -125,
      fromAccountId: "operating-account",
      toAccountId: targetAccountId,
    });
    expect(result.sources).toHaveLength(1);
    expect(result.warnings).not.toContain("Multiple active Cash Flow transfer sources are aggregated for this investment account.");
  });
});
