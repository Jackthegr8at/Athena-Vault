export const ACCOUNT_KIND_METADATA = {
  checking: { label: "Chequing", group: "liquid", isLiquid: true, supportsCustomLabel: false },
  savings: { label: "Savings", group: "liquid", isLiquid: true, supportsCustomLabel: false },
  credit: { label: "Credit card", group: "credit", isLiquid: false, supportsCustomLabel: false },
  loan: { label: "Loan", group: "loan", isLiquid: false, supportsCustomLabel: false },
  cash: { label: "Cash", group: "liquid", isLiquid: true, supportsCustomLabel: false },
  investment: { label: "Generic investment", group: "investment", isLiquid: false, supportsCustomLabel: false },
  crypto: { label: "Crypto", group: "investment", isLiquid: false, supportsCustomLabel: false },
  rrsp: { label: "REER / RRSP", group: "investment", isLiquid: false, supportsCustomLabel: false },
  tfsa: { label: "CELI / TFSA", group: "investment", isLiquid: false, supportsCustomLabel: false },
  fhsa: { label: "CELIAPP / FHSA", group: "investment", isLiquid: false, supportsCustomLabel: false },
  resp: { label: "REEE / RESP", group: "investment", isLiquid: false, supportsCustomLabel: false },
  rdsp: { label: "REEI / RDSP", group: "investment", isLiquid: false, supportsCustomLabel: false },
  non_registered: { label: "Non-registered investment", group: "investment", isLiquid: false, supportsCustomLabel: false },
  other: { label: "Other", group: "investment", isLiquid: false, supportsCustomLabel: true },
} as const;

export type AccountKind = keyof typeof ACCOUNT_KIND_METADATA;
export type AccountGroup = (typeof ACCOUNT_KIND_METADATA)[AccountKind]["group"];
export type AccountTimelineSectionKey = AccountGroup | `other:${string}`;
export type SnapshotStatus = "actual" | "planned";
export type PeriodState = "actual" | "projected" | "mixed";
export type PaydayDirection = "previous" | "next";
export const ACCOUNT_TIMELINE_SOURCE_STATUS_BOUNDARY = "2026-08-05";
export const FUTURE_ACCOUNT_TIMELINE_STATUS_ERROR = "Future pay periods must remain Projected.";

export const ACCOUNT_TIMELINE_SECTION_LABELS: Readonly<Record<AccountGroup, string>> = {
  liquid: "Liquid accounts",
  credit: "Credit cards",
  loan: "Loans",
  investment: "Investments and other assets",
};

export const ACCOUNT_TIMELINE_SECTION_ORDER: readonly AccountGroup[] = ["liquid", "credit", "loan", "investment"];

const OTHER_ACCOUNT_SECTION_PREFIX = "other:";

export const ACCOUNT_KIND_CODES = Object.keys(ACCOUNT_KIND_METADATA) as AccountKind[];
export const ACCOUNT_KIND_OPTIONS = ACCOUNT_KIND_CODES.map((code) => ({ code, ...ACCOUNT_KIND_METADATA[code] }));

export function statusAtAccountTimelineSourceBoundary(asOf: string): SnapshotStatus {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new RangeError("Account snapshot date must be an ISO date.");
  return asOf <= ACCOUNT_TIMELINE_SOURCE_STATUS_BOUNDARY ? "actual" : "planned";
}

export function accountKindLabel(kind: string, customTypeLabel?: string | null): string {
  if (kind === "other" && customTypeLabel?.trim()) return customTypeLabel.trim();
  return ACCOUNT_KIND_METADATA[kind as AccountKind]?.label ?? kind;
}

export function accountGroupForKind(kind: string): AccountGroup {
  return ACCOUNT_KIND_METADATA[kind as AccountKind]?.group ?? "investment";
}

export function normalizeAccountCustomTypeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") || null;
  return normalized;
}

export function accountTimelineSectionKeyForCustomTypeLabel(value: string | null | undefined): `other:${string}` | null {
  const normalized = normalizeAccountCustomTypeLabel(value);
  return normalized ? `${OTHER_ACCOUNT_SECTION_PREFIX}${normalized.toLocaleLowerCase("en-CA")}` : null;
}

export function accountTimelineDedicatedOtherSectionKeys(
  accounts: readonly { readonly kind: string; readonly customTypeLabel?: string | null; readonly isActive?: boolean }[],
): ReadonlySet<AccountTimelineSectionKey> {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    if (account.isActive === false || account.kind !== "other") continue;
    const sectionKey = accountTimelineSectionKeyForCustomTypeLabel(account.customTypeLabel);
    if (sectionKey) counts.set(sectionKey, (counts.get(sectionKey) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([sectionKey]) => sectionKey as AccountTimelineSectionKey));
}

export function accountTimelineSectionForAccount(
  kind: string,
  customTypeLabel?: string | null,
  dedicatedOtherSections?: ReadonlySet<AccountTimelineSectionKey>,
): AccountTimelineSectionKey {
  const standardSection = accountGroupForKind(kind);
  const customSection = accountTimelineSectionKeyForCustomTypeLabel(customTypeLabel);
  return kind === "other" && customSection && dedicatedOtherSections?.has(customSection)
    ? customSection
    : standardSection;
}

export function isLiquidAccountKind(kind: string): kind is "checking" | "savings" | "cash" {
  return kind === "checking" || kind === "savings" || kind === "cash";
}

export function isCreditAccountKind(kind: string): kind is "credit" {
  return kind === "credit";
}

export function isLoanAccountKind(kind: string): kind is "loan" {
  return kind === "loan";
}

export function isLiabilityAccountKind(kind: string): kind is "credit" | "loan" {
  return isCreditAccountKind(kind) || isLoanAccountKind(kind);
}

export function isInvestmentAccountKind(kind: string): boolean {
  return !isLiquidAccountKind(kind) && !isLiabilityAccountKind(kind);
}

export function toTorontoDateIso(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeIsoDates(paydays: readonly string[]): string[] {
  return [...new Set(paydays.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

export function selectClosestPaydayOnOrBefore(
  paydays: readonly string[],
  todayIso: string = toTorontoDateIso(),
): string | null {
  const sorted = normalizeIsoDates(paydays);
  if (sorted.length === 0) return null;
  return [...sorted].reverse().find((date) => date <= todayIso) ?? sorted[0] ?? null;
}

export function navigatePayday(
  paydays: readonly string[],
  selectedDate: string,
  direction: PaydayDirection,
): string | null {
  const sorted = normalizeIsoDates(paydays);
  if (sorted.length === 0) return null;
  const index = sorted.indexOf(selectedDate);
  if (index < 0) return selectClosestPaydayOnOrBefore(sorted, selectedDate);
  const offset = direction === "previous" ? -1 : 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index + offset))] ?? null;
}

export function derivePeriodState(statuses: readonly SnapshotStatus[]): PeriodState {
  const hasActual = statuses.includes("actual");
  const hasProjected = statuses.includes("planned");
  if (hasActual && hasProjected) return "mixed";
  if (hasActual) return "actual";
  return "projected";
}

/**
 * Display label for a pay period relative to the open (current) payday.
 * Storage still uses actual/planned; UI uses Past / Current / Projected.
 */
export function periodPositionLabel(payDate: string, currentPayday: string | null): "Past" | "Current" | "Projected" {
  if (currentPayday && payDate === currentPayday) return "Current";
  if (currentPayday && payDate > currentPayday) return "Projected";
  return "Past";
}

/** Balance / row status badge: confirmed recorded amount vs estimate. */
export function snapshotStatusDisplayLabel(status: SnapshotStatus): "Confirmed" | "Projected" {
  return status === "actual" ? "Confirmed" : "Projected";
}

/** Record-status style period badge (cash-flow period.status, column status mix). */
export function periodStateLabel(state: PeriodState | "planned" | "actual" | "mixed" | "projected" | string): string {
  if (state === "actual") return "Confirmed";
  if (state === "mixed") return "Mixed";
  if (state === "planned" || state === "projected") return "Projected";
  return String(state);
}
