import { annualExpenseDueDate } from "@athena/finance-engine";
import type { AnnualExpenseItemPresentation, AnnualExpenseOccurrencePresentation } from "./annual-expense-manager";

export interface AnnualExpenseRemainderTarget {
  readonly item: AnnualExpenseItemPresentation;
  readonly occurrence: AnnualExpenseOccurrencePresentation;
}

function occurrenceKey(itemId: string, occurrence: AnnualExpenseOccurrencePresentation): string {
  return `${itemId}:${occurrence.taxYear}`;
}

function generatedOccurrence(item: AnnualExpenseItemPresentation, taxYear: number): AnnualExpenseOccurrencePresentation | null {
  if (item.dueMonth === null) return null;
  return {
    id: null,
    taxYear,
    budgetId: item.budgetId,
    plannedAmountMinor: item.amountMinor,
    dueDate: annualExpenseDueDate(taxYear, item.dueMonth, item.dueDay),
    amountOverrideMinor: null,
    note: null,
    paidMinor: 0,
    remainingMinor: item.amountMinor,
    varianceMinor: item.amountMinor,
    status: "Unpaid",
    payments: [],
  };
}

function itemOccurrences(item: AnnualExpenseItemPresentation, taxYear: number): readonly AnnualExpenseOccurrencePresentation[] {
  const occurrences = [...item.history, item.occurrence];
  const seen = new Set<string>();
  const known = occurrences.filter((occurrence) => {
    const key = occurrenceKey(item.id, occurrence);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const firstStoredYear = occurrences.reduce((first, occurrence) => Math.min(first, occurrence.taxYear), 2201);
  const nextYear = taxYear + 1;
  if (nextYear <= 2200 && nextYear >= firstStoredYear && !seen.has(`${item.id}:${nextYear}`)) {
    const generated = generatedOccurrence(item, nextYear);
    if (generated) known.push(generated);
  }
  return known;
}

export function findNextAnnualExpenseRemainderTarget(
  source: AnnualExpenseItemPresentation,
  budgetItems: readonly AnnualExpenseItemPresentation[],
  taxYear: number,
): AnnualExpenseRemainderTarget | null {
  const sourceDueDate = source.occurrence.dueDate;
  if (!sourceDueDate) return null;
  const candidates = budgetItems.flatMap((item) => {
    if (!item.isActive || item.id === source.id || item.budgetId !== source.budgetId || item.name !== source.name) return [];
    return itemOccurrences(item, taxYear)
      .filter((occurrence) => occurrence.budgetId === source.occurrence.budgetId && occurrence.dueDate !== null && occurrence.dueDate > sourceDueDate)
      .map((occurrence) => ({ item, occurrence }));
  });
  candidates.sort((left, right) => left.occurrence.dueDate!.localeCompare(right.occurrence.dueDate!)
    || left.item.id.localeCompare(right.item.id)
    || left.occurrence.taxYear - right.occurrence.taxYear
    || (left.occurrence.id ?? "").localeCompare(right.occurrence.id ?? ""));
  return candidates[0] ?? null;
}
