import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callOrder: [] as string[],
  repository: {
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    setInvestmentCashFlowAccountLink: vi.fn(),
    createHolding: vi.fn(),
    createTransaction: vi.fn(),
    deleteHolding: vi.fn(),
    deleteTransaction: vi.fn(),
    upsertPrice: vi.fn(),
    upsertFxRate: vi.fn(),
    getHolding: vi.fn(),
  },
  fetchMarketQuote: vi.fn(),
  fetchMarketFxRate: vi.fn(),
  createInvestmentHoldingsRepository: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@athena/database", () => ({ createInvestmentProjectionRepository: vi.fn(() => mocks.repository), createInvestmentHoldingsRepository: mocks.createInvestmentHoldingsRepository }));
vi.mock("./market-data", () => ({ fetchMarketQuote: mocks.fetchMarketQuote, fetchMarketFxRate: mocks.fetchMarketFxRate }));
vi.mock("../../lib/server/owner-database", () => ({
  withWritableAuthenticatedDatabase: async (callback: (database: unknown, user: { readonly owner: { readonly id: string } }) => unknown) => {
    mocks.callOrder.push("repository-wrapper");
    return callback({}, { owner: { id: "00000000-0000-0000-0000-000000000001" } });
  },
}));

import {
  createInvestmentProjectionAction,
  deleteInvestmentProjectionAction,
  updateInvestmentProjectionAction,
  updateInvestmentCashFlowAccountLinkAction,
  createInvestmentHoldingAction,
  createInvestmentHoldingTransactionAction,
  deleteInvestmentHoldingAction,
  deleteInvestmentHoldingTransactionAction,
  setInvestmentHoldingManualPriceAction,
  setInvestmentHoldingManualFxRateAction,
  refreshInvestmentHoldingMarketPriceAction,
  refreshInvestmentHoldingMarketFxAction,
} from "./actions";
import { initialInvestmentProjectionActionState } from "./action-helpers";

const accountId = "00000000-0000-0000-0000-000000000010";
const secondAccountId = "00000000-0000-0000-0000-000000000011";
const projectId = "00000000-0000-0000-0000-000000000020";
const holdingId = "00000000-0000-0000-0000-000000000030";
const transactionId = "00000000-0000-0000-0000-000000000040";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("investment projection server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    mocks.repository.createProject.mockResolvedValue(projectId);
    mocks.repository.updateProject.mockResolvedValue(undefined);
    mocks.repository.deleteProject.mockResolvedValue(undefined);
    mocks.repository.setInvestmentCashFlowAccountLink.mockResolvedValue(undefined);
    mocks.repository.createHolding.mockResolvedValue(holdingId);
    mocks.repository.createTransaction.mockResolvedValue(transactionId);
    mocks.repository.deleteHolding.mockResolvedValue(undefined);
    mocks.repository.deleteTransaction.mockResolvedValue(undefined);
    mocks.repository.upsertPrice.mockImplementation(async () => { mocks.callOrder.push("upsert-price"); });
    mocks.repository.upsertFxRate.mockImplementation(async () => { mocks.callOrder.push("upsert-fx-rate"); });
    mocks.repository.getHolding.mockImplementation(async () => {
      mocks.callOrder.push("get-holding");
      return { id: holdingId, symbol: "XBAL.TO", currency: "CAD", instrumentType: "etf" };
    });
    mocks.createInvestmentHoldingsRepository.mockReturnValue(mocks.repository);
    mocks.fetchMarketQuote.mockImplementation(async () => {
      mocks.callOrder.push("fetch-quote");
      return { effectiveOn: "2026-09-08", priceMinor: 12_550, provider: "Yahoo Finance", quotedAt: new Date() };
    });
    mocks.fetchMarketFxRate.mockImplementation(async () => {
      mocks.callOrder.push("fetch-fx");
      return { effectiveOn: "2026-09-08", ratePpm: 1_350_000, provider: "Yahoo Finance", quotedAt: new Date() };
    });
  });

  it("validates before touching the repository and forwards fixed-point project settings", async () => {
    const invalid = await createInvestmentProjectionAction(initialInvestmentProjectionActionState, new FormData());
    expect(invalid.ok).toBe(false);
    expect(mocks.repository.createProject).not.toHaveBeenCalled();

    await createInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({
      name: "Primerica + Wealthsimple",
      notes: "Retirement outlook",
      horizonYears: "30",
      investmentAccountIds: JSON.stringify([accountId, secondAccountId]),
      ratesBps: JSON.stringify([500, 400, 300, 200]),
    }));
    expect(mocks.repository.createProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      name: "Primerica + Wealthsimple",
      notes: "Retirement outlook",
      horizonYears: 30,
      investmentAccountIds: [accountId, secondAccountId],
      ratesBps: [500, 400, 300, 200],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/investments");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("forwards a calculator project with safe integer minor units", async () => {
    await createInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({
      mode: "calculator",
      name: "Manual retirement calculator",
      notes: "No live account inputs",
      horizonYears: "25",
      manualStartingAmountMinor: "125000",
      ratesBps: JSON.stringify(["500", "400", "300", "200"]),
    }));

    expect(mocks.repository.createProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      mode: "calculator",
      name: "Manual retirement calculator",
      notes: "No live account inputs",
      horizonYears: 25,
      manualStartingAmountMinor: 125000,
      ratesBps: [500, 400, 300, 200],
    });

    const unsafe = await createInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({
      mode: "calculator",
      name: "Unsafe amount",
      horizonYears: "25",
      manualStartingAmountMinor: "9007199254740992",
      ratesBps: JSON.stringify([500]),
    }));
    expect(unsafe.ok).toBe(false);
    expect(unsafe.fieldErrors.manualStartingAmountMinor).toBeDefined();
    expect(mocks.repository.createProject).toHaveBeenCalledTimes(1);
  });

  it("normalizes nested portfolio schedules, source modes, and annual overrides without mutating Cash Flow", async () => {
    await createInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({
      mode: "portfolio",
      name: "Household portfolio",
      notes: "Editable planning assumptions",
      horizonYears: "30",
      ratesBps: JSON.stringify([500, 300]),
      accountSchedules: JSON.stringify([
        {
          investmentAccountId: accountId,
          displayOrder: "0",
          frequency: "monthly",
          contributionSource: "cash_flow",
          baseContributionMinor: "12500",
          annualIncreaseBps: "1000",
          annualOverrides: [{ year: "2027", amountMinor: "15000" }],
        },
        {
          investmentAccountId: secondAccountId,
          displayOrder: "1",
          frequency: "biweekly",
          contributionSource: "manual",
          baseContributionMinor: "5000",
          annualIncreaseBps: "0",
          annualIncreaseMode: "fixed_amount",
          annualIncreaseMinor: "3000",
          annualOverrides: [],
        },
      ]),
    }));

    expect(mocks.repository.createProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      mode: "portfolio",
      name: "Household portfolio",
      notes: "Editable planning assumptions",
      horizonYears: 30,
      ratesBps: [500, 300],
      accountSchedules: [
        {
          investmentAccountId: accountId,
          displayOrder: 0,
          frequency: "monthly",
          contributionSource: "cash_flow",
          baseContributionMinor: 12500,
          annualIncreaseBps: 1000,
          annualIncreaseMode: "percentage",
          annualIncreaseMinor: 0,
          annualOverrides: [{ year: 2027, amountMinor: 15000 }],
        },
        {
          investmentAccountId: secondAccountId,
          displayOrder: 1,
          frequency: "biweekly",
          contributionSource: "manual",
          baseContributionMinor: 5000,
          annualIncreaseBps: 0,
          annualIncreaseMode: "fixed_amount",
          annualIncreaseMinor: 3000,
          annualOverrides: [],
        },
      ],
    });
  });

  it("updates and deletes through the authenticated owner with explicit confirmation", async () => {
    await updateInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({
      id: projectId,
      name: "Updated outlook",
      notes: "",
      horizonYears: "12",
      investmentAccountIds: JSON.stringify([accountId]),
      ratesBps: JSON.stringify([500, 250]),
    }));
    expect(mocks.repository.updateProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", projectId, {
      name: "Updated outlook",
      notes: null,
      horizonYears: 12,
      investmentAccountIds: [accountId],
      ratesBps: [500, 250],
    });

    const notConfirmed = await deleteInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({ id: projectId, confirm: "false" }));
    expect(notConfirmed.fieldErrors.confirm).toBe("Confirm deleting this projection project.");
    expect(mocks.repository.deleteProject).not.toHaveBeenCalled();

    await deleteInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({ id: projectId, confirm: "true" }));
    expect(mocks.repository.deleteProject).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", projectId);
  });

  it("maps repository failures without exposing database details", async () => {
    mocks.repository.createProject.mockRejectedValueOnce(new Error("duplicate key value violates investment_projection_projects_owner_name_idx"));
    const duplicate = await createInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({
      mode: "calculator",
      name: "Duplicate",
      horizonYears: "1",
      manualStartingAmountMinor: "0",
      ratesBps: JSON.stringify([500]),
    }));
    expect(duplicate).toMatchObject({ ok: false, message: "A projection project with that name already exists.", fieldErrors: {} });

    mocks.repository.deleteProject.mockRejectedValueOnce(new Error("Investment projection project not found."));
    const missing = await deleteInvestmentProjectionAction(initialInvestmentProjectionActionState, formData({ id: projectId, confirm: "true" }));
    expect(missing).toMatchObject({ ok: false, message: "That projection project was not found.", fieldErrors: {} });
  });

  it("validates and saves an owner-scoped Cash Flow destination link", async () => {
    const invalid = await updateInvestmentCashFlowAccountLinkAction(initialInvestmentProjectionActionState, formData({
      investmentAccountId: "not-an-account-id",
      cashFlowAccountId: "",
    }));
    expect(invalid.ok).toBe(false);
    expect(mocks.repository.setInvestmentCashFlowAccountLink).not.toHaveBeenCalled();

    await updateInvestmentCashFlowAccountLinkAction(initialInvestmentProjectionActionState, formData({
      investmentAccountId: accountId,
      cashFlowAccountId: secondAccountId,
    }));
    expect(mocks.repository.setInvestmentCashFlowAccountLink).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      accountId,
      secondAccountId,
    );

    await updateInvestmentCashFlowAccountLinkAction(initialInvestmentProjectionActionState, formData({
      investmentAccountId: accountId,
      cashFlowAccountId: "",
    }));
    expect(mocks.repository.setInvestmentCashFlowAccountLink).toHaveBeenLastCalledWith(
      "00000000-0000-0000-0000-000000000001",
      accountId,
      null,
    );
  });

  it("forwards REEI/RDSP holdings and fixed-point ledger entries, including zero amounts", async () => {
    await createInvestmentHoldingAction(initialInvestmentProjectionActionState, formData({
      accountId,
      instrumentType: "mutual_fund",
      symbol: "XBAL.TO",
      name: "Balanced fund",
      currency: "CAD",
    }));
    expect(mocks.repository.createHolding).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      accountId,
      instrumentType: "mutual_fund",
      symbol: "XBAL.TO",
      name: "Balanced fund",
      currency: "CAD",
    });

    await createInvestmentHoldingTransactionAction(initialInvestmentProjectionActionState, formData({
      holdingId,
      occurredOn: "2026-09-08",
      kind: "opening",
      units: "0.500000",
      amount: "0.00",
      fee: "0.00",
      note: "Initial statement position",
    }));
    expect(mocks.repository.createTransaction).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", holdingId, {
      occurredOn: "2026-09-08",
      kind: "opening",
      unitsMicros: 500_000,
      amountMinor: 0,
      feeMinor: 0,
      note: "Initial statement position",
    });
  });

  it("keeps invalid ledger input out of the repository and requires delete confirmation", async () => {
    const invalid = await createInvestmentHoldingTransactionAction(initialInvestmentProjectionActionState, formData({
      holdingId,
      occurredOn: "2026-09-08",
      kind: "distribution",
      units: "1",
      amount: "0.00",
      fee: "0.00",
      note: "",
    }));
    expect(invalid.fieldErrors.units).toBeDefined();
    expect(invalid.fieldErrors.amount).toBeDefined();
    expect(mocks.repository.createTransaction).not.toHaveBeenCalled();

    const notConfirmed = await deleteInvestmentHoldingTransactionAction(initialInvestmentProjectionActionState, formData({ holdingId, transactionId, confirm: "false" }));
    expect(notConfirmed.fieldErrors.confirm).toBe("Invalid literal value, expected true");
    expect(mocks.repository.deleteTransaction).not.toHaveBeenCalled();

    await deleteInvestmentHoldingTransactionAction(initialInvestmentProjectionActionState, formData({ holdingId, transactionId, confirm: "true" }));
    expect(mocks.repository.deleteTransaction).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", holdingId, transactionId);
  });

  it("deletes a holding only after explicit confirmation and keeps the owner scope", async () => {
    const notConfirmed = await deleteInvestmentHoldingAction(initialInvestmentProjectionActionState, formData({ holdingId, confirm: "false" }));
    expect(notConfirmed.fieldErrors.confirm).toBe("Invalid literal value, expected true");
    expect(mocks.repository.deleteHolding).not.toHaveBeenCalled();

    const deleted = await deleteInvestmentHoldingAction(initialInvestmentProjectionActionState, formData({ holdingId, confirm: "true" }));
    expect(deleted).toMatchObject({ ok: true, message: "Investment holding deleted.", fieldErrors: {} });
    expect(mocks.repository.deleteHolding).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", holdingId);
  });

  it("saves manual prices and rates without replacing the manual source", async () => {
    await setInvestmentHoldingManualPriceAction(initialInvestmentProjectionActionState, formData({ holdingId, effectiveOn: "2026-09-08", price: "125.50" }));
    expect(mocks.repository.upsertPrice).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", holdingId, {
      effectiveOn: "2026-09-08", priceMinor: 12_550, source: "manual", provider: null,
    });

    await setInvestmentHoldingManualFxRateAction(initialInvestmentProjectionActionState, formData({ effectiveOn: "2026-09-08", rate: "1.35" }));
    expect(mocks.repository.upsertFxRate).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      effectiveOn: "2026-09-08", ratePpm: 1_350_000, source: "manual", provider: null,
    });
  });

  it("refreshes market prices between owner-scoped read and write wrappers", async () => {
    await refreshInvestmentHoldingMarketPriceAction(initialInvestmentProjectionActionState, formData({ holdingId, valuationOn: "2026-09-08" }));
    expect(mocks.callOrder).toEqual(["repository-wrapper", "get-holding", "fetch-quote", "repository-wrapper", "upsert-price"]);
    expect(mocks.fetchMarketQuote).toHaveBeenCalledWith("XBAL.TO", "CAD", "2026-09-08", "etf");
    expect(mocks.repository.upsertPrice).toHaveBeenLastCalledWith("00000000-0000-0000-0000-000000000001", holdingId, expect.objectContaining({ source: "market", priceMinor: 12_550 }));
  });

  it("fetches market FX before its sole owner-scoped write wrapper", async () => {
    await refreshInvestmentHoldingMarketFxAction(initialInvestmentProjectionActionState, formData({ valuationOn: "2026-09-08" }));
    expect(mocks.callOrder).toEqual(["fetch-fx", "repository-wrapper", "upsert-fx-rate"]);
    expect(mocks.fetchMarketFxRate).toHaveBeenCalledWith("2026-09-08");
    expect(mocks.repository.upsertFxRate).toHaveBeenLastCalledWith("00000000-0000-0000-0000-000000000001", expect.objectContaining({ source: "market", ratePpm: 1_350_000 }));
  });

  it("keeps saved prices unchanged when a market quote is unavailable", async () => {
    mocks.fetchMarketQuote.mockRejectedValueOnce(new Error("Market data is unavailable."));
    const unavailable = await refreshInvestmentHoldingMarketPriceAction(initialInvestmentProjectionActionState, formData({ holdingId, valuationOn: "2026-09-08" }));
    expect(unavailable).toMatchObject({
      ok: false,
      message: "Market data is unavailable for this symbol. Try a provider symbol such as VEQT.TO or enter a manual price; your saved prices were not changed.",
      fieldErrors: {},
    });
  });

  it("forwards mutual-fund holdings to the NAV-aware market adapter", async () => {
    mocks.repository.getHolding.mockResolvedValue({ id: holdingId, symbol: "VIC1000", currency: "CAD", instrumentType: "mutual_fund" });

    await refreshInvestmentHoldingMarketPriceAction(initialInvestmentProjectionActionState, formData({ holdingId, valuationOn: "2026-09-09" }));

    expect(mocks.fetchMarketQuote).toHaveBeenCalledWith("VIC1000", "CAD", "2026-09-09", "mutual_fund");
  });
});
