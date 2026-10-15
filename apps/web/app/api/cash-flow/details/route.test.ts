import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), recurring: vi.fn(), excluded: vi.fn(), UnauthenticatedError: class extends Error {} }));
vi.mock("@athena/database", () => ({ createCashFlowRepository: () => ({ getRecurringEditorDetails: mocks.recurring, listExcludedExpenses: mocks.excluded }) }));
vi.mock("../../../../lib/server/owner-database", () => ({ withAuthenticatedDatabase: mocks.auth }));
vi.mock("../../../../lib/server/auth-session", () => ({ UnauthenticatedError: mocks.UnauthenticatedError }));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks(); mocks.recurring.mockResolvedValue([]); mocks.excluded.mockResolvedValue([]);
  mocks.auth.mockImplementation((callback, options) => { expect(options).toEqual({ requireTwoFactor: true }); return callback({}, { owner: { id: "synthetic-owner" } }); });
});
it("derives owner from auth, not query strings, and prevents caching", async () => {
  for (const kind of ["recurring", "excluded"]) {
    const response = await GET(new Request(`https://example.invalid/api/cash-flow/details?kind=${kind}&ownerId=foreign`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(kind === "recurring" ? mocks.recurring : mocks.excluded).toHaveBeenCalledWith("synthetic-owner");
  }
});
it("rejects invalid kinds without a data read", async () => {
  expect((await GET(new Request("https://example.invalid/api/cash-flow/details?kind=bad"))).status).toBe(400);
  expect(mocks.auth).not.toHaveBeenCalled();
});
it("returns generic signed-out, MFA and unexpected-error responses", async () => {
  for (const [error, status] of [[new mocks.UnauthenticatedError(), 401], [{ digest: "NEXT_REDIRECT;replace;/settings;307;" }, 403], [new Error("synthetic internal detail"), 500]] as const) {
    mocks.auth.mockRejectedValueOnce(error);
    const response = await GET(new Request("https://example.invalid/api/cash-flow/details?kind=excluded"));
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("synthetic internal detail");
  }
});
