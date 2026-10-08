import { describe, expect, it } from "vitest";
import { buildCashFlowRecurringOptions, getCashFlowOccurrenceEditorModel } from "./recurring-editor";

const version = (overrides: Partial<{
  id: string;
  kind: "income" | "expense" | "transfer";
  name: string;
  frequency: string;
  amountMinor: number;
  status: "planned" | "actual";
  isCurrent: boolean;
}> = {}) => ({
  id: "version-current",
  kind: "expense" as const,
  name: "Current expense",
  frequency: "monthly",
  amountMinor: 1500,
  status: "planned" as const,
  isCurrent: true,
  ...overrides,
});

describe("Cash Flow occurrence editor mapping", () => {
  it("includes a future-effective version referenced by a displayed generated row", () => {
    const options = buildCashFlowRecurringOptions([
      {
        id: "series-ai",
        state: "active",
        versions: [
          version(),
          version({ id: "version-ai", name: "AI (Leonardo)", amountMinor: 1950, isCurrent: false }),
        ],
      },
      { id: "series-ended", state: "ended", versions: [version({ id: "version-ended", name: "Ended" })] },
    ], new Set(["version-ai"]));

    expect(options.map((option) => option.id)).toEqual(["version-ai", "version-current"]);
    expect(options.find((option) => option.id === "version-ai")).toMatchObject({
      seriesId: "series-ai",
      label: "AI (Leonardo) · monthly",
      amountMinor: 1950,
    });
    expect(options.some((option) => option.id === "version-ended")).toBe(false);
  });

  it("maps generated rows to one occurrence amount while retaining ordinary manual controls", () => {
    const options = buildCashFlowRecurringOptions([{ id: "series-ai", state: "active", versions: [version({ id: "version-ai", name: "AI (Leonardo)", amountMinor: 1950 })] }], new Set());
    const generated = getCashFlowOccurrenceEditorModel({
      kind: "expense",
      amount: 2200,
      generated: true,
      planned: true,
      recurringSeriesId: "series-ai",
      recurringTransactionId: "version-ai",
      scheduledOccurrenceOn: "2026-08-20",
    }, options);
    const manual = getCashFlowOccurrenceEditorModel({ kind: "expense", amount: 2200, generated: false, planned: true }, options);

    expect(generated).toMatchObject({
      generatedOccurrence: true,
      linkedLabel: "AI (Leonardo) · monthly",
      baseAmountMinor: 1950,
      amountFieldName: "amountOverride",
      amountFieldLabel: "Amount for this occurrence",
      showRecurringSelector: false,
    });
    expect(manual).toMatchObject({
      generatedOccurrence: false,
      amountFieldName: "amount",
      amountFieldLabel: "Amount",
      showRecurringSelector: true,
    });
  });
});
