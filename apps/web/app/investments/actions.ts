"use server";

import {
  createInvestmentHoldingsRepository,
  createInvestmentProjectionRepository,
  type InvestmentHoldingTransactionCreateRepositoryInput,
  type InvestmentProjectionProjectInput,
} from "@athena/database";
import {
  investmentCashFlowAccountLinkInputSchema,
  investmentFxRateInputSchema,
  investmentHoldingDeleteInputSchema,
  investmentHoldingCreateInputSchema,
  investmentHoldingMarketRefreshInputSchema,
  investmentHoldingPriceInputSchema,
  investmentHoldingTransactionCreateInputSchema,
  investmentHoldingTransactionDeleteInputSchema,
  investmentProjectionProjectCreateInputSchema,
  investmentProjectionProjectDeleteInputSchema,
  investmentProjectionProjectModeInputSchema,
  investmentProjectionProjectModeUpdateInputSchema,
  investmentProjectionProjectUpdateInputSchema,
} from "@athena/validation";
import { revalidatePath } from "next/cache";
import { withWritableAuthenticatedDatabase } from "../../lib/server/owner-database";
import { fetchMarketFxRate, fetchMarketQuote } from "./market-data";
import {
  emptyToNull,
  formDataMinorUnits,
  formDataBoolean,
  formDataJson,
  formDataText,
  repositoryErrorActionState,
  validationActionState,
  type InvestmentProjectionActionState,
} from "./action-helpers";

const success = (message: string): InvestmentProjectionActionState => ({ ok: true, message, fieldErrors: {} });

async function withProjectionRepository<T>(callback: (repository: ReturnType<typeof createInvestmentProjectionRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createInvestmentProjectionRepository(database), user.owner.id), { requireTwoFactor: true });
}

async function withHoldingsRepository<T>(callback: (repository: ReturnType<typeof createInvestmentHoldingsRepository>, ownerId: string) => Promise<T>): Promise<T> {
  return withWritableAuthenticatedDatabase((database, user) => callback(createInvestmentHoldingsRepository(database), user.owner.id), { requireTwoFactor: true });
}

function projectFields(formData: FormData) {
  const common = {
    name: formDataText(formData, "name"),
    notes: emptyToNull(formDataText(formData, "notes")),
    horizonYears: formDataText(formData, "horizonYears"),
    ratesBps: formDataJson(formData, "ratesBps"),
  };
  const mode = formDataText(formData, "mode");
  if (mode === "calculator") {
    return {
      ...common,
      mode,
      manualStartingAmountMinor: formDataMinorUnits(formData, "manualStartingAmountMinor"),
    };
  }
  if (mode === "portfolio") {
    return {
      ...common,
      mode,
      accountSchedules: formDataJson(formData, "accountSchedules"),
    };
  }
  return {
    ...common,
    ...(formData.has("mode") ? { mode } : {}),
    investmentAccountIds: formDataJson(formData, "investmentAccountIds"),
  };
}

function revalidateInvestments(): void {
  revalidatePath("/investments");
  revalidatePath("/");
}

function repositoryInput(parsed: InvestmentProjectionProjectInput): InvestmentProjectionProjectInput {
  if ("mode" in parsed) {
    if (parsed.mode === "calculator") {
      return {
        mode: parsed.mode,
        name: parsed.name,
        notes: parsed.notes ?? null,
        horizonYears: parsed.horizonYears,
        manualStartingAmountMinor: parsed.manualStartingAmountMinor,
        ratesBps: [...parsed.ratesBps],
      };
    }
    return {
      mode: parsed.mode,
      name: parsed.name,
      notes: parsed.notes ?? null,
      horizonYears: parsed.horizonYears,
      accountSchedules: parsed.accountSchedules.map((schedule) => ({
        ...schedule,
        annualOverrides: schedule.annualOverrides?.map((override) => ({ ...override })),
      })),
      ratesBps: [...parsed.ratesBps],
    };
  }
  return {
    name: parsed.name,
    notes: parsed.notes ?? null,
    horizonYears: parsed.horizonYears,
    investmentAccountIds: [...parsed.investmentAccountIds],
    ratesBps: [...parsed.ratesBps],
  };
}

function parseCreateInput(formData: FormData) {
  const fields = projectFields(formData);
  return formData.has("mode")
    ? investmentProjectionProjectModeInputSchema.safeParse(fields)
    : investmentProjectionProjectCreateInputSchema.safeParse(fields);
}

function parseUpdateInput(formData: FormData) {
  const fields = { id: formDataText(formData, "id"), ...projectFields(formData) };
  return formData.has("mode")
    ? investmentProjectionProjectModeUpdateInputSchema.safeParse(fields)
    : investmentProjectionProjectUpdateInputSchema.safeParse(fields);
}

export async function createInvestmentProjectionAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = parseCreateInput(formData);
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectionRepository((repository, ownerId) => repository.createProject(ownerId, repositoryInput(parsed.data)));
    revalidateInvestments();
    return success("Projection project created.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateInvestmentProjectionAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = parseUpdateInput(formData);
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectionRepository((repository, ownerId) => repository.updateProject(ownerId, parsed.data.id, repositoryInput(parsed.data)));
    revalidateInvestments();
    return success("Projection project updated.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteInvestmentProjectionAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentProjectionProjectDeleteInputSchema.safeParse({ id: formDataText(formData, "id"), confirm: formDataBoolean(formData, "confirm") });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectionRepository((repository, ownerId) => repository.deleteProject(ownerId, parsed.data.id));
    revalidateInvestments();
    return success("Projection project deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function updateInvestmentCashFlowAccountLinkAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentCashFlowAccountLinkInputSchema.safeParse({
    investmentAccountId: formDataText(formData, "investmentAccountId"),
    cashFlowAccountId: emptyToNull(formDataText(formData, "cashFlowAccountId")),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withProjectionRepository((repository, ownerId) => repository.setInvestmentCashFlowAccountLink(ownerId, parsed.data.investmentAccountId, parsed.data.cashFlowAccountId));
    revalidateInvestments();
    return success("Cash Flow account link saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function createInvestmentHoldingAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentHoldingCreateInputSchema.safeParse({
    accountId: formDataText(formData, "accountId"),
    instrumentType: formDataText(formData, "instrumentType"),
    symbol: formDataText(formData, "symbol"),
    name: formDataText(formData, "name"),
    currency: formDataText(formData, "currency"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withHoldingsRepository((repository, ownerId) => repository.createHolding(ownerId, parsed.data));
    revalidateInvestments();
    return success("Holding added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function createInvestmentHoldingTransactionAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentHoldingTransactionCreateInputSchema.safeParse({
    holdingId: formDataText(formData, "holdingId"),
    occurredOn: formDataText(formData, "occurredOn"),
    kind: formDataText(formData, "kind"),
    units: formDataText(formData, "units"),
    amount: formDataText(formData, "amount"),
    fee: formDataText(formData, "fee"),
    note: formDataText(formData, "note"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    const input: InvestmentHoldingTransactionCreateRepositoryInput = {
      occurredOn: parsed.data.occurredOn,
      kind: parsed.data.kind,
      unitsMicros: parsed.data.units,
      amountMinor: parsed.data.amount,
      feeMinor: parsed.data.fee,
      note: parsed.data.note,
    };
    await withHoldingsRepository((repository, ownerId) => repository.createTransaction(ownerId, parsed.data.holdingId, input));
    revalidateInvestments();
    return success("Holding transaction added.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteInvestmentHoldingAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentHoldingDeleteInputSchema.safeParse({
    holdingId: formDataText(formData, "holdingId"),
    confirm: formDataBoolean(formData, "confirm"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withHoldingsRepository((repository, ownerId) => repository.deleteHolding(ownerId, parsed.data.holdingId));
    revalidateInvestments();
    return success("Investment holding deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function deleteInvestmentHoldingTransactionAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentHoldingTransactionDeleteInputSchema.safeParse({
    holdingId: formDataText(formData, "holdingId"),
    transactionId: formDataText(formData, "transactionId"),
    confirm: formDataBoolean(formData, "confirm"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withHoldingsRepository((repository, ownerId) => repository.deleteTransaction(ownerId, parsed.data.holdingId, parsed.data.transactionId));
    revalidateInvestments();
    return success("Holding transaction deleted.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function setInvestmentHoldingManualPriceAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentHoldingPriceInputSchema.safeParse({
    holdingId: formDataText(formData, "holdingId"),
    effectiveOn: formDataText(formData, "effectiveOn"),
    price: formDataText(formData, "price"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withHoldingsRepository((repository, ownerId) => repository.upsertPrice(ownerId, parsed.data.holdingId, {
      effectiveOn: parsed.data.effectiveOn,
      priceMinor: parsed.data.price,
      source: "manual",
      provider: null,
    }));
    revalidateInvestments();
    return success("Manual holding price saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function setInvestmentHoldingManualFxRateAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentFxRateInputSchema.safeParse({
    effectiveOn: formDataText(formData, "effectiveOn"),
    rate: formDataText(formData, "rate"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    await withHoldingsRepository((repository, ownerId) => repository.upsertFxRate(ownerId, {
      effectiveOn: parsed.data.effectiveOn,
      ratePpm: parsed.data.rate,
      source: "manual",
      provider: null,
    }));
    revalidateInvestments();
    return success("Manual USD-to-CAD rate saved.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function refreshInvestmentHoldingMarketPriceAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const parsed = investmentHoldingMarketRefreshInputSchema.safeParse({
    holdingId: formDataText(formData, "holdingId"),
    valuationOn: formDataText(formData, "valuationOn"),
  });
  if (!parsed.success) return validationActionState(parsed.error.issues);
  try {
    const holding = await withHoldingsRepository((repository, ownerId) => repository.getHolding(ownerId, parsed.data.holdingId));
    const instrumentType = holding.instrumentType === "etf" ? "etf" : "mutual_fund";
    const quote = await fetchMarketQuote(holding.symbol, holding.currency as "CAD" | "USD", parsed.data.valuationOn, instrumentType);
    await withHoldingsRepository(async (repository, ownerId) => {
      await repository.upsertPrice(ownerId, holding.id, {
        effectiveOn: quote.effectiveOn,
        priceMinor: quote.priceMinor,
        source: "market",
        provider: quote.provider,
        quotedAt: quote.quotedAt,
      });
    });
    revalidateInvestments();
    return success("Market price refreshed.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}

export async function refreshInvestmentHoldingMarketFxAction(_previousState: InvestmentProjectionActionState, formData: FormData): Promise<InvestmentProjectionActionState> {
  const valuationOn = formDataText(formData, "valuationOn");
  const parsed = investmentFxRateInputSchema.shape.effectiveOn.safeParse(valuationOn);
  if (!parsed.success) return validationActionState(parsed.error.issues.map((issue) => ({ ...issue, path: ["valuationOn", ...issue.path] })));
  try {
    const rate = await fetchMarketFxRate(parsed.data);
    await withHoldingsRepository(async (repository, ownerId) => {
      await repository.upsertFxRate(ownerId, {
        effectiveOn: rate.effectiveOn,
        ratePpm: rate.ratePpm,
        source: "market",
        provider: rate.provider,
        quotedAt: rate.quotedAt,
      });
    });
    revalidateInvestments();
    return success("Market USD-to-CAD rate refreshed.");
  } catch (error) {
    return repositoryErrorActionState(error);
  }
}
