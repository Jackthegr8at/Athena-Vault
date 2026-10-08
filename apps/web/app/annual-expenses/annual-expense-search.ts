export interface AnnualExpenseSearchItem {
  readonly name: string;
  readonly isActive: boolean;
  readonly occurrence: {
    readonly dueDate: string | null;
    readonly status: string;
    readonly note: string | null;
  };
}

function searchableFields(item: AnnualExpenseSearchItem): readonly string[] {
  return [
    item.name,
    item.occurrence.dueDate ?? "",
    item.occurrence.note ?? "",
    item.isActive ? "active" : "archived",
  ].map((field) => field.toLowerCase());
}

export function filterAnnualExpenseItems<T extends AnnualExpenseSearchItem>(items: readonly T[], query: string): readonly T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => searchableFields(item).some((field) => field.includes(normalizedQuery)) || item.occurrence.status.toLowerCase().split(/\s+/).includes(normalizedQuery));
}
