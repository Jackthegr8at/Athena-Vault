import {
  addMinorUnitsSafely,
  assertNetWorthHistoryPointsChronological,
  calculateNetWorthHistoryChanges,
  calculateNetWorthHistoryTotalMinor,
  classifyNetWorthAccountKind,
  type NetWorthHistoryModel,
} from "@athena/finance-engine";

export interface NetWorthAccountBalance {
  readonly kind: string;
  readonly balanceMinor: number | null;
  readonly isActive: boolean;
}

export interface LiveNetWorthBreakdown {
  readonly cashOtherMinor: number;
  readonly investmentsMinor: number;
  readonly liabilitiesMinor: number;
  readonly homeEquityMinor: number;
  readonly netWorthMinor: number;
}

/**
 * Build the canonical current Overview breakdown from the same account rows
 * used by the hero card. History is allowed to retain older snapshot values,
 * but the evaluation-date point must use this exact live source.
 */
export function calculateLiveNetWorthBreakdown(
  accounts: readonly NetWorthAccountBalance[],
  homeEquityMinor: number | null,
): LiveNetWorthBreakdown {
  let cashOtherMinor = 0;
  let investmentsMinor = 0;
  let liabilitiesMinor = 0;

  for (const account of accounts) {
    if (!account.isActive) continue;
    const balanceMinor = account.balanceMinor ?? 0;
    const category = classifyNetWorthAccountKind(account.kind);
    if (category === "investment") {
      investmentsMinor = addMinorUnitsSafely(investmentsMinor, balanceMinor, "Investment account total");
    } else if (category === "liability") {
      liabilitiesMinor = addMinorUnitsSafely(liabilitiesMinor, balanceMinor, "Liability account total");
    } else {
      cashOtherMinor = addMinorUnitsSafely(cashOtherMinor, balanceMinor, "Cash/other account total");
    }
  }

  const normalizedHomeEquityMinor = homeEquityMinor ?? 0;
  const netWorthMinor = calculateNetWorthHistoryTotalMinor({
    cashOtherMinor,
    investmentsMinor,
    homeEquityMinor: normalizedHomeEquityMinor,
    liabilitiesMinor,
  });
  if (netWorthMinor === null) throw new Error("Live net-worth totals must be complete.");

  return {
    cashOtherMinor,
    investmentsMinor,
    liabilitiesMinor,
    homeEquityMinor: normalizedHomeEquityMinor,
    netWorthMinor,
  };
}

export function calculateNetWorthMinor(
  accounts: readonly NetWorthAccountBalance[],
  homeEquityMinor: number | null,
): number {
  return calculateLiveNetWorthBreakdown(accounts, homeEquityMinor).netWorthMinor;
}

/**
 * Make the current history point agree with the Overview's live balance
 * source. Earlier points remain historical snapshots; only the evaluation
 * date is replaced, so the chart does not rewrite history.
 */
export function alignNetWorthHistoryCurrentPoint(
  model: NetWorthHistoryModel,
  current: LiveNetWorthBreakdown,
): NetWorthHistoryModel {
  const currentPoint = {
    asOf: model.evaluationDate,
    phase: "actual" as const,
    isFirstProjected: false,
    netWorthMinor: current.netWorthMinor,
    investmentsMinor: current.investmentsMinor,
    homeEquityMinor: current.homeEquityMinor,
    cashOtherMinor: current.cashOtherMinor,
  };
  const pointsWithoutCurrent = model.points.filter((point) => point.asOf !== model.evaluationDate);
  const firstProjectedMarkerRemoved = model.points.some((point) => point.asOf === model.evaluationDate && point.isFirstProjected);
  const pointsBeforeAndAfter: Array<NetWorthHistoryModel["points"][number]> = [];
  let firstProjectedMarkerPending = firstProjectedMarkerRemoved;
  let currentInserted = false;
  for (const point of pointsWithoutCurrent) {
    if (!currentInserted && point.asOf > currentPoint.asOf) {
      pointsBeforeAndAfter.push(currentPoint);
      currentInserted = true;
    }
    if (firstProjectedMarkerPending && point.phase === "projected") {
      pointsBeforeAndAfter.push({ ...point, isFirstProjected: true });
      firstProjectedMarkerPending = false;
    } else {
      pointsBeforeAndAfter.push(point);
    }
  }
  if (!currentInserted) pointsBeforeAndAfter.push(currentPoint);
  assertNetWorthHistoryPointsChronological(pointsBeforeAndAfter);
  const points = pointsBeforeAndAfter;

  return {
    ...model,
    points,
    firstProjectedAsOf: points.find((point) => point.phase === "projected")?.asOf ?? null,
    changes: calculateNetWorthHistoryChanges(points),
  };
}
