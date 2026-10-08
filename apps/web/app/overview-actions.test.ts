import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    updateDisplayName: vi.fn(),
  },
  revalidatePath: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({ createOwnerRepository: vi.fn(() => mocks.repository) }));
vi.mock("../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import { updateOwnerDisplayNameAction } from "./overview-actions";
import { initialOverviewActionState, overviewRepositoryErrorActionState } from "./overview-action-helpers";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("Overview owner display-name action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.updateDisplayName.mockResolvedValue(undefined);
  });

  it("validates the display name before touching the owner repository", async () => {
    const result = await updateOwnerDisplayNameAction(initialOverviewActionState, formData({ displayName: "   " }));

    expect(result).toEqual({
      ok: false,
      message: "Review the highlighted field.",
      fieldErrors: { displayName: "Display name is required." },
    });
    expect(mocks.repository.updateDisplayName).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the server owner, trims the label, and revalidates Overview after success", async () => {
    const result = await updateOwnerDisplayNameAction(initialOverviewActionState, formData({ displayName: "  Jack & Julie  ", ownerId: "another-owner" }));

    expect(result).toEqual({ ok: true, message: "Display name updated.", fieldErrors: {} });
    expect(mocks.repository.updateDisplayName).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", "Jack & Julie");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("reports repository failures without exposing database details", async () => {
    mocks.repository.updateDisplayName.mockRejectedValueOnce(new Error("DATABASE_URL=secret query text"));

    const result = await updateOwnerDisplayNameAction(initialOverviewActionState, formData({ displayName: "Household" }));

    expect(result).toEqual({ ok: false, message: "We couldn't save your display name. Try again.", fieldErrors: {} });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(overviewRepositoryErrorActionState(new Error("Owner not found."))).toEqual({
      ok: false,
      message: "Your owner profile could not be found. Try again.",
      fieldErrors: {},
    });
  });
});
