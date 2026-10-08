import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: {
    createProject: vi.fn(),
    cloneProject: vi.fn(),
    updateProject: vi.fn(),
    setProjectArchived: vi.fn(),
    createExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
    createParticipant: vi.fn(),
    updateParticipant: vi.fn(),
    deleteParticipant: vi.fn(),
  },
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  owner: vi.fn(async () => ({ id: "00000000-0000-0000-0000-000000000001" })),
  getServerDatabase: vi.fn(() => ({})),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@athena/database", () => ({ createSharedProjectsRepository: vi.fn(() => mocks.repository) }));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string }; readonly authUserId: string; readonly session: { readonly id: string } }) => unknown) => callback(mocks.getServerDatabase(), { owner: await mocks.owner(), authUserId: "auth-user", session: { id: "session" } }),
}));
vi.mock("../../lib/server/database", () => ({ getServerDatabase: mocks.getServerDatabase }));

import {
  cloneProjectAction,
  createProjectAction,
  createProjectExpenseAction,
  createProjectParticipantAction,
  deleteProjectExpenseAction,
  deleteProjectParticipantAction,
  setProjectArchivedAction,
  updateProjectAction,
  updateProjectExpenseAction,
  updateProjectParticipantAction,
} from "./actions";
import { initialProjectActionState, repositoryErrorActionState } from "./action-helpers";

const projectId = "00000000-0000-0000-0000-000000000010";
const clonedProjectId = "00000000-0000-0000-0000-000000000013";
const expenseId = "00000000-0000-0000-0000-000000000011";
const participantId = "00000000-0000-0000-0000-000000000012";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("shared project server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.createProject.mockResolvedValue(projectId);
    mocks.repository.cloneProject.mockResolvedValue(clonedProjectId);
    mocks.repository.updateProject.mockResolvedValue(undefined);
    mocks.repository.setProjectArchived.mockResolvedValue(undefined);
    mocks.repository.createExpense.mockResolvedValue(expenseId);
    mocks.repository.updateExpense.mockResolvedValue(undefined);
    mocks.repository.deleteExpense.mockResolvedValue(undefined);
    mocks.repository.createParticipant.mockResolvedValue(participantId);
    mocks.repository.updateParticipant.mockResolvedValue(undefined);
    mocks.repository.deleteParticipant.mockResolvedValue(undefined);
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
  });

  it("validates before repository access and converts project fields", async () => {
    const invalid = await createProjectAction(initialProjectActionState, new FormData());
    expect(invalid.fieldErrors.name).toBe("Project name is required.");
    expect(mocks.repository.createProject).not.toHaveBeenCalled();

    await createProjectAction(initialProjectActionState, formData({ name: "  Weekend cabin  ", year: "2026", ownerParticipates: "true", projectNote: "  Shared trip  " }));
    expect(mocks.repository.createProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      name: "Weekend cabin",
      projectYear: 2026,
      ownerParticipates: true,
      note: "Shared trip",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/shared-expenses");
  });

  it("clones through the authenticated owner and redirects to the new workspace", async () => {
    const invalid = await cloneProjectAction(initialProjectActionState, new FormData());
    expect(invalid.fieldErrors.sourceProjectId).toBe("Project ID is invalid.");
    expect(invalid.fieldErrors.name).toBe("Project name is required.");
    expect(invalid.fieldErrors.year).toBe("Project year must be 1900 or later.");
    expect(mocks.repository.cloneProject).not.toHaveBeenCalled();

    await expect(cloneProjectAction(initialProjectActionState, formData({ sourceProjectId: projectId, name: "  Next cabin  ", year: "2027" }))).rejects.toThrow(`REDIRECT:/shared-expenses/${clonedProjectId}`);
    expect(mocks.repository.cloneProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", projectId, { name: "Next cabin", projectYear: 2027 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/shared-expenses");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/shared-expenses/${clonedProjectId}`);

    mocks.repository.cloneProject.mockRejectedValueOnce(new Error("Project not found."));
    const missing = await cloneProjectAction(initialProjectActionState, formData({ sourceProjectId: projectId, name: "Missing source clone", year: "2027" }));
    expect(missing.message).toBe("That project was not found.");
  });

  it("updates and archives through the authenticated owner", async () => {
    await updateProjectAction(initialProjectActionState, formData({ projectId, name: "Updated project", year: "2027", ownerParticipates: "false", projectNote: "Updated note" }));
    expect(mocks.repository.updateProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", projectId, {
      name: "Updated project",
      projectYear: 2027,
      ownerParticipates: false,
      note: "Updated note",
    });

    const notConfirmed = await setProjectArchivedAction(initialProjectActionState, formData({ projectId, archived: "true", confirm: "false" }));
    expect(notConfirmed.fieldErrors.confirm).toBe("Confirm the project archive or restore.");
    expect(mocks.repository.setProjectArchived).not.toHaveBeenCalled();

    await setProjectArchivedAction(initialProjectActionState, formData({ projectId, archived: "true", confirm: "true" }));
    expect(mocks.repository.setProjectArchived).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", projectId, true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/shared-expenses/${projectId}`);
  });

  it("creates, edits, and removes expenses with quantities and fixed-point amounts", async () => {
    await createProjectExpenseAction(initialProjectActionState, formData({ projectId, description: "Cabin groceries", expenseOn: "2026-08-11", quantity: "8", amount: "10.00", note: "Receipt" }));
    expect(mocks.repository.createExpense).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", projectId, {
      description: "Cabin groceries",
      expenseOn: "2026-08-11",
      quantity: 8,
      amountMinor: 1_000,
      note: "Receipt",
    });

    await updateProjectExpenseAction(initialProjectActionState, formData({ expenseId, projectId, description: "Updated groceries", expenseOn: "", quantity: "2", amount: "40.00", note: "" }));
    expect(mocks.repository.updateExpense).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expenseId, projectId, {
      description: "Updated groceries",
      expenseOn: null,
      quantity: 2,
      amountMinor: 4_000,
      note: null,
    });

    const notConfirmed = await deleteProjectExpenseAction(initialProjectActionState, formData({ projectId, expenseId, confirm: "false" }));
    expect(notConfirmed.fieldErrors.confirm).toBe("Confirm deleting this project expense.");
    await deleteProjectExpenseAction(initialProjectActionState, formData({ projectId, expenseId, confirm: "true" }));
    expect(mocks.repository.deleteExpense).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", expenseId, projectId);
  });

  it("creates, edits, and removes duplicate-name participants with non-negative payments", async () => {
    await createProjectParticipantAction(initialProjectActionState, formData({ projectId, participantName: "Alex", paidAmount: "64.77" }));
    expect(mocks.repository.createParticipant).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", projectId, { name: "Alex", paidMinor: 6_477 });

    await updateProjectParticipantAction(initialProjectActionState, formData({ participantId, projectId, participantName: "Alex", paidAmount: "80.00" }));
    expect(mocks.repository.updateParticipant).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", participantId, projectId, { name: "Alex", paidMinor: 8_000 });

    const invalid = await createProjectParticipantAction(initialProjectActionState, formData({ projectId, participantName: "Alex", paidAmount: "-1.00" }));
    expect(invalid.fieldErrors.paidAmount).toBeDefined();
    expect(mocks.repository.createParticipant).toHaveBeenCalledTimes(1);

    const notConfirmed = await deleteProjectParticipantAction(initialProjectActionState, formData({ projectId, participantId, confirm: "false" }));
    expect(notConfirmed.fieldErrors.confirm).toBe("Confirm deleting this project participant.");
    await deleteProjectParticipantAction(initialProjectActionState, formData({ projectId, participantId, confirm: "true" }));
    expect(mocks.repository.deleteParticipant).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", participantId, projectId);
  });

  it("does not expose repository or connection details", () => {
    expect(repositoryErrorActionState(new Error("query failed DATABASE_URL=secret")).message)
      .toBe("We couldn't save the project change. Try again.");
  });
});
