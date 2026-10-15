export function selectWorkbookSummary<T extends { readonly id: string }>(rows: readonly T[], requestedId?: string): T | null {
  return rows.find(row => row.id === requestedId) ?? rows[0] ?? null;
}
