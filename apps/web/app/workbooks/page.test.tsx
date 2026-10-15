import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), demo: false }));
vi.mock("@athena/database", () => ({ createCalculationWorkbooksRepository: () => ({ listByOwner: mocks.list, getById: mocks.get }) }));
vi.mock("../../lib/server/owner-database", () => ({
  withAuthenticatedPageDatabase: (callback: (db: unknown, user: { owner: { id: string; isDemo: boolean } }) => Promise<unknown>, options: { requireTwoFactor: boolean }) => {
    expect(options.requireTwoFactor).toBe(true);
    return callback({}, { owner: { id: "synthetic-owner", isDemo: mocks.demo } });
  },
}));
vi.mock("../components/module-page", () => ({ ModulePage: () => null }));
vi.mock("./calculation-workbench", () => ({ CalculationWorkbench: () => null }));
import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks(); mocks.demo = false;
  mocks.list.mockResolvedValue([{ id: "a", name: "A", updatedAt: new Date("2030-01-01Z") }, { id: "b", name: "B", updatedAt: new Date("2030-01-02Z") }]);
});
it("uses one metadata query and no full snapshot read", async () => {
  const page = await Page({ searchParams: Promise.resolve({ workbook: "b" }) });
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith("synthetic-owner");
  expect(mocks.get).not.toHaveBeenCalled();
  const props = page.props.children.props;
  expect(props.selectedWorkbook.id).toBe("b");
  expect(JSON.stringify(props)).not.toContain('"snapshot"');
});
it("falls back for unlisted IDs and handles empty lists", async () => {
  const page = await Page({ searchParams: Promise.resolve({ workbook: "foreign" }) });
  expect(page.props.children.props.selectedWorkbook.id).toBe("a");
  mocks.list.mockResolvedValue([]);
  expect((await Page({})).props.children.props.selectedWorkbook).toBeNull();
  expect(mocks.get).not.toHaveBeenCalled();
});
it("does not query demo workbooks and preserves missing-table handling", async () => {
  mocks.demo = true;
  expect((await Page({})).props.children.props.isDemo).toBe(true);
  expect(mocks.list).not.toHaveBeenCalled();
  mocks.demo = false; mocks.list.mockRejectedValue({ code: "42P01" });
  expect((await Page({})).props.children.props.migrationRequired).toBe(true);
});
