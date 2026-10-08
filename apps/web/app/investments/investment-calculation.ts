import type {
  CashFlowAccountView,
  InvestmentProjectionAccountView,
  InvestmentProjectionAvailableAccountView,
  InvestmentProjectionPointView,
  InvestmentProjectionProjectView,
  InvestmentProjectionScheduleView,
} from "@athena/database";
import {
  type InvestmentProjectionActionField,
  type InvestmentProjectionActionState,
} from "./action-helpers";
import { formatMoneyInputMinor } from "../../lib/format-money";

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export interface EditableOverride {
  readonly id?: string | null;
  readonly yearText: string;
  readonly amountText: string;
}
export interface EditableSchedule {
  readonly id?: string | null;
  readonly investmentAccountId: string;
  readonly displayOrder?: number;
  readonly frequency: "monthly" | "biweekly";
  readonly contributionSource: "cash_flow" | "manual";
  readonly baseContributionText: string;
  readonly annualIncreaseMode: "percentage" | "fixed_amount";
  readonly annualIncreaseText: string;
  readonly annualOverrides: readonly EditableOverride[];
}

export function money(minor: number | null | undefined): string {
  if (typeof minor !== "number" || !Number.isSafeInteger(minor)) return "—";
  const sign = minor < 0 ? "−" : "";
  const absolute = Math.abs(minor);
  return `${sign}$${Math.floor(absolute / 100).toLocaleString("en-CA")}.${String(absolute % 100).padStart(2, "0")}`;
}

export function safeMinorSum(values: readonly (number | null | undefined)[]): number | null {
  let total = 0n;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) continue;
    total += BigInt(value);
    if (total > MAX_SAFE_INTEGER_BIGINT) return null;
  }
  return Number(total);
}

export function safeSignedSum(values: readonly (number | null | undefined)[]): number | null {
  let total = 0n;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) continue;
    total += BigInt(value);
    if (total > MAX_SAFE_INTEGER_BIGINT || total < -MAX_SAFE_INTEGER_BIGINT) return null;
  }
  return Number(total);
}

export function cashFlowSources(account: InvestmentProjectionAvailableAccountView): InvestmentProjectionAvailableAccountView["cashFlowSources"] {
  return Array.isArray(account.cashFlowSources) ? account.cashFlowSources : [];
}

export function cashFlowEvents(account: InvestmentProjectionAvailableAccountView): InvestmentProjectionAvailableAccountView["cashFlowEvents"] {
  return Array.isArray(account.cashFlowEvents) ? account.cashFlowEvents : [];
}

export function cashFlowTransferOutEvents(account: InvestmentProjectionAvailableAccountView): InvestmentProjectionAvailableAccountView["cashFlowTransferOutEvents"] {
  return Array.isArray(account.cashFlowTransferOutEvents) ? account.cashFlowTransferOutEvents : [];
}

export function cashFlowCurrentAmountMinor(account: InvestmentProjectionAvailableAccountView): number | null {
  return safeMinorSum(cashFlowSources(account).map((source) => source.amountMinor));
}

export function cashFlowEventTotalMinor(account: InvestmentProjectionAvailableAccountView): number | null {
  return safeMinorSum(cashFlowEvents(account).map((event) => event.amountMinor));
}

export function cashFlowTransferOutTotalMinor(account: InvestmentProjectionAvailableAccountView): number | null {
  return safeSignedSum(cashFlowTransferOutEvents(account).map((event) => event.amountMinor));
}

export function cashFlowAccountLabel(accounts: readonly CashFlowAccountView[], accountId: string | null): string {
  if (!accountId) return "Unspecified funding account";
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) return "Unavailable Cash Flow account";
  if (!account.institution || account.name.toLowerCase().includes(account.institution.toLowerCase())) {
    return account.name;
  }
  return `${account.name} · ${account.institution}`;
}

export function frequencyLabel(frequency: string): string {
  if (frequency === "biweekly") return "Every 2 weeks";
  if (frequency === "monthly") return "Monthly";
  if (frequency === "mixed") return "Mixed cadence";
  return frequency.replaceAll("_", " ");
}

export function minorToText(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor) || minor < 0) return "";
  return formatMoneyInputMinor(minor);
}

export function percentFromBasisPoints(rateBps: number | null | undefined): string {
  if (rateBps === null || rateBps === undefined || !Number.isSafeInteger(rateBps)) return "";
  return `${rateBps < 0 ? "−" : ""}${(Math.abs(rateBps) / 100).toFixed(2)}`;
}

export function accountKindLabel(kind: string): string {
  return kind.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function accountLabel(account: InvestmentProjectionAvailableAccountView | InvestmentProjectionAccountView): string {
  return `${account.name} · ${accountKindLabel(account.kind)}`;
}

export function safeIntegerFromText(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return null;
  try {
    const integer = BigInt(normalized);
    return integer >= -MAX_SAFE_INTEGER_BIGINT && integer <= MAX_SAFE_INTEGER_BIGINT ? Number(integer) : null;
  } catch {
    return null;
  }
}

export function amountTextToMinor(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  try {
    const [wholePart = "", fractionPart = ""] = normalized.split(".");
    if (!wholePart || fractionPart === undefined) return null;
    const minor = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0"));
    return minor <= MAX_SAFE_INTEGER_BIGINT ? Number(minor) : null;
  } catch {
    return null;
  }
}

export function percentTextToBasisPoints(value: string | null | undefined, allowNegative = false): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".").replace("−", "-");
  const pattern = allowNegative ? /^-?\d+(?:\.\d{0,2})?$/ : /^\d+(?:\.\d{0,2})?$/;
  if (!pattern.test(normalized)) return null;
  try {
    const negative = normalized.startsWith("-");
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [wholePart = "", fractionPart = ""] = unsigned.split(".");
    if (!wholePart || fractionPart === undefined) return null;
    const basisPoints = BigInt(wholePart) * 100n + BigInt(fractionPart.padEnd(2, "0"));
    const signed = negative ? -basisPoints : basisPoints;
    return signed >= -10_000n && signed <= 10_000n ? Number(signed) : null;
  } catch {
    return null;
  }
}

export function fieldError(state: InvestmentProjectionActionState, field: InvestmentProjectionActionField): string | null {
  return state.fieldErrors[field] ?? null;
}

export function isoDateLabel(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function longDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-CA", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" });
}

export function scheduleFromView(schedule: InvestmentProjectionScheduleView): EditableSchedule {
  const annualOverrides = Array.isArray(schedule.annualOverrides) ? schedule.annualOverrides : [];
  const annualIncreaseMode = schedule.annualIncreaseMode ?? "percentage";
  return {
    id: schedule.id,
    investmentAccountId: schedule.investmentAccountId,
    displayOrder: 0,
    frequency: schedule.frequency,
    contributionSource: schedule.contributionSource ?? "cash_flow",
    baseContributionText: minorToText(schedule.baseContributionMinor),
    annualIncreaseMode,
    annualIncreaseText: annualIncreaseMode === "fixed_amount" ? minorToText(schedule.annualIncreaseMinor) : percentFromBasisPoints(schedule.annualIncreaseBps),
    annualOverrides: annualOverrides.map((override) => ({
      id: override.id,
      yearText: String(override.year),
      amountText: minorToText(override.amountMinor),
    })),
  };
}

export function prefillCandidates(account: InvestmentProjectionAvailableAccountView) {
  return (Array.isArray(account.prefillCandidates) ? account.prefillCandidates : []).filter((candidate) => candidate.frequency === "monthly" || candidate.frequency === "biweekly");
}

export function scheduleFromAccount(account: InvestmentProjectionAvailableAccountView, displayOrder: number): EditableSchedule {
  const candidates = prefillCandidates(account);
  const suggested = candidates.length === 1 ? candidates[0] : undefined;
  return {
    investmentAccountId: account.id,
    displayOrder,
    frequency: suggested?.frequency ?? "monthly",
    contributionSource: "cash_flow",
    baseContributionText: suggested ? minorToText(suggested.amountMinor) : "0.00",
    annualIncreaseMode: "percentage",
    annualIncreaseText: "0.00",
    annualOverrides: [],
  };
}

export function initialSchedules(
  accounts: readonly InvestmentProjectionAvailableAccountView[],
  project: InvestmentProjectionProjectView | null,
): EditableSchedule[] {
  if (!project || project.mode !== "portfolio") return [];
  const savedSchedules = Array.isArray(project.accountSchedules) ? project.accountSchedules : [];
  const persisted = savedSchedules.length > 0
    ? savedSchedules.map(scheduleFromView)
    : project.accounts.flatMap((account) => account.schedule ? [scheduleFromView(account.schedule)] : []);
  if (persisted.length > 0) return persisted.map((schedule, displayOrder) => ({ ...schedule, displayOrder }));
  return project.accounts
    .map((account) => accounts.find((candidate) => candidate.id === account.id))
    .filter((account): account is InvestmentProjectionAvailableAccountView => account !== undefined)
    .map((account, displayOrder) => scheduleFromAccount(account, displayOrder));
}

export type ProjectionChartMetric = "balanceMinor" | "contributionsMinor" | "growthMinor";


export function projectionChartValue(point: InvestmentProjectionPointView, metric: ProjectionChartMetric): number {
  return point[metric];
}

export function compactProjectionAxisValue(minor: number): string {
  const absolute = Math.abs(minor);
  const sign = minor < 0 ? "−" : "";
  if (absolute >= 100_000_000) {
    const wholeMillions = Math.floor(absolute / 100_000_000);
    const tenthMillions = Math.floor((absolute % 100_000_000) / 10_000_000);
    return `${sign}$${wholeMillions}${tenthMillions > 0 ? `.${tenthMillions}` : ""}M`;
  }
  if (absolute >= 100_000) return `${sign}$${Math.floor(absolute / 100_000)}K`;
  return money(minor);
}

export function chartPath(points: readonly InvestmentProjectionPointView[], metric: ProjectionChartMetric, width: number, height: number, padding: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }, min: number, max: number): string {
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const range = max - min || 1;
  return points.map((point, index) => {
    const x = padding.left + (points.length <= 1 ? 0 : index / (points.length - 1)) * plotWidth;
    const y = padding.top + (1 - (projectionChartValue(point, metric) - min) / range) * plotHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

export function chartBandPath(upperPoints: readonly InvestmentProjectionPointView[], lowerPoints: readonly InvestmentProjectionPointView[] | null, metric: ProjectionChartMetric, width: number, height: number, padding: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }, min: number, max: number, upperPath?: string): string {
  if (upperPoints.length === 0) return "";
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const range = max - min || 1;
  const bottom = height - padding.bottom;
  const lastX = padding.left + plotWidth;
  const lowerPath = lowerPoints && lowerPoints.length > 0
    ? lowerPoints.slice().reverse().map((point, reverseIndex) => {
      const index = lowerPoints.length - reverseIndex - 1;
      const x = padding.left + (upperPoints.length <= 1 ? 0 : index / (upperPoints.length - 1)) * plotWidth;
      const y = padding.top + (1 - (projectionChartValue(point, metric) - min) / range) * plotHeight;
      return `L${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ")
    : `L${lastX.toFixed(2)} ${bottom} L${padding.left} ${bottom}`;
  return `${upperPath ?? chartPath(upperPoints, metric, width, height, padding, min, max)} ${lowerPath} Z`;
}
