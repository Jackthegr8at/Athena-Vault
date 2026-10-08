"use server";

import { revalidatePath } from "next/cache";
import {
  createHomeRepository,
  type HomeMortgageTermInput,
} from "@athena/database";
import {
  homeMortgageAnchorInputSchema,
  homeMortgageTermsInputSchema,
  homeValueDateSchema,
  homeValueInputSchema,
} from "@athena/validation";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import { formDataText } from "./action-helpers";
import {
  propertyRepositoryErrorActionState,
  propertyValidationActionState,
  type PropertyActionState,
} from "./property-state";

function successState(message: string): PropertyActionState {
  return { ok: true, message, fieldErrors: {} };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function revalidateHome(): void {
  revalidatePath("/home");
  revalidatePath("/");
}

export async function createHomeAction(
  _previousState: PropertyActionState,
  _formData: FormData,
): Promise<PropertyActionState> {
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHomeRepository(database).createHome(user.owner.id), { requireTwoFactor: true });
    revalidateHome();
    return successState("Home profile created.");
  } catch (error) {
    return propertyRepositoryErrorActionState(error);
  }
}

export async function upsertHomeValueAction(
  _previousState: PropertyActionState,
  formData: FormData,
): Promise<PropertyActionState> {
  const parsed = homeValueInputSchema.safeParse({
    asOf: formDataText(formData, "asOf"),
    marketValue: formDataText(formData, "marketValue"),
  });
  if (!parsed.success) return propertyValidationActionState(parsed.error.issues);
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHomeRepository(database).upsertMarketValue(user.owner.id, {
      asOf: parsed.data.asOf,
      marketValueMinor: parsed.data.marketValue,
    }), { requireTwoFactor: true });
    revalidateHome();
    return successState("Property value saved.");
  } catch (error) {
    return propertyRepositoryErrorActionState(error);
  }
}

export async function deleteHomeValueAction(
  _previousState: PropertyActionState,
  formData: FormData,
): Promise<PropertyActionState> {
  const parsed = homeValueDateSchema.safeParse(formDataText(formData, "asOf"));
  if (!parsed.success) return propertyValidationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: ["asOf", ...issue.path] })));
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHomeRepository(database).deleteMarketValue(user.owner.id, parsed.data), { requireTwoFactor: true });
    revalidateHome();
    return successState("Property value removed; later dates will carry the previous value.");
  } catch (error) {
    return propertyRepositoryErrorActionState(error);
  }
}

export async function upsertMortgageAnchorAction(
  _previousState: PropertyActionState,
  formData: FormData,
): Promise<PropertyActionState> {
  const parsed = homeMortgageAnchorInputSchema.safeParse({
    asOf: formDataText(formData, "asOf"),
    principal: formDataText(formData, "principal"),
  });
  if (!parsed.success) return propertyValidationActionState(parsed.error.issues);
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHomeRepository(database).upsertMortgageAnchor(user.owner.id, {
      asOf: parsed.data.asOf,
      principalMinor: parsed.data.principal,
    }), { requireTwoFactor: true });
    revalidateHome();
    return successState("Actual mortgage balance saved.");
  } catch (error) {
    return propertyRepositoryErrorActionState(error);
  }
}

export async function deleteMortgageAnchorAction(
  _previousState: PropertyActionState,
  formData: FormData,
): Promise<PropertyActionState> {
  const parsed = homeValueDateSchema.safeParse(formDataText(formData, "asOf"));
  if (!parsed.success) return propertyValidationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: ["asOf", ...issue.path] })));
  try {
    await withWritableAuthenticatedDatabase((database, user) => createHomeRepository(database).deleteMortgageAnchor(user.owner.id, parsed.data), { requireTwoFactor: true });
    revalidateHome();
    return successState("Actual mortgage balance removed.");
  } catch (error) {
    return propertyRepositoryErrorActionState(error);
  }
}

function mortgageTermsFromFormData(formData: FormData) {
  return homeMortgageTermsInputSchema.safeParse({
    id: emptyToNull(formDataText(formData, "id")),
    effectiveOn: formDataText(formData, "effectiveOn"),
    annualRate: formDataText(formData, "annualRate"),
    compoundingConvention: formDataText(formData, "compoundingConvention"),
    paymentExpenseId: formDataText(formData, "paymentExpenseId"),
    nextPaymentOn: formDataText(formData, "nextPaymentOn"),
    renewalOn: formDataText(formData, "renewalOn"),
    payoffOn: formDataText(formData, "payoffOn"),
  });
}

export async function saveMortgageTermsAction(
  _previousState: PropertyActionState,
  formData: FormData,
): Promise<PropertyActionState> {
  const parsed = mortgageTermsFromFormData(formData);
  if (!parsed.success) return propertyValidationActionState(parsed.error.issues);
  try {
    const input: HomeMortgageTermInput = {
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
      effectiveOn: parsed.data.effectiveOn,
      annualRateBps: parsed.data.annualRate,
      compoundingConvention: parsed.data.compoundingConvention,
      paymentExpenseId: parsed.data.paymentExpenseId,
      nextPaymentOn: parsed.data.nextPaymentOn,
      renewalOn: parsed.data.renewalOn,
      payoffOn: parsed.data.payoffOn,
    };
    await withWritableAuthenticatedDatabase((database, user) => createHomeRepository(database).saveMortgageTerms(user.owner.id, input), { requireTwoFactor: true });
    revalidateHome();
    return successState(parsed.data.id ? "Mortgage terms updated." : "Mortgage terms saved.");
  } catch (error) {
    return propertyRepositoryErrorActionState(error);
  }
}
