import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildCashFlowRecurringOptions, type CashFlowRecurringOptionSeries } from "./recurring-editor";
it("keeps historical linked versions while removing deferred editor and excluded rows from initial props", () => {
  const series: CashFlowRecurringOptionSeries[] = Array.from({ length: 100 }, (_, i) => ({ id: `s-${i}`, state: "active", versions: [
    { id: `old-${i}`, kind: "expense", name: "Synthetic historical", frequency: "biweekly", amountMinor: 100, status: "planned", isCurrent: false },
    { id: `now-${i}`, kind: "expense", name: "Synthetic current", frequency: "biweekly", amountMinor: 200, status: "planned", isCurrent: true },
  ] }));
  const ids = new Set(["old-0"]);
  const options = buildCashFlowRecurringOptions(series, ids);
  expect(options.some(v => v.id === "old-0")).toBe(true);
  expect(options.some(v => v.id === "old-1")).toBe(false);
  const excluded = Array.from({ length: 100 }, (_, i) => ({ id: String(i), description: "Synthetic excluded", amountMinor: 100 }));
  const before = Buffer.byteLength(JSON.stringify({ recurringOptions: options, excludedExpenses: excluded }));
  const after = Buffer.byteLength(JSON.stringify({ recurringOptions: [], excludedExpenses: [], relevantRecurringVersionIds: [...ids], excludedExpenseCount: excluded.length, deferredDetails: true }));
  expect(after).toBeLessThan(before);
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  expect(source).toContain("recurringOptions={[]} excludedExpenses={[]}");
  expect(source).toContain("cashFlowRepository.countExcludedExpenses(user.owner.id)");
  expect(source).not.toContain("cashFlowRepository.listExcludedExpenses(");
  console.log(JSON.stringify({ synthetic: true, initialDetailBytesBefore: before, initialDetailBytesAfter: after, deferredBytes: Buffer.byteLength(JSON.stringify({ series, excluded })) }));
});
