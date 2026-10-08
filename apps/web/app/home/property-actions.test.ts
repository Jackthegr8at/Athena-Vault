import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    createHome: vi.fn(),
    upsertMarketValue: vi.fn(),
    deleteMarketValue: vi.fn(),
    upsertMortgageAnchor: vi.fn(),
    deleteMortgageAnchor: vi.fn(),
    saveMortgageTerms: vi.fn(),
  },
  revalidatePath: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({ createHomeRepository: vi.fn(() => mocks.repository) }));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import {
  saveMortgageTermsAction,
  upsertHomeValueAction,
  upsertMortgageAnchorAction,
} from "./property-actions";
import { initialPropertyActionState, propertyRepositoryErrorActionState } from "./property-state";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("Home property server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.upsertMarketValue.mockResolvedValue(undefined);
    mocks.repository.upsertMortgageAnchor.mockResolvedValue(undefined);
    mocks.repository.saveMortgageTerms.mockResolvedValue(undefined);
  });

  it("validates property values before touching the repository and uses the server owner", async () => {
    const invalid = await upsertHomeValueAction(initialPropertyActionState, formData({ asOf: "", marketValue: "not-money" }));
    expect(invalid.ok).toBe(false);
    expect(mocks.repository.upsertMarketValue).not.toHaveBeenCalled();

    const result = await upsertHomeValueAction(initialPropertyActionState, formData({ ownerId: "other-owner", asOf: "2026-08-05", marketValue: "425000.50" }));
    expect(result).toEqual({ ok: true, message: "Property value saved.", fieldErrors: {} });
    expect(mocks.repository.upsertMarketValue).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", { asOf: "2026-08-05", marketValueMinor: 42500050 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/home");
  });

  it("saves an actual mortgage anchor as integer principal minor units", async () => {
    const result = await upsertMortgageAnchorAction(initialPropertyActionState, formData({ asOf: "2026-08-05", principal: "312345.67" }));
    expect(result.ok).toBe(true);
    expect(mocks.repository.upsertMortgageAnchor).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", { asOf: "2026-08-05", principalMinor: 31234567 });
  });

  it("passes the explicit compounding convention and effective dates to the repository", async () => {
    const result = await saveMortgageTermsAction(initialPropertyActionState, formData({
      id: "",
      effectiveOn: "2026-08-05",
      annualRate: "5.49",
      compoundingConvention: "canadian_semi_annual",
      paymentExpenseId: "00000000-0000-0000-0000-000000000002",
      nextPaymentOn: "2026-08-19",
      renewalOn: "2029-08-05",
      payoffOn: "2051-08-05",
    }));
    expect(result).toEqual({ ok: true, message: "Mortgage terms saved.", fieldErrors: {} });
    expect(mocks.repository.saveMortgageTerms).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      effectiveOn: "2026-08-05",
      annualRateBps: 549,
      compoundingConvention: "canadian_semi_annual",
      paymentExpenseId: "00000000-0000-0000-0000-000000000002",
      nextPaymentOn: "2026-08-19",
      renewalOn: "2029-08-05",
      payoffOn: "2051-08-05",
    });
  });

  it("does not expose repository details in property action errors", () => {
    expect(propertyRepositoryErrorActionState(new Error("DATABASE_URL=secret query text")).message).toBe("We couldn't save the Home change. Try again.");
  });
});
