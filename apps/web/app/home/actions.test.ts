import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withWritableAuthenticatedDatabase: vi.fn(() => { throw new Error("withWritableAuthenticatedDatabase must not run in these tests"); }),
}));

vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: mocks.withWritableAuthenticatedDatabase,
}));

import {
  createMaintenanceItemAction,
  updateMaintenanceItemAction,
} from "./actions";
import { initialMaintenanceActionState, repositoryErrorActionState } from "./action-helpers";

describe("annual maintenance server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns field errors before attempting a repository call", async () => {
    const result = await createMaintenanceItemAction(initialMaintenanceActionState, new FormData());
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Review the highlighted fields.");
    expect(result.fieldErrors.name).toBe("Name is required.");
    expect(result.fieldErrors.amount).toBeDefined();
    expect(result.fieldErrors.frequency).toBeDefined();
    expect(mocks.withWritableAuthenticatedDatabase).not.toHaveBeenCalled();
  });

  it("maps invalid IDs to an inline id error", async () => {
    const formData = new FormData();
    formData.set("id", "not-a-uuid");
    formData.set("name", "Reserve");
    formData.set("amount", "10.00");
    formData.set("frequency", "annual");
    const result = await updateMaintenanceItemAction(initialMaintenanceActionState, formData);
    expect(result.fieldErrors.id).toBe("Maintenance item ID is invalid.");
    expect(mocks.withWritableAuthenticatedDatabase).not.toHaveBeenCalled();
  });

  it("does not expose database details in action errors", () => {
    expect(repositoryErrorActionState(new Error("Failed query: select secret_database_details")).message)
      .toBe("We couldn't save the annual maintenance change. Try again.");
    expect(repositoryErrorActionState(new Error("An annual maintenance item with this name already exists.")).message)
      .toBe("An annual maintenance item with this name already exists.");
  });
});
