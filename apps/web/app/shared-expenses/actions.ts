"use server";

import {
  createSharedProjectsRepository,
  type SharedProjectCreateInput,
  type SharedProjectExpenseCreateInput,
  type SharedProjectParticipantCreateInput,
} from "@athena/database";
import {
  sharedProjectArchiveInputSchema,
  sharedProjectCloneInputSchema,
  sharedProjectCreateInputSchema,
  sharedProjectExpenseCreateInputSchema,
  sharedProjectExpenseDeleteInputSchema,
  sharedProjectExpenseUpdateInputSchema,
  sharedProjectParticipantCreateInputSchema,
  sharedProjectParticipantDeleteInputSchema,
  sharedProjectParticipantUpdateInputSchema,
  sharedProjectUpdateInputSchema,
} from "@athena/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import {
  emptyToNull,
  formDataBoolean,
  formDataText,
  repositoryErrorActionState,
  validationActionState,
  type ProjectActionState,
} from "./action-helpers";

const success = (message: string): ProjectActionState => ({ ok: true, message, fieldErrors: {} });

async function withProjectRepository<T>(callback: (repository: ReturnType<typeof createSharedProjectsRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createSharedProjectsRepository(database), user.owner.id), { requireTwoFactor: true });
}

function projectFields(formData: FormData) {
  return {
    name: formDataText(formData, "name"),
    year: formDataText(formData, "year"),
    ownerParticipates: formDataBoolean(formData, "ownerParticipates"),
    note: emptyToNull(formDataText(formData, "projectNote")),
  };
}

function expenseFields(formData: FormData) {
  return {
    projectId: formDataText(formData, "projectId"),
    description: formDataText(formData, "description"),
    expenseOn: emptyToNull(formDataText(formData, "expenseOn")),
    quantity: formDataText(formData, "quantity"),
    amount: formDataText(formData, "amount"),
    note: emptyToNull(formDataText(formData, "note")),
  };
}

function participantFields(formData: FormData) {
  return {
    projectId: formDataText(formData, "projectId"),
    name: formDataText(formData, "participantName"),
    paidAmount: formDataText(formData, "paidAmount"),
  };
}

function revalidateProject(projectId?: string): void {
  revalidatePath("/shared-expenses");
  if (projectId) revalidatePath(`/shared-expenses/${projectId}`);
}

export async function createProjectAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectCreateInputSchema.safeParse(projectFields(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: issue.path[0] === "note" ? ["projectNote", ...issue.path.slice(1)] : issue.path })));
  try {
    const input: SharedProjectCreateInput = { name: parsed.data.name, projectYear: parsed.data.year, ownerParticipates: parsed.data.ownerParticipates, note: parsed.data.note };
    await withProjectRepository((repository, ownerId) => repository.createProject(ownerId, input));
    revalidateProject();
    return success("Project created.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function cloneProjectAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectCloneInputSchema.safeParse({
    sourceProjectId: formDataText(formData, "sourceProjectId"),
    name: formDataText(formData, "name"),
    year: formDataText(formData, "year"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);

  let clonedProjectId: string;
  try {
    clonedProjectId = await withProjectRepository((repository, ownerId) => repository.cloneProject(ownerId, parsed.data.sourceProjectId, { name: parsed.data.name, projectYear: parsed.data.year }));
  } catch (error) {
    return repositoryErrorActionState(error);
  }
  revalidateProject(clonedProjectId);
  redirect(`/shared-expenses/${clonedProjectId}`);
}

export async function updateProjectAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectUpdateInputSchema.safeParse({ id: formDataText(formData, "projectId"), ...projectFields(formData) });
  if (!parsed.success) return validationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: issue.path[0] === "note" ? ["projectNote", ...issue.path.slice(1)] : issue.path })));
  try {
    await withProjectRepository((repository, ownerId) => repository.updateProject(ownerId, parsed.data.id, { name: parsed.data.name, projectYear: parsed.data.year, ownerParticipates: parsed.data.ownerParticipates, note: parsed.data.note }));
    revalidateProject(parsed.data.id);
    return success("Project updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function setProjectArchivedAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectArchiveInputSchema.safeParse({ projectId: formDataText(formData, "projectId"), archived: formDataBoolean(formData, "archived"), confirm: formDataBoolean(formData, "confirm") });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectRepository((repository, ownerId) => repository.setProjectArchived(ownerId, parsed.data.projectId, parsed.data.archived));
    revalidateProject(parsed.data.projectId);
    return success(parsed.data.archived ? "Project archived; history was preserved." : "Project restored.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function createProjectExpenseAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectExpenseCreateInputSchema.safeParse(expenseFields(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    const input: SharedProjectExpenseCreateInput = { description: parsed.data.description, expenseOn: parsed.data.expenseOn, quantity: parsed.data.quantity, amountMinor: parsed.data.amount, note: parsed.data.note };
    await withProjectRepository((repository, ownerId) => repository.createExpense(ownerId, parsed.data.projectId, input));
    revalidateProject(parsed.data.projectId);
    return success("Expense added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateProjectExpenseAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectExpenseUpdateInputSchema.safeParse({ id: formDataText(formData, "expenseId"), ...expenseFields(formData) });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectRepository((repository, ownerId) => repository.updateExpense(ownerId, parsed.data.id, parsed.data.projectId, { description: parsed.data.description, expenseOn: parsed.data.expenseOn, quantity: parsed.data.quantity, amountMinor: parsed.data.amount, note: parsed.data.note }));
    revalidateProject(parsed.data.projectId);
    return success("Expense updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteProjectExpenseAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectExpenseDeleteInputSchema.safeParse({ projectId: formDataText(formData, "projectId"), id: formDataText(formData, "expenseId"), confirm: formDataBoolean(formData, "confirm") });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectRepository((repository, ownerId) => repository.deleteExpense(ownerId, parsed.data.id, parsed.data.projectId));
    revalidateProject(parsed.data.projectId);
    return success("Expense deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function createProjectParticipantAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectParticipantCreateInputSchema.safeParse(participantFields(formData));
  if (!parsed.success) return validationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: issue.path[0] === "name" ? ["participantName", ...issue.path.slice(1)] : issue.path })));
  try {
    const input: SharedProjectParticipantCreateInput = { name: parsed.data.name, paidMinor: parsed.data.paidAmount };
    await withProjectRepository((repository, ownerId) => repository.createParticipant(ownerId, parsed.data.projectId, input));
    revalidateProject(parsed.data.projectId);
    return success("Participant added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateProjectParticipantAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectParticipantUpdateInputSchema.safeParse({ id: formDataText(formData, "participantId"), ...participantFields(formData) });
  if (!parsed.success) return validationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: issue.path[0] === "name" ? ["participantName", ...issue.path.slice(1)] : issue.path })));
  try {
    await withProjectRepository((repository, ownerId) => repository.updateParticipant(ownerId, parsed.data.id, parsed.data.projectId, { name: parsed.data.name, paidMinor: parsed.data.paidAmount }));
    revalidateProject(parsed.data.projectId);
    return success("Participant payment updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteProjectParticipantAction(_previousState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = sharedProjectParticipantDeleteInputSchema.safeParse({ projectId: formDataText(formData, "projectId"), id: formDataText(formData, "participantId"), confirm: formDataBoolean(formData, "confirm") });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectRepository((repository, ownerId) => repository.deleteParticipant(ownerId, parsed.data.id, parsed.data.projectId));
    revalidateProject(parsed.data.projectId);
    return success("Participant deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}
