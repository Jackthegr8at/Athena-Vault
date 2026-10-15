import { expect, it } from "vitest";
import { selectWorkbookSummary } from "./selection";
it("selects only listed owner summaries and preserves fallback ordering", () => {
  const rows = [{ id: "second-name-first", name: "Z" }, { id: "requested", name: "A" }];
  expect(selectWorkbookSummary(rows, "requested")).toBe(rows[1]);
  expect(selectWorkbookSummary(rows, "foreign")).toBe(rows[0]);
  expect(selectWorkbookSummary(rows, "")).toBe(rows[0]);
  expect(selectWorkbookSummary(rows)).toBe(rows[0]);
  expect(selectWorkbookSummary([], "foreign")).toBeNull();
});
