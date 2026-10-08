export type CashFlowRecurringKind = "income" | "expense" | "transfer";

export interface CashFlowRecurringOption {
  readonly id: string;
  readonly seriesId: string;
  readonly kind: CashFlowRecurringKind;
  readonly label: string;
  readonly amountMinor: number;
}

export interface CashFlowRecurringOptionVersion {
  readonly id: string;
  readonly kind: CashFlowRecurringKind;
  readonly name: string;
  readonly frequency: string;
  readonly amountMinor: number;
  readonly status: "planned" | "actual";
  readonly isCurrent: boolean;
}

export interface CashFlowRecurringOptionSeries {
  readonly id: string;
  readonly state: "active" | "paused" | "ended";
  readonly versions: readonly CashFlowRecurringOptionVersion[];
}

export interface CashFlowOccurrenceEditorItem {
  readonly kind: CashFlowRecurringKind;
  readonly amount: number;
  readonly recurringTransactionId?: string;
  readonly recurringSeriesId?: string;
  readonly scheduledOccurrenceOn?: string;
  readonly generated?: boolean;
  readonly planned: boolean;
}

export interface CashFlowOccurrenceEditorModel {
  readonly generatedOccurrence: boolean;
  readonly linkedOption: CashFlowRecurringOption | null;
  readonly linkedLabel: string | null;
  readonly baseAmountMinor: number | null;
  readonly amountFieldName: "amount" | "amountOverride";
  readonly amountFieldLabel: "Amount" | "Amount for this occurrence";
  readonly showRecurringSelector: boolean;
}

export function buildCashFlowRecurringOptions(
  series: readonly CashFlowRecurringOptionSeries[],
  relevantVersionIds: ReadonlySet<string>,
): readonly CashFlowRecurringOption[] {
  return series
    .filter((entry) => entry.state !== "ended")
    .flatMap((entry) => entry.versions
      .filter((version) => version.status === "planned" && (version.isCurrent || relevantVersionIds.has(version.id)))
      .map((version) => ({
        id: version.id,
        seriesId: entry.id,
        kind: version.kind,
        label: `${version.name} · ${version.frequency}`,
        amountMinor: version.amountMinor,
      })))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function cashFlowRecurringOptionForVersion(
  options: readonly CashFlowRecurringOption[],
  versionId: string | undefined,
): CashFlowRecurringOption | null {
  return versionId ? options.find((option) => option.id === versionId) ?? null : null;
}

export function isGeneratedOccurrenceEditable(item: CashFlowOccurrenceEditorItem): boolean {
  return item.generated === true
    && item.planned
    && Boolean(item.recurringSeriesId && item.recurringTransactionId && item.scheduledOccurrenceOn);
}

export function getCashFlowOccurrenceEditorModel(
  item: CashFlowOccurrenceEditorItem,
  options: readonly CashFlowRecurringOption[],
): CashFlowOccurrenceEditorModel {
  const generatedOccurrence = isGeneratedOccurrenceEditable(item);
  const linkedOption = cashFlowRecurringOptionForVersion(options, item.recurringTransactionId);
  return {
    generatedOccurrence,
    linkedOption,
    linkedLabel: generatedOccurrence ? linkedOption?.label ?? "Linked recurring series" : null,
    baseAmountMinor: generatedOccurrence ? linkedOption?.amountMinor ?? item.amount : null,
    amountFieldName: generatedOccurrence ? "amountOverride" : "amount",
    amountFieldLabel: generatedOccurrence ? "Amount for this occurrence" : "Amount",
    showRecurringSelector: item.kind !== "transfer" && !generatedOccurrence,
  };
}
