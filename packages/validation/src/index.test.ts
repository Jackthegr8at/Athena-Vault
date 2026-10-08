import { describe, expect, it } from "vitest";
import {
  accountCreateInputSchema,
  accountAvailabilityInputSchema,
  accountLastFourSchema,
  accountCashFlowPlannedTimelineInputSchema,
  accountContributionExceptionInputSchema,
  accountContributionRuleInputSchema,
  accountMetadataInputSchema,
  accountReorderInputSchema,
  accountProjectionRecalculationInputSchema,
  annualBudgetArchiveInputSchema,
  annualBudgetCreateInputSchema,
  annualBudgetRelinkInputSchema,
  annualBudgetRenameInputSchema,
  annualBudgetRestoreInputSchema,
  annualBudgetUpdateInputSchema,
  annualExpenseArchiveInputSchema,
  annualExpenseMoveInputSchema,
  annualExpensePaymentMutationSchema,
  annualExpenseRemainderTransferInputSchema,
  annualExpenseTemplateInputSchema,
  annualExpenseYearOverrideInputSchema,
  accountBalanceNoteInputSchema,
  balanceSnapshotInputSchema,
  cadAmountToMinorUnits,
  cashFlowInitialIncomeInputSchema,
  cashFlowInitialTimelineInputSchema,
  cashFlowTransactionRestoreInputSchema,
  recurringOccurrenceExceptionInputSchema,
  recurringOccurrenceRestoreInputSchema,
  recurringOverrideGroupUpdateInputSchema,
  recurringSeriesCreateInputSchema,
  recurringSeriesDeleteInputSchema,
  recurringSeriesEndInputSchema,
  recurringSeriesGenerationInputSchema,
  recurringSeriesPauseResumeInputSchema,
  recurringSeriesRenameInputSchema,
  recurringSeriesVersionChangeInputSchema,
  recurringSeriesVersionDeleteInputSchema,
  recurringSeriesVersionEditInputSchema,
  maintenanceItemInputSchema,
  moneySchema,
  homeMortgageTermsInputSchema,
  homeValueInputSchema,
  mortgageRateToBasisPoints,
  payPeriodSchema,
  ownerDisplayNameInputSchema,
  salaryAmountToMinorUnits,
  salaryRateToBasisPoints,
  salaryRrqContributionYtdSchema,
  rrqYearLimitInputSchema,
  salaryYearCreateInputSchema,
  salaryFinalizationInputSchema,
  salaryFinalizedYearCreateInputSchema,
  salarySnapshotCreateInputSchema,
  salarySnapshotUpdateInputSchema,
  sharedProjectArchiveInputSchema,
  sharedProjectCloneInputSchema,
  sharedProjectCreateInputSchema,
  sharedProjectExpenseDeleteInputSchema,
  sharedProjectExpenseCreateInputSchema,
  sharedProjectParticipantDeleteInputSchema,
  sharedProjectParticipantCreateInputSchema,
  investmentProjectionCalculatorProjectInputSchema,
  investmentProjectionPortfolioProjectInputSchema,
  investmentProjectionProjectCreateInputSchema,
  investmentProjectionProjectUpdateInputSchema,
  investmentProjectionProjectDeleteInputSchema,
  investmentHoldingCreateInputSchema,
  investmentHoldingTransactionCreateInputSchema,
  investmentHoldingPriceInputSchema,
  investmentFxRateInputSchema,
  investmentHoldingMarketRefreshInputSchema,
  investmentHoldingDeleteInputSchema,
  investmentHoldingTransactionDeleteInputSchema,
  investmentUnitsToMicros,
  investmentFxRateToPpm,
  calculationWorkbookDeleteInputSchema,
  calculationWorkbookSaveInputSchema,
  goalAchievedInputSchema,
  goalPlanAmountSchema,
  goalPlanCountsAsExpenseSchema,
  goalPlanEnabledInputSchema,
  goalPlanFrequencySchema,
  goalPlanIdSchema,
  goalPlanSaveInputSchema,
  goalPlanSourceAccountSchema,
} from "./index";

describe("money schema validation", () => {
  it("rejects integers above the safe-integer ceiling", () => {
    const result = moneySchema.safeParse(2 ** 53);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Amount must be a safe integer.");
    }
  });

  it("accepts the maximum safe integer", () => {
    expect(moneySchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
  });
});

describe("pay period validation", () => {
  it("rejects fractional money values", () => {
    expect(payPeriodSchema.safeParse({ id: "p", label: "Pay", payDate: "2026-08-14", openingBalance: 1.2, items: [] }).success).toBe(false);
  });

  it("requires an explicit transfer direction", () => {
    const result = payPeriodSchema.safeParse({ id: "p", label: "Pay", payDate: "2026-08-14", openingBalance: 1000, items: [{ id: "t", label: "Savings", account: "Tangerine", amount: 100, kind: "transfer", planned: true }] });
    expect(result.success).toBe(false);
  });
});

describe("annual maintenance validation", () => {
  it("trims names and converts CAD decimals to integer minor units", () => {
    expect(maintenanceItemInputSchema.parse({ name: "  Snow clearing  ", amount: "460.00", frequency: "annual" })).toEqual({
      name: "Snow clearing",
      amount: 46000,
      frequency: "annual",
    });
  });

  it("accepts zero and one or two decimal places", () => {
    expect(maintenanceItemInputSchema.parse({ name: "Reserve", amount: "0", frequency: "monthly" }).amount).toBe(0);
    expect(maintenanceItemInputSchema.parse({ name: "Reserve", amount: "1.2", frequency: "monthly" }).amount).toBe(120);
    expect(maintenanceItemInputSchema.parse({ name: "Reserve", amount: "1.23", frequency: "monthly" }).amount).toBe(123);
  });

  it("rejects blank names, negative amounts, extra decimals, and quarterly frequency", () => {
    for (const input of [
      { name: "   ", amount: "1.00", frequency: "annual" },
      { name: "Reserve", amount: "-1.00", frequency: "annual" },
      { name: "Reserve", amount: "1.001", frequency: "annual" },
      { name: "Reserve", amount: "1.00", frequency: "quarterly" },
    ]) {
      expect(maintenanceItemInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("account timeline validation", () => {
  it("requires an ordered first payday and Cash Flow horizon", () => {
    expect(cashFlowInitialTimelineInputSchema.parse({ firstPayday: "2026-08-19", throughDate: "2026-12-31" })).toEqual({ firstPayday: "2026-08-19", throughDate: "2026-12-31" });
    expect(cashFlowInitialTimelineInputSchema.safeParse({ firstPayday: "2026-12-31", throughDate: "2026-08-19" }).success).toBe(false);
    expect(cashFlowInitialTimelineInputSchema.safeParse({ firstPayday: "not-a-date", throughDate: "2026-12-31" }).success).toBe(false);
  });

  it("trims account metadata and only accepts custom labels for Other", () => {
    expect(accountMetadataInputSchema.parse({ name: "  Travel reserve ", institutionName: "  Tangerine  ", kind: "other", customTypeLabel: "  Emergency cash " })).toEqual({
      name: "Travel reserve",
      institutionName: "Tangerine",
      kind: "other",
      customTypeLabel: "Emergency cash",
      lastFour: null,
    });
    expect(accountMetadataInputSchema.safeParse({ name: "Chequing", institutionName: "CIBC", kind: "checking", customTypeLabel: "Personal" }).success).toBe(false);
    expect(accountMetadataInputSchema.parse({ name: "Disability savings", institutionName: "CIBC", kind: "rdsp", customTypeLabel: null })).toMatchObject({
      name: "Disability savings",
      institutionName: "CIBC",
      kind: "rdsp",
      customTypeLabel: null,
    });
  });

  it("validates available-cash inclusion independently from account metadata", () => {
    expect(accountAvailabilityInputSchema.parse({
      accountId: "00000000-0000-0000-0000-000000000001",
      includeInAvailableCash: true,
    })).toEqual({
      accountId: "00000000-0000-0000-0000-000000000001",
      includeInAvailableCash: true,
    });
    expect(accountAvailabilityInputSchema.safeParse({
      accountId: "not-an-account",
      includeInAvailableCash: false,
    }).success).toBe(false);
    expect(accountAvailabilityInputSchema.safeParse({
      accountId: "00000000-0000-0000-0000-000000000001",
      includeInAvailableCash: "true",
    }).success).toBe(false);
  });

  it("validates cash-flow planned timeline opt-in independently from account metadata", () => {
    expect(accountCashFlowPlannedTimelineInputSchema.parse({
      accountId: "00000000-0000-0000-0000-000000000001",
      useCashFlowPlannedTimeline: true,
    })).toEqual({
      accountId: "00000000-0000-0000-0000-000000000001",
      useCashFlowPlannedTimeline: true,
    });
    expect(accountCashFlowPlannedTimelineInputSchema.safeParse({
      accountId: "not-an-account",
      useCashFlowPlannedTimeline: false,
    }).success).toBe(false);
    expect(accountCashFlowPlannedTimelineInputSchema.safeParse({
      accountId: "00000000-0000-0000-0000-000000000001",
      useCashFlowPlannedTimeline: "true",
    }).success).toBe(false);
  });

  it("converts signed CAD amounts to integer minor units without floating point", () => {
    expect(cadAmountToMinorUnits("1.2")).toBe(120);
    expect(cadAmountToMinorUnits("-1.23")).toBe(-123);
    expect(cadAmountToMinorUnits("-0.50")).toBe(-50);
    expect(cadAmountToMinorUnits("1.001")).toBeNull();
  });

  it("requires paired initial balance fields and validates snapshot identifiers/dates", () => {
    expect(accountCreateInputSchema.safeParse({ name: "Reserve", institutionName: "CIBC", kind: "cash", customTypeLabel: null, initialBalance: "12.00", initialBalanceDate: null, initialStatus: "actual" }).success).toBe(false);
    expect(balanceSnapshotInputSchema.safeParse({ accountId: "not-a-uuid", asOf: "2026-08-05", balance: "10.00", status: "actual" }).success).toBe(false);
    expect(balanceSnapshotInputSchema.parse({ accountId: "00000000-0000-0000-0000-000000000001", asOf: "2026-08-05", balance: "10.00", status: "planned" }).balance).toBe(1000);
  });

  it("trims optional account balance notes and enforces the character limit", () => {
    const base = { accountId: "00000000-0000-0000-0000-000000000001", asOf: "2026-08-19" };
    expect(accountBalanceNoteInputSchema.parse({ ...base, note: "  Temporary overdraft while rent cleared  " }).note).toBe("Temporary overdraft while rent cleared");
    expect(accountBalanceNoteInputSchema.parse({ ...base, note: "   " }).note).toBeNull();
    expect(accountBalanceNoteInputSchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
  });

  it("accepts an optional four-character alphanumeric account identifier", () => {
    expect(accountLastFourSchema.parse(" 4242 ")).toBe("4242");
    expect(accountLastFourSchema.parse(" a1b2 ")).toBe("A1B2");
    expect(accountLastFourSchema.parse("")).toBeNull();
    expect(accountLastFourSchema.parse(undefined)).toBeNull();
    for (const value of ["123", "12345", "12 4", "12-4", "12_4"]) {
      expect(accountLastFourSchema.safeParse(value).success).toBe(false);
    }
  });

  it("allows alphanumeric last-four values only for REEI/RDSP accounts", () => {
    const base = { name: "Disability savings", institutionName: "CIBC", customTypeLabel: null, lastFour: "a1b2" };
    expect(accountMetadataInputSchema.parse({ ...base, kind: "rdsp" }).lastFour).toBe("A1B2");
    const nonRdsp = accountMetadataInputSchema.safeParse({ ...base, name: "Chequing", kind: "checking" });
    expect(nonRdsp.success).toBe(false);
    if (nonRdsp.success) throw new Error("Expected non-REEI alphanumeric identifiers to be rejected.");
    expect(nonRdsp.error.issues.some((issue) => issue.path[0] === "lastFour" && issue.message === "Enter exactly four digits.")).toBe(true);
  });

  it("requires a valid selected account and one of the projection scopes", () => {
    expect(accountProjectionRecalculationInputSchema.parse({
      accountId: "00000000-0000-0000-0000-000000000001",
      scope: "all",
    })).toEqual({ accountId: "00000000-0000-0000-0000-000000000001", scope: "all" });
    expect(accountProjectionRecalculationInputSchema.safeParse({ accountId: "not-an-account", scope: "account" }).success).toBe(false);
  });

  it("limits account reordering to known timeline sections and UUIDs", () => {
    expect(accountReorderInputSchema.parse({
      section: "other:reserve",
      accountIds: ["00000000-0000-0000-0000-000000000001"],
    })).toEqual({ section: "other:reserve", accountIds: ["00000000-0000-0000-0000-000000000001"] });
    expect(accountReorderInputSchema.safeParse({ section: "investment", accountIds: [] }).success).toBe(false);
    expect(accountReorderInputSchema.safeParse({ section: "other:", accountIds: ["not-an-account"] }).success).toBe(false);
  });
});

describe("owner display-name validation", () => {
  it("trims arbitrary household labels and enforces the 1-to-80 character range", () => {
    expect(ownerDisplayNameInputSchema.parse({ displayName: "  Jack & Julie  " })).toEqual({ displayName: "Jack & Julie" });
    expect(ownerDisplayNameInputSchema.parse({ displayName: "A".repeat(80) }).displayName).toHaveLength(80);
    expect(ownerDisplayNameInputSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(ownerDisplayNameInputSchema.safeParse({ displayName: "A".repeat(81) }).success).toBe(false);
  });
});

describe("calculation workbook validation", () => {
  const workbookId = "00000000-0000-0000-0000-000000000001";
  const snapshot = { sheetOrder: ["sheet-1"], sheets: { "sheet-1": { id: "sheet-1" } } };

  it("normalizes workbook names and requires a Univer workbook shape", () => {
    expect(calculationWorkbookSaveInputSchema.parse({ id: workbookId, name: "  Household math  ", snapshot })).toEqual({
      id: workbookId,
      name: "Household math",
      snapshot,
    });
    expect(calculationWorkbookSaveInputSchema.safeParse({ id: workbookId, name: "Scratch", snapshot: {} }).success).toBe(false);
  });

  it("accepts only a valid owner-scoped workbook identifier for deletion", () => {
    expect(calculationWorkbookDeleteInputSchema.parse({ id: workbookId })).toEqual({ id: workbookId });
    expect(calculationWorkbookDeleteInputSchema.safeParse({ id: "not-a-workbook" }).success).toBe(false);
  });
});

describe("cash-flow restoration validation", () => {
  it("requires an owner expense ID and explicit confirmation", () => {
    expect(cashFlowTransactionRestoreInputSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      confirm: true,
    })).toEqual({ id: "00000000-0000-0000-0000-000000000001", confirm: true });
    expect(cashFlowTransactionRestoreInputSchema.safeParse({
      id: "not-a-transaction",
      confirm: true,
    }).success).toBe(false);
    expect(cashFlowTransactionRestoreInputSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000001",
      confirm: false,
    }).success).toBe(false);
  });
});

describe("recurring cash-flow series validation", () => {
  const seriesId = "00000000-0000-0000-0000-000000000001";
  const versionId = "00000000-0000-0000-0000-000000000002";
  const transactionId = "00000000-0000-0000-0000-000000000003";

  const addDays = (value: string, days: number): string => {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const adjustWeekday = (value: string, adjustment: "none" | "next_weekday" | "previous_weekday"): string => {
    if (adjustment === "none") return value;
    const day = new Date(`${value}T00:00:00Z`).getUTCDay();
    if (day === 0) return addDays(value, adjustment === "next_weekday" ? 1 : -2);
    if (day === 6) return addDays(value, adjustment === "next_weekday" ? 2 : -1);
    return value;
  };
  const referenceWeeklyOccurrence = (
    frequency: "weekly" | "biweekly",
    startsOn: string,
    weekdayAdjustment: "none" | "next_weekday" | "previous_weekday",
    target: string,
  ): boolean => {
    const intervalDays = frequency === "weekly" ? 7 : 14;
    const graceEnd = addDays(target, 2);
    for (let index = 0; index < 10_000; index += 1) {
      const normal = addDays(startsOn, index * intervalDays);
      if (adjustWeekday(normal, weekdayAdjustment) === target) return true;
      if (normal > graceEnd) return false;
    }
    return false;
  };
  it("normalizes series names and money into integer minor units", () => {
    expect(recurringSeriesCreateInputSchema.parse({
      name: "  Rent  ",
      kind: "expense",
      accountId: seriesId,
      amount: "1250.50",
      frequency: "monthly",
      startsOn: "2026-01-31",
      nextOccurrenceOn: "2026-02-28",
      endsOn: null,
      note: "  Fixed lease  ",
    })).toMatchObject({ name: "Rent", amount: 125050, frequency: "monthly", note: "Fixed lease" });
  });

  it("validates every frequency and rejects invalid term boundaries", () => {
    for (const frequency of ["weekly", "biweekly", "monthly", "quarterly", "annual"] as const) {
      expect(recurringSeriesCreateInputSchema.safeParse({
        name: "Schedule",
        kind: "income",
        accountId: null,
        amount: "1.00",
        frequency,
        startsOn: "2026-01-01",
        nextOccurrenceOn: "2026-01-01",
        endsOn: null,
        note: null,
      }).success).toBe(true);
    }
    expect(recurringSeriesCreateInputSchema.safeParse({
      name: "Schedule",
      kind: "income",
      accountId: null,
      amount: "0",
      frequency: "weekly",
      startsOn: "2026-02-01",
      nextOccurrenceOn: "2026-01-01",
      endsOn: "2026-01-31",
      note: null,
    }).success).toBe(false);
  });

  it("validates weekday-adjusted dates and first-class recurring transfer endpoints", () => {
    expect(recurringSeriesCreateInputSchema.parse({
      name: "Weekend transfer",
      kind: "transfer",
      accountId: null,
      fromAccountId: seriesId,
      toAccountId: versionId,
      amount: "20.00",
      frequency: "monthly",
      weekdayAdjustment: "previous_weekday",
      startsOn: "2026-05-31",
      nextOccurrenceOn: "2026-05-29",
      endsOn: null,
      note: null,
    })).toMatchObject({ kind: "transfer", weekdayAdjustment: "previous_weekday", fromAccountId: seriesId, toAccountId: versionId });
    expect(recurringSeriesCreateInputSchema.safeParse({
      name: "Bad transfer",
      kind: "transfer",
      accountId: null,
      fromAccountId: seriesId,
      toAccountId: seriesId,
      amount: "20.00",
      frequency: "monthly",
      weekdayAdjustment: "none",
      startsOn: "2026-05-31",
      nextOccurrenceOn: "2026-05-31",
      endsOn: null,
      note: null,
    }).success).toBe(false);
    expect(recurringSeriesCreateInputSchema.safeParse({
      name: "Misaligned",
      kind: "expense",
      accountId: seriesId,
      amount: "20.00",
      frequency: "monthly",
      weekdayAdjustment: "previous_weekday",
      startsOn: "2026-05-31",
      nextOccurrenceOn: "2026-05-31",
      endsOn: null,
      note: null,
    }).success).toBe(false);
  });
  it("matches the iterative reference for weekly and biweekly schedules", () => {
    for (const frequency of ["weekly", "biweekly"] as const) {
      for (let offset = 0; offset <= 42; offset += 1) {
        const target = addDays("2026-01-01", offset);
        const expected = referenceWeeklyOccurrence(frequency, "2026-01-01", "none", target);
        const result = recurringSeriesCreateInputSchema.safeParse({
          name: "Closed-form schedule",
          kind: "income",
          accountId: seriesId,
          amount: "1.00",
          frequency,
          weekdayAdjustment: "none",
          startsOn: "2026-01-01",
          nextOccurrenceOn: target,
          endsOn: null,
          note: null,
        });
        expect(result.success, `${frequency} ${target}`).toBe(expected);
      }
    }
  });

  it("preserves the two-day grace boundary for adjusted schedules", () => {
    const base = {
      name: "Grace-boundary schedule",
      kind: "income" as const,
      accountId: seriesId,
      amount: "1.00",
      frequency: "weekly" as const,
      weekdayAdjustment: "next_weekday" as const,
      startsOn: "2026-01-04",
      endsOn: null,
      note: null,
    };
    for (const target of ["2026-01-02", "2026-01-01"]) {
      expect(referenceWeeklyOccurrence("weekly", base.startsOn, base.weekdayAdjustment, target)).toBe(false);
      const result = recurringSeriesCreateInputSchema.safeParse({ ...base, nextOccurrenceOn: target });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual({
          code: "custom",
          path: ["nextOccurrenceOn"],
          message: "Next occurrence must match the selected recurring schedule.",
        });
      }
    }
  });

  it("clamps month ends and respects leap years", () => {
    const base = {
      name: "Month-end schedule",
      kind: "expense" as const,
      accountId: seriesId,
      amount: "1.00",
      frequency: "monthly" as const,
      weekdayAdjustment: "none" as const,
      endsOn: null,
      note: null,
    };
    expect(recurringSeriesCreateInputSchema.safeParse({ ...base, startsOn: "2024-01-31", nextOccurrenceOn: "2024-02-29" }).success).toBe(true);
    expect(recurringSeriesCreateInputSchema.safeParse({ ...base, startsOn: "2024-01-31", nextOccurrenceOn: "2024-02-28" }).success).toBe(false);
    expect(recurringSeriesCreateInputSchema.safeParse({ ...base, startsOn: "2023-01-31", nextOccurrenceOn: "2023-02-28" }).success).toBe(true);
  });


  it("requires an effective version boundary for This and future changes", () => {
    expect(recurringSeriesVersionChangeInputSchema.parse({
      seriesId,
      previousEndsOn: "2026-07-27",
      effectiveFrom: "2026-08-10",
      name: "Leaf payment",
      kind: "expense",
      accountId: seriesId,
      amount: "400.00",
      frequency: "biweekly",
      startsOn: "2026-08-10",
      nextOccurrenceOn: "2026-08-10",
      endsOn: null,
      note: null,
      versionNote: "Vehicle change",
    })).toMatchObject({ seriesId, effectiveFrom: "2026-08-10", amount: 40000 });
    expect(recurringSeriesVersionChangeInputSchema.safeParse({
      seriesId,
      previousEndsOn: "2026-08-03",
      effectiveFrom: "2026-08-10",
      name: "Invalid",
      kind: "expense",
      accountId: null,
      amount: "1.00",
      frequency: "weekly",
      startsOn: "2026-08-11",
      nextOccurrenceOn: "2026-08-11",
      endsOn: null,
      note: null,
      versionNote: null,
    }).success).toBe(false);
    expect(recurringSeriesVersionChangeInputSchema.safeParse({
      seriesId,
      previousEndsOn: "2026-08-03",
      effectiveFrom: "2026-08-10",
      name: "Invalid end",
      kind: "expense",
      accountId: null,
      amount: "1.00",
      frequency: "weekly",
      startsOn: "2026-08-01",
      nextOccurrenceOn: "2026-08-10",
      endsOn: "2026-08-09",
      note: null,
      versionNote: null,
    }).success).toBe(false);
  });

  it("requires explicit confirmation to delete one recurring version", () => {
    expect(recurringSeriesVersionDeleteInputSchema.parse({ seriesId, versionId, confirm: true })).toEqual({ seriesId, versionId, confirm: true });
    expect(recurringSeriesVersionDeleteInputSchema.safeParse({ seriesId, versionId, confirm: false }).success).toBe(false);
    expect(recurringSeriesVersionDeleteInputSchema.safeParse({ seriesId, versionId: seriesId, confirm: true }).success).toBe(true);
  });

  it("validates an in-place recurring history version edit", () => {
    expect(recurringSeriesVersionEditInputSchema.parse({
      seriesId,
      versionId,
      name: "Leaf payment",
      kind: "expense",
      accountId: seriesId,
      amount: "400.00",
      frequency: "weekly",
      weekdayAdjustment: "none",
      startsOn: "2026-08-10",
      endsOn: "2026-08-17",
      note: "Corrected amount",
      confirm: true,
    })).toMatchObject({ seriesId, versionId, amount: 40000, startsOn: "2026-08-10", endsOn: "2026-08-17", confirm: true });
    expect(recurringSeriesVersionEditInputSchema.safeParse({
      seriesId,
      versionId,
      name: "Leaf payment",
      kind: "expense",
      accountId: seriesId,
      amount: "400.00",
      frequency: "weekly",
      weekdayAdjustment: "none",
      startsOn: "2026-08-10",
      endsOn: "2026-08-17",
      note: null,
      confirm: false,
    }).success).toBe(false);
  });

  it("validates bounded full-series rename input", () => {
    expect(recurringSeriesRenameInputSchema.parse({ seriesId, name: "  Beneva renouvelée  ", confirm: true })).toEqual({ seriesId, name: "Beneva renouvelée", confirm: true });
    expect(recurringSeriesRenameInputSchema.safeParse({ seriesId, name: "   ", confirm: true }).success).toBe(false);
    expect(recurringSeriesRenameInputSchema.safeParse({ seriesId, name: "x".repeat(241), confirm: true }).success).toBe(false);
    expect(recurringSeriesRenameInputSchema.safeParse({ seriesId, name: "Valid", confirm: false }).success).toBe(false);
  });

  it("requires planned-only range overrides and explicit restore confirmation", () => {
    expect(recurringOccurrenceExceptionInputSchema.parse({
      seriesId,
      versionId,
      transactionId,
      scheduledOccurrenceOn: "2026-08-10",
      scope: "selected_range",
      endingOccurrenceOn: "2026-09-14",
      kind: "override",
      dateOverride: null,
      amountOverride: "20.00",
      accountOverrideId: null,
      statusOverride: "planned",
      note: "Temporary",
    })).toMatchObject({ amountOverride: 2000, endingOccurrenceOn: "2026-09-14" });
    expect(recurringOccurrenceExceptionInputSchema.safeParse({
      seriesId,
      versionId,
      transactionId,
      scheduledOccurrenceOn: "2026-08-10",
      scope: "selected_range",
      endingOccurrenceOn: null,
      kind: "override",
      dateOverride: null,
      amountOverride: null,
      accountOverrideId: null,
      statusOverride: null,
      note: null,
    }).success).toBe(false);
    expect(recurringOccurrenceRestoreInputSchema.parse({ seriesId, occurrenceId: transactionId, overrideGroupId: null, scope: "occurrence", confirm: true })).toMatchObject({ seriesId, occurrenceId: transactionId });
    expect(recurringOccurrenceRestoreInputSchema.safeParse({ seriesId, occurrenceId: null, overrideGroupId: null, scope: "occurrence", confirm: false }).success).toBe(false);
  });

  it("validates generation, pause/resume, and end actions", () => {
    expect(recurringSeriesGenerationInputSchema.parse({ seriesId, throughDate: "2026-12-31" })).toEqual({ seriesId, throughDate: "2026-12-31" });
    expect(recurringSeriesPauseResumeInputSchema.parse({ seriesId, state: "paused", confirm: true })).toMatchObject({ state: "paused" });
    expect(recurringSeriesEndInputSchema.parse({ seriesId, endingOccurrenceOn: "2026-12-31", confirm: true })).toMatchObject({ seriesId, endingOccurrenceOn: "2026-12-31" });
    expect(recurringSeriesDeleteInputSchema.parse({ seriesId, confirm: true })).toEqual({ seriesId, confirm: true });
    expect(recurringSeriesDeleteInputSchema.safeParse({ seriesId, confirm: false }).success).toBe(false);
  });

  it("requires group edits to remain a common non-moved override", () => {
    expect(recurringOverrideGroupUpdateInputSchema.parse({
      overrideGroupId: versionId,
      kind: "override",
      dateOverride: null,
      amountOverride: "10.00",
      accountOverrideId: null,
      statusOverride: "planned",
      note: "Winter range",
    })).toMatchObject({ amountOverride: 1000, note: "Winter range" });
    expect(recurringOverrideGroupUpdateInputSchema.safeParse({
      overrideGroupId: versionId,
      kind: "override",
      dateOverride: null,
      amountOverride: null,
      accountOverrideId: null,
      statusOverride: null,
      note: null,
    }).success).toBe(false);
  });
});

describe("recurring account contribution validation", () => {
  it("normalizes rule amounts and occurrence-date lists", () => {
    expect(accountContributionRuleInputSchema.parse({
      id: null,
      accountId: "00000000-0000-0000-0000-000000000001",
      amount: "125.50",
      frequency: "biweekly",
      startsOn: "2026-08-10",
      endsOn: null,
      isEnabled: true,
      recalculationScope: "from_rule_start",
    })).toMatchObject({ amount: 12550, frequency: "biweekly" });
    expect(accountContributionExceptionInputSchema.parse({
      ruleId: "00000000-0000-0000-0000-000000000002",
      occurrenceDates: "2026-08-10, 2026-08-24\n2026-08-10",
      kind: "skip",
      amountOverride: null,
    }).occurrenceDates).toEqual(["2026-08-10", "2026-08-24"]);
  });

  it("rejects invalid date order, zero contribution amounts, and incomplete overrides", () => {
    expect(accountContributionRuleInputSchema.safeParse({
      id: null,
      accountId: "00000000-0000-0000-0000-000000000001",
      amount: "0",
      frequency: "weekly",
      startsOn: "2026-08-10",
      endsOn: "2026-08-09",
      isEnabled: true,
      recalculationScope: "rule_only",
    }).success).toBe(false);
    expect(accountContributionExceptionInputSchema.safeParse({
      ruleId: "00000000-0000-0000-0000-000000000002",
      occurrenceDates: "2026-08-10",
      kind: "override",
      amountOverride: "",
    }).success).toBe(false);
  });
});

describe("Home and mortgage validation", () => {
  it("keeps property values and rates in integer minor units/basis points", () => {
    expect(homeValueInputSchema.parse({ asOf: "2026-08-05", marketValue: "425000.50" })).toEqual({ asOf: "2026-08-05", marketValue: 42500050 });
    expect(mortgageRateToBasisPoints("5.49")).toBe(549);
    expect(mortgageRateToBasisPoints("5.499")).toBeNull();
  });

  it("requires an explicit compounding convention and valid mortgage dates", () => {
    expect(homeMortgageTermsInputSchema.parse({
      id: null,
      effectiveOn: "2026-08-05",
      annualRate: "5.49",
      compoundingConvention: "canadian_semi_annual",
      paymentExpenseId: "00000000-0000-0000-0000-000000000001",
      nextPaymentOn: "2026-08-19",
      renewalOn: "2029-08-05",
      payoffOn: "2051-08-05",
    })).toMatchObject({ annualRate: 549, compoundingConvention: "canadian_semi_annual" });
    expect(homeMortgageTermsInputSchema.safeParse({
      id: null,
      effectiveOn: "2026-08-05",
      annualRate: "100.01",
      compoundingConvention: "canadian_semi_annual",
      paymentExpenseId: "00000000-0000-0000-0000-000000000001",
      nextPaymentOn: "2026-08-19",
      renewalOn: "2029-08-05",
      payoffOn: "2051-08-05",
    }).success).toBe(false);
    expect(homeMortgageTermsInputSchema.safeParse({
      id: null,
      effectiveOn: "2026-08-05",
      annualRate: "5.49",
      compoundingConvention: "",
      paymentExpenseId: "00000000-0000-0000-0000-000000000001",
      nextPaymentOn: "2026-08-19",
      renewalOn: "2026-08-05",
      payoffOn: "2051-08-05",
    }).success).toBe(false);
  });
});

describe("first Cash Flow income validation", () => {
  it("defaults the first income frequency to biweekly and converts the amount to minor units", () => {
    expect(cashFlowInitialIncomeInputSchema.parse({
      name: "  Paycheque  ",
      accountId: "00000000-0000-0000-0000-000000000001",
      amount: "1850.50",
      startsOn: "2026-08-19",
      throughDate: "2026-12-31",
      note: "  Main income  ",
    })).toEqual({
      name: "Paycheque",
      accountId: "00000000-0000-0000-0000-000000000001",
      amount: 185050,
      frequency: "biweekly",
      startsOn: "2026-08-19",
      throughDate: "2026-12-31",
      note: "Main income",
    });
  });

  it("rejects an income horizon before the first income", () => {
    expect(cashFlowInitialIncomeInputSchema.safeParse({
      name: "Paycheque",
      accountId: "00000000-0000-0000-0000-000000000001",
      amount: "1.00",
      startsOn: "2026-12-31",
      throughDate: "2026-08-19",
      note: null,
    }).success).toBe(false);
  });
});

describe("annual budget validation", () => {
  it("validates lifecycle create, rename, relink, and restore fields", () => {
    const budgetId = "00000000-0000-0000-0000-000000000010";
    const accountId = "00000000-0000-0000-0000-000000000011";
    const replacementAccountId = "00000000-0000-0000-0000-000000000012";

    expect(annualBudgetCreateInputSchema.parse({
      name: "  Holiday reserve  ",
      linkedAccountId: accountId,
    })).toEqual({ name: "Holiday reserve", linkedAccountId: accountId });
    expect(annualBudgetRenameInputSchema.parse({ id: budgetId, name: "  Holiday reserve  " })).toMatchObject({ name: "Holiday reserve" });
    expect(annualBudgetRelinkInputSchema.parse({ id: budgetId, linkedAccountId: replacementAccountId })).toMatchObject({ linkedAccountId: replacementAccountId });
    expect(annualBudgetUpdateInputSchema.parse({ id: budgetId, name: "Holiday reserve", linkedAccountId: replacementAccountId })).toMatchObject({ id: budgetId, linkedAccountId: replacementAccountId });
    expect(annualBudgetRestoreInputSchema.parse({ id: budgetId, linkedAccountId: null, confirm: true })).toEqual({ id: budgetId, linkedAccountId: null, confirm: true });
  });

  it("requires valid lifecycle IDs and explicit archive or restore confirmation", () => {
    expect(annualBudgetCreateInputSchema.safeParse({ name: "Reserve", linkedAccountId: "not-an-id" }).success).toBe(false);
    expect(annualBudgetRenameInputSchema.safeParse({ id: "not-an-id", name: "Reserve" }).success).toBe(false);
    expect(annualBudgetArchiveInputSchema.safeParse({ id: "00000000-0000-0000-0000-000000000010", confirm: false }).success).toBe(false);
    expect(annualBudgetRestoreInputSchema.safeParse({ id: "00000000-0000-0000-0000-000000000010", linkedAccountId: "00000000-0000-0000-0000-000000000011", confirm: false }).success).toBe(false);
  });

  it("normalizes template money and bounded date fields", () => {
    expect(annualExpenseTemplateInputSchema.parse({
      id: null,
      budgetId: "00000000-0000-0000-0000-000000000001",
      name: "  Insurance  ",
      amount: "125.50",
      dueMonth: "2",
      dueDay: "31",
      isActive: true,
    })).toMatchObject({ name: "Insurance", amount: 12550, dueMonth: 2, dueDay: 31 });
    expect(annualExpenseYearOverrideInputSchema.parse({
      annualExpenseId: "00000000-0000-0000-0000-000000000002",
      taxYear: "2027",
      budgetId: "00000000-0000-0000-0000-000000000001",
      plannedAmount: "0",
      dueDate: "2027-02-28",
      note: "  Renewal  ",
      scope: "current_year",
    })).toMatchObject({ taxYear: 2027, plannedAmount: 0, note: "Renewal" });
  });

  it("rejects unsafe money, years, dates, and zero payments", () => {
    expect(annualExpenseTemplateInputSchema.safeParse({
      id: null,
      budgetId: "00000000-0000-0000-0000-000000000001",
      name: "Insurance",
      amount: "1.001",
      dueMonth: 2,
      dueDay: 29,
      isActive: true,
    }).success).toBe(false);
    expect(annualExpenseYearOverrideInputSchema.safeParse({
      annualExpenseId: "00000000-0000-0000-0000-000000000002",
      taxYear: 2201,
      plannedAmount: null,
      dueDate: "2027-02-30",
      note: null,
      scope: "current_year",
    }).success).toBe(false);
    expect(annualExpensePaymentMutationSchema.safeParse({
      mode: "create",
      payment: {
        id: null,
        annualExpenseValueId: "00000000-0000-0000-0000-000000000003",
        paymentOn: "2027-02-01",
        amount: "0",
        note: null,
      },
      confirm: true,
    }).success).toBe(false);
  });

  it("requires explicit confirmation for movement, archive, and payment changes", () => {
    expect(annualExpenseMoveInputSchema.safeParse({
      annualExpenseId: "00000000-0000-0000-0000-000000000002",
      targetBudgetId: "00000000-0000-0000-0000-000000000001",
      confirm: false,
    }).success).toBe(false);
    expect(annualExpenseRemainderTransferInputSchema.safeParse({
      annualExpenseId: "00000000-0000-0000-0000-000000000002",
      taxYear: 2026,
      confirm: false,
    }).success).toBe(false);
    expect(annualExpenseArchiveInputSchema.safeParse({
      annualExpenseId: "00000000-0000-0000-0000-000000000002",
      archived: true,
      confirm: false,
    }).success).toBe(false);
    expect(annualExpensePaymentMutationSchema.safeParse({
      mode: "delete",
      id: "00000000-0000-0000-0000-000000000003",
      confirm: false,
    }).success).toBe(false);
    expect(annualExpensePaymentMutationSchema.parse({
      mode: "delete",
      id: "00000000-0000-0000-0000-000000000003",
      confirm: true,
    })).toMatchObject({ mode: "delete" });
  });
});

describe("salary tracking validation", () => {
  const yearId = "00000000-0000-0000-0000-000000000010";
  const snapshotId = "00000000-0000-0000-0000-000000000011";

  it("parses CAD amounts safely across Canadian decimal and grouped formats", () => {
    expect(salaryAmountToMinorUnits("65 587,10")).toBe(6_558_710);
    expect(salaryAmountToMinorUnits("65,587.10")).toBe(6_558_710);
    expect(salaryAmountToMinorUnits("65587.10")).toBe(6_558_710);
    expect(salaryAmountToMinorUnits("1.001")).toBeNull();
    expect(salaryAmountToMinorUnits("-1.00")).toBeNull();
  });

  it("normalizes year, base, pay-period, and snapshot inputs to integer minor units", () => {
    expect(salaryYearCreateInputSchema.parse({
      taxYear: "2026",
      annualBase: "82 502,00",
      payPeriodsPerYearOverride: "26",
      note: "  Current year  ",
    })).toEqual({ taxYear: 2026, annualBase: 8_250_200, payPeriodsPerYearOverride: 26, note: "Current year" });
    expect(salarySnapshotCreateInputSchema.parse({
      salaryYearId: yearId,
      snapshotOn: "2026-08-05",
      federalCumulative: "65,587.10",
      provincialCumulative: "67 153,59",
      rrqContributionYtd: "3,650.00",
      completedPayNumberOverride: "16",
      note: "Pay stub",
    })).toMatchObject({ salaryYearId: yearId, federalCumulative: 6_558_710, provincialCumulative: 6_715_359, rrqContributionYtd: 365_000, completedPayNumberOverride: 16 });
    expect(salarySnapshotUpdateInputSchema.parse({
      id: snapshotId,
      salaryYearId: yearId,
      snapshotOn: "2026-08-05",
      federalCumulative: "0",
      provincialCumulative: "0",
      rrqContributionYtd: "",
      completedPayNumberOverride: "",
      note: "",
    })).toMatchObject({ id: snapshotId, rrqContributionYtd: null, completedPayNumberOverride: null, note: null });
  });

  it("accepts blank, zero, and valid RRQ YTD while rejecting negative or unsafe values", () => {
    expect(salaryRrqContributionYtdSchema.parse("")).toBeNull();
    expect(salaryRrqContributionYtdSchema.parse(null)).toBeNull();
    expect(salaryRrqContributionYtdSchema.parse("0")).toBe(0);
    expect(salaryRrqContributionYtdSchema.parse("4,895.30")).toBe(489_530);
    expect(salaryRrqContributionYtdSchema.safeParse("-1.00").success).toBe(false);
    expect(salaryRrqContributionYtdSchema.safeParse("90071992547409.92").success).toBe(false);
  });

  it("normalizes RRQ yearly limits and enforces positive earnings thresholds", () => {
    expect(salaryRateToBasisPoints("6.30%")).toBe(630);
    expect(salaryRateToBasisPoints("4,00")).toBe(400);
    expect(salaryRateToBasisPoints("6.301")).toBeNull();
    expect(rrqYearLimitInputSchema.parse({ taxYear: "2026", firstMaximum: "4,479.30", additionalMaximum: "416.00", ympe: "74,600.00", yampe: "85,000.00", firstRate: "6.30", additionalRate: "4.00" })).toEqual({
      taxYear: 2026,
      firstMaximum: 447_930,
      additionalMaximum: 41_600,
      ympe: 7_460_000,
      yampe: 8_500_000,
      firstRate: 630,
      additionalRate: 400,
    });
    expect(rrqYearLimitInputSchema.safeParse({ taxYear: "2026", firstMaximum: "0", additionalMaximum: "0", ympe: "0", yampe: "1.00", firstRate: "6.30", additionalRate: "4.00" }).success).toBe(false);
    expect(rrqYearLimitInputSchema.safeParse({ taxYear: "2026", firstMaximum: "1.00", additionalMaximum: "1.00", ympe: "100.00", yampe: "99.99", firstRate: "6.30", additionalRate: "4.00" }).success).toBe(false);
    expect(rrqYearLimitInputSchema.safeParse({ taxYear: "2026", firstMaximum: "1.00", additionalMaximum: "1.00", ympe: "100.00", yampe: "100.00", firstRate: "0", additionalRate: "4.00" }).success).toBe(false);
  });

  it("rejects implausible years, unsafe amounts, and invalid pay counts", () => {
    expect(salaryYearCreateInputSchema.safeParse({ taxYear: "2201", annualBase: "1.00", payPeriodsPerYearOverride: "26", note: "" }).success).toBe(false);
    expect(salaryYearCreateInputSchema.safeParse({ taxYear: "2026", annualBase: "1.001", payPeriodsPerYearOverride: "26", note: "" }).success).toBe(false);
    expect(salaryYearCreateInputSchema.safeParse({ taxYear: "2026", annualBase: "1.00", payPeriodsPerYearOverride: "0", note: "" }).success).toBe(false);
    expect(salarySnapshotCreateInputSchema.safeParse({ salaryYearId: yearId, snapshotOn: "2026-08-05", federalCumulative: "1.00", provincialCumulative: "1.00", completedPayNumberOverride: "367", note: "" }).success).toBe(false);
  });

  it("normalizes an editable official federal final amount", () => {
    expect(salaryFinalizationInputSchema.parse({ salaryYearId: yearId, finalFederal: "70 500,25" })).toEqual({
      salaryYearId: yearId,
      finalFederal: 7_050_025,
    });
    expect(salaryFinalizationInputSchema.safeParse({ salaryYearId: yearId, finalFederal: "-1.00" }).success).toBe(false);
  });

  it("normalizes a directly finalized historical salary year", () => {
    expect(salaryFinalizedYearCreateInputSchema.parse({ taxYear: "2024", finalFederal: "80 099,25", note: " Official T4 " })).toEqual({
      taxYear: 2024,
      finalFederal: 8_009_925,
      note: "Official T4",
    });
    expect(salaryFinalizedYearCreateInputSchema.safeParse({ taxYear: "2024", finalFederal: "-1.00", note: "" }).success).toBe(false);
  });
});

describe("shared project validation", () => {
  const projectId = "00000000-0000-0000-0000-000000000020";

  it("trims clone fields and converts the year", () => {
    expect(sharedProjectCloneInputSchema.parse({ sourceProjectId: projectId, name: "  Summer cabin  ", year: "2026" })).toEqual({ sourceProjectId: projectId, name: "Summer cabin", year: 2026 });
    expect(sharedProjectCloneInputSchema.parse({ sourceProjectId: projectId, name: "Project", year: "1900" }).year).toBe(1900);
    expect(sharedProjectCloneInputSchema.parse({ sourceProjectId: projectId, name: "Project", year: "2200" }).year).toBe(2200);
  });

  it("rejects invalid clone IDs, names, and years", () => {
    expect(sharedProjectCloneInputSchema.safeParse({ sourceProjectId: "not-a-uuid", name: "Project", year: "2026" }).success).toBe(false);
    expect(sharedProjectCloneInputSchema.safeParse({ sourceProjectId: projectId, name: "  ", year: "2026" }).success).toBe(false);
    expect(sharedProjectCloneInputSchema.safeParse({ sourceProjectId: projectId, name: "Project", year: "1899" }).success).toBe(false);
    expect(sharedProjectCloneInputSchema.safeParse({ sourceProjectId: projectId, name: "Project", year: "2201" }).success).toBe(false);
  });

  it("trims project, expense, participant, and note fields and converts amounts", () => {
    expect(sharedProjectCreateInputSchema.parse({ name: "  Camping internet  ", year: "2026", ownerParticipates: true, note: "  Shared bill  " })).toEqual({ name: "Camping internet", year: 2026, ownerParticipates: true, note: "Shared bill" });
    expect(sharedProjectExpenseCreateInputSchema.parse({ projectId, description: "  Router  ", expenseOn: "", quantity: "", amount: "712.43", note: "" })).toEqual({ projectId, description: "Router", expenseOn: null, quantity: 1, amount: 71_243, note: null });
    expect(sharedProjectParticipantCreateInputSchema.parse({ projectId, name: "  Alex  ", paidAmount: "0.50" })).toEqual({ projectId, name: "Alex", paidAmount: 50 });
  });

  it("rejects invalid years, missing names, non-positive expenses, and negative payments", () => {
    expect(sharedProjectCreateInputSchema.safeParse({ name: "Project", year: "2201", ownerParticipates: false, note: "" }).success).toBe(false);
    expect(sharedProjectCreateInputSchema.safeParse({ name: "  ", year: "2026", ownerParticipates: false, note: "" }).success).toBe(false);
    expect(sharedProjectExpenseCreateInputSchema.safeParse({ projectId, description: "Expense", expenseOn: null, quantity: "0", amount: "0", note: "" }).success).toBe(false);
    expect(sharedProjectParticipantCreateInputSchema.safeParse({ projectId, name: "Alex", paidAmount: "-1.00" }).success).toBe(false);
  });

  it("defaults blank quantities and rejects malformed, fractional, and unsafe quantities", () => {
    expect(sharedProjectExpenseCreateInputSchema.parse({ projectId, description: "Expense", expenseOn: null, quantity: "", amount: "10.00", note: "" }).quantity).toBe(1);
    expect(sharedProjectExpenseCreateInputSchema.parse({ projectId, description: "Expense", expenseOn: null, quantity: undefined, amount: "10.00", note: "" }).quantity).toBe(1);
    for (const quantity of ["0", "-1", "1.5", "1e2", "not-a-number", Number.MAX_SAFE_INTEGER + 1]) {
      expect(sharedProjectExpenseCreateInputSchema.safeParse({ projectId, description: "Expense", expenseOn: null, quantity, amount: "10.00", note: "" }).success).toBe(false);
    }
    expect(sharedProjectExpenseCreateInputSchema.parse({ projectId, description: "Expense", expenseOn: null, quantity: "8", amount: "10.00", note: "" }).quantity).toBe(8);
  });

  it("requires explicit archive or restore confirmation", () => {
    expect(sharedProjectArchiveInputSchema.safeParse({ projectId, archived: true, confirm: false }).success).toBe(false);
    expect(sharedProjectArchiveInputSchema.parse({ projectId, archived: false, confirm: true })).toMatchObject({ archived: false, confirm: true });
    expect(sharedProjectExpenseDeleteInputSchema.safeParse({ projectId, id: projectId, confirm: false }).success).toBe(false);
    expect(sharedProjectParticipantDeleteInputSchema.safeParse({ projectId, id: projectId, confirm: false }).success).toBe(false);
  });
});

describe("REEI / RDSP holdings validation", () => {
  const accountId = "00000000-0000-0000-0000-000000000020";
  const holdingId = "00000000-0000-0000-0000-000000000021";
  const transactionId = "00000000-0000-0000-0000-000000000022";

  it("accepts both holding types and CAD/USD with fixed-point values", () => {
    expect(investmentHoldingCreateInputSchema.parse({ accountId, instrumentType: "mutual_fund", symbol: "  RBF123  ", name: "  Balanced fund  ", currency: "CAD" })).toEqual({
      accountId,
      instrumentType: "mutual_fund",
      symbol: "RBF123",
      name: "Balanced fund",
      currency: "CAD",
    });
    expect(investmentHoldingCreateInputSchema.parse({ accountId, instrumentType: "etf", symbol: "VTI", name: "Vanguard Total Stock Market", currency: "USD" }).currency).toBe("USD");
    expect(investmentUnitsToMicros("1.250001")).toBe(1_250_001);
    expect(investmentFxRateToPpm("1.350000")).toBe(1_350_000);
  });

  it("accepts a zero-cost opening transaction and normalizes an empty fee", () => {
    expect(investmentHoldingTransactionCreateInputSchema.parse({
      holdingId,
      occurredOn: "2026-09-08",
      kind: "opening",
      units: "12.5",
      amount: "0",
      fee: "",
      note: "  Existing position  ",
    })).toEqual({ holdingId, occurredOn: "2026-09-08", kind: "opening", units: 12_500_000, amount: 0, fee: 0, note: "Existing position" });
  });

  it("enforces transaction shapes and supports manual quote/FX/delete inputs", () => {
    expect(investmentHoldingTransactionCreateInputSchema.safeParse({ holdingId, occurredOn: "2026-09-08", kind: "distribution", units: "1", amount: "5", fee: "0", note: null }).success).toBe(false);
    expect(investmentHoldingTransactionCreateInputSchema.safeParse({ holdingId, occurredOn: "2026-09-08", kind: "fee", units: "0", amount: "0", fee: "0", note: null }).success).toBe(false);
    expect(investmentHoldingPriceInputSchema.parse({ holdingId, effectiveOn: "2026-09-08", price: "125.50" })).toMatchObject({ price: 12_550 });
    expect(investmentFxRateInputSchema.parse({ effectiveOn: "2026-09-08", rate: "1.35" })).toMatchObject({ rate: 1_350_000 });
    expect(investmentHoldingMarketRefreshInputSchema.parse({ holdingId, valuationOn: "2026-09-08" })).toEqual({ holdingId, valuationOn: "2026-09-08" });
    expect(investmentHoldingTransactionDeleteInputSchema.parse({ holdingId, transactionId, confirm: true })).toEqual({ holdingId, transactionId, confirm: true });
    expect(investmentHoldingTransactionDeleteInputSchema.safeParse({ holdingId, transactionId, confirm: false }).success).toBe(false);
    expect(investmentHoldingDeleteInputSchema.parse({ holdingId, confirm: true })).toEqual({ holdingId, confirm: true });
    expect(investmentHoldingDeleteInputSchema.safeParse({ holdingId, confirm: false }).success).toBe(false);
  });

  it("rejects unsupported precision, zero FX rates, and invalid symbols", () => {
    expect(investmentUnitsToMicros("1.0000001")).toBeNull();
    expect(investmentFxRateToPpm("0")).toBeNull();
    expect(investmentHoldingCreateInputSchema.safeParse({ accountId, instrumentType: "mutual_fund", symbol: "VFV/TO", name: "Fund", currency: "CAD" }).success).toBe(false);
  });
});

describe("investment projection project validation", () => {
  const projectId = "00000000-0000-0000-0000-000000000020";
  const accountA = "00000000-0000-0000-0000-000000000021";
  const accountB = "00000000-0000-0000-0000-000000000022";

  it("trims project metadata and accepts fixed-point annual return rates", () => {
    expect(investmentProjectionProjectCreateInputSchema.parse({
      name: "  Primerica + Wealthsimple  ",
      notes: "  Retirement comparison  ",
      horizonYears: "30",
      investmentAccountIds: [accountA, accountB],
      ratesBps: [500, 400, 300, 200],
    })).toEqual({
      name: "Primerica + Wealthsimple",
      notes: "Retirement comparison",
      horizonYears: 30,
      investmentAccountIds: [accountA, accountB],
      ratesBps: [500, 400, 300, 200],
    });
  });

  it("rejects duplicate accounts or rates and invalid horizons", () => {
    expect(investmentProjectionProjectCreateInputSchema.safeParse({ name: "Project", notes: "", horizonYears: "0", investmentAccountIds: [accountA], ratesBps: [500] }).success).toBe(false);
    expect(investmentProjectionProjectCreateInputSchema.safeParse({ name: "Project", notes: "", horizonYears: "30", investmentAccountIds: [accountA, accountA], ratesBps: [500] }).success).toBe(false);
    expect(investmentProjectionProjectCreateInputSchema.safeParse({ name: "Project", notes: "", horizonYears: "30", investmentAccountIds: [accountA], ratesBps: [500, 500] }).success).toBe(false);
    expect(investmentProjectionProjectCreateInputSchema.safeParse({ name: "Project", notes: "", horizonYears: "36", investmentAccountIds: [accountA], ratesBps: [10_001] }).success).toBe(false);
  });

  it("requires an id for updates and explicit confirmation for deletion", () => {
    expect(investmentProjectionProjectUpdateInputSchema.parse({ id: projectId, name: "Project", notes: null, horizonYears: 1, investmentAccountIds: [accountA], ratesBps: [0] }).id).toBe(projectId);
    expect(investmentProjectionProjectUpdateInputSchema.safeParse({ name: "Project", notes: null, horizonYears: 1, investmentAccountIds: [accountA], ratesBps: [0] }).success).toBe(false);
    expect(investmentProjectionProjectDeleteInputSchema.safeParse({ id: projectId, confirm: false }).success).toBe(false);
    expect(investmentProjectionProjectDeleteInputSchema.parse({ id: projectId, confirm: true })).toEqual({ id: projectId, confirm: true });
  });

  it("validates calculator projects with integer minor units and fixed-point rates", () => {
    expect(investmentProjectionCalculatorProjectInputSchema.parse({
      mode: "calculator",
      name: "  Retirement calculator  ",
      notes: "  Manual starting point  ",
      manualStartingAmountMinor: 5_100_00,
      horizonYears: "30",
      ratesBps: [500, 400, 300, 200],
    })).toEqual({
      mode: "calculator",
      name: "Retirement calculator",
      notes: "Manual starting point",
      manualStartingAmountMinor: 510000,
      horizonYears: 30,
      ratesBps: [500, 400, 300, 200],
    });
    expect(investmentProjectionCalculatorProjectInputSchema.parse({
      mode: "calculator",
      name: "Empty calculator",
      horizonYears: 1,
      ratesBps: [0],
    }).manualStartingAmountMinor).toBe(0);
  });

  it("validates portfolio schedules and annual overrides independently per account", () => {
    expect(investmentProjectionPortfolioProjectInputSchema.parse({
      mode: "portfolio",
      name: "  Household investments  ",
      notes: "",
      horizonYears: 35,
      ratesBps: [500, 400],
      accountSchedules: [
        {
          investmentAccountId: accountA,
          displayOrder: "0",
          frequency: "monthly",
          baseContributionMinor: 23_000,
          annualIncreaseBps: 1_000,
          annualOverrides: [{ year: "2027", amountMinor: 25_300 }],
        },
        {
          investmentAccountId: accountB,
          displayOrder: 1,
          frequency: "biweekly",
          baseContributionMinor: 15_000,
          annualIncreaseBps: 0,
          annualOverrides: [],
        },
      ],
    })).toEqual({
      mode: "portfolio",
      name: "Household investments",
      notes: null,
      horizonYears: 35,
      ratesBps: [500, 400],
      accountSchedules: [
        {
          investmentAccountId: accountA,
          displayOrder: 0,
          frequency: "monthly",
          baseContributionMinor: 23000,
          annualIncreaseBps: 1000,
          annualIncreaseMode: "percentage",
          annualIncreaseMinor: 0,
          contributionSource: "cash_flow",
          annualOverrides: [{ year: 2027, amountMinor: 25300 }],
        },
        {
          investmentAccountId: accountB,
          displayOrder: 1,
          frequency: "biweekly",
          baseContributionMinor: 15000,
          annualIncreaseBps: 0,
          annualIncreaseMode: "percentage",
          annualIncreaseMinor: 0,
          contributionSource: "cash_flow",
          annualOverrides: [],
        },
      ],
    });
  });

  it("supports a fixed annual contribution amount without mixing percentage mode", () => {
    const parsed = investmentProjectionPortfolioProjectInputSchema.parse({
      mode: "portfolio",
      name: "Fixed step-up",
      horizonYears: 30,
      ratesBps: [500],
      accountSchedules: [{
        investmentAccountId: accountA,
        frequency: "monthly",
        baseContributionMinor: 23_000,
        annualIncreaseBps: 0,
        annualIncreaseMode: "fixed_amount",
        annualIncreaseMinor: 3_000,
        annualOverrides: [],
      }],
    });
    expect(parsed.accountSchedules[0]).toMatchObject({ annualIncreaseMode: "fixed_amount", annualIncreaseBps: 0, annualIncreaseMinor: 3_000 });
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse({
      mode: "portfolio",
      name: "Invalid mixed mode",
      horizonYears: 1,
      ratesBps: [0],
      accountSchedules: [{
        investmentAccountId: accountA,
        frequency: "monthly",
        baseContributionMinor: 1,
        annualIncreaseBps: 100,
        annualIncreaseMode: "fixed_amount",
        annualIncreaseMinor: 100,
        annualOverrides: [],
      }],
    }).success).toBe(false);
  });

  it("rejects invalid mode-specific amounts, frequencies, rates, years, and duplicate ownership-shaped IDs", () => {
    const validSchedule = {
      investmentAccountId: accountA,
      frequency: "monthly",
      baseContributionMinor: 100,
      annualIncreaseBps: 0,
      annualOverrides: [],
    };
    const portfolio = (overrides: Record<string, unknown> = {}) => ({
      mode: "portfolio",
      name: "Project",
      notes: null,
      horizonYears: 30,
      ratesBps: [500],
      accountSchedules: [validSchedule],
      ...overrides,
    });

    expect(investmentProjectionCalculatorProjectInputSchema.safeParse({ mode: "calculator", name: "Project", horizonYears: 30, ratesBps: [500], manualStartingAmountMinor: -1 }).success).toBe(false);
    expect(investmentProjectionCalculatorProjectInputSchema.safeParse({ mode: "calculator", name: "Project", horizonYears: 30, ratesBps: [500.5], manualStartingAmountMinor: 0 }).success).toBe(false);
    expect(investmentProjectionCalculatorProjectInputSchema.safeParse({ mode: "calculator", name: "Project", horizonYears: 30, ratesBps: [Number.MAX_SAFE_INTEGER], manualStartingAmountMinor: 0 }).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule, frequency: "weekly" }] })).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule, baseContributionMinor: 1.5 }] })).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule, annualIncreaseBps: -1 }] })).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule, annualOverrides: [{ year: 2027, amountMinor: 1 }, { year: "2027", amountMinor: 2 }] }] })).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule, annualOverrides: [{ year: 1800, amountMinor: 1 }] }] })).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule, annualOverrides: [{ year: Number.MAX_SAFE_INTEGER, amountMinor: 1 }] }] })).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule }, { ...validSchedule }] })).success).toBe(false);
    expect(investmentProjectionPortfolioProjectInputSchema.safeParse(portfolio({ accountSchedules: [{ ...validSchedule, investmentAccountId: "not-a-uuid" }] })).success).toBe(false);
    expect(investmentProjectionCalculatorProjectInputSchema.safeParse({ mode: "calculator", name: "Project", horizonYears: 30, ratesBps: [500], manualStartingAmountMinor: 0, accountSchedules: [] }).success).toBe(false);
  });

  it("keeps the legacy account/rate-only project contract valid during migration", () => {
    expect(investmentProjectionProjectCreateInputSchema.parse({
      name: "Legacy project",
      notes: null,
      horizonYears: 1,
      investmentAccountIds: [accountA],
      ratesBps: [500],
    })).toMatchObject({ investmentAccountIds: [accountA], ratesBps: [500] });
    expect(investmentProjectionProjectUpdateInputSchema.parse({
      id: projectId,
      mode: "calculator",
      name: "Calculator project",
      notes: null,
      manualStartingAmountMinor: 0,
      horizonYears: 1,
      ratesBps: [500],
    })).toMatchObject({ id: projectId, mode: "calculator" });
  });
});

describe("goal plan validation", () => {
  const goalId = "11111111-1111-1111-1111-111111111111";
  const accountId = "22222222-2222-2222-2222-222222222222";
  const sourceAccountId = "33333333-3333-3333-3333-333333333333";

  it("accepts weekly, biweekly, and monthly save inputs", () => {
    for (const frequency of ["weekly", "biweekly", "monthly"] as const) {
      const result = goalPlanSaveInputSchema.safeParse({ goalId, accountId, sourceAccountId, amount: "123.45", frequency });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ goalId, accountId, sourceAccountId, amount: 12345, frequency, countsAsExpense: false });
    }
  });

  it("accepts an optional valid start date and rejects malformed dates", () => {
    const withStart = goalPlanSaveInputSchema.safeParse({
      goalId,
      accountId,
      sourceAccountId,
      amount: "123.45",
      frequency: "biweekly",
      startsOn: "2026-09-17",
    });
    expect(withStart.success).toBe(true);
    if (withStart.success) expect(withStart.data.startsOn).toBe("2026-09-17");
    expect(goalPlanSaveInputSchema.safeParse({
      goalId,
      accountId,
      sourceAccountId,
      amount: "123.45",
      frequency: "biweekly",
      startsOn: "2026-02-30",
    }).success).toBe(false);
  });

  it("rejects daily and annual frequencies", () => {
    expect(goalPlanFrequencySchema.safeParse("daily").success).toBe(false);
    expect(goalPlanFrequencySchema.safeParse("annual").success).toBe(false);
    expect(goalPlanSaveInputSchema.safeParse({ goalId, accountId, sourceAccountId, amount: "100.00", frequency: "daily" }).success).toBe(false);
    expect(goalPlanSaveInputSchema.safeParse({ goalId, accountId, sourceAccountId, amount: "100.00", frequency: "annual" }).success).toBe(false);
  });

  it("rejects invalid goal, account, and plan IDs", () => {
    expect(goalPlanSourceAccountSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(goalPlanSaveInputSchema.safeParse({ goalId: "not-a-uuid", accountId, sourceAccountId, amount: "100.00", frequency: "weekly" }).success).toBe(false);
    expect(goalPlanSaveInputSchema.safeParse({ goalId, accountId: "not-a-uuid", sourceAccountId, amount: "100.00", frequency: "weekly" }).success).toBe(false);
    expect(goalPlanSaveInputSchema.safeParse({ goalId, accountId, sourceAccountId: "not-a-uuid", amount: "100.00", frequency: "weekly" }).success).toBe(false);
    expect(goalPlanIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects missing source account and source equal to destination", () => {
    expect(goalPlanSaveInputSchema.safeParse({ goalId, accountId, amount: "100.00", frequency: "weekly" }).success).toBe(false);
    const sameAccount = goalPlanSaveInputSchema.safeParse({ goalId, accountId, sourceAccountId: accountId, amount: "100.00", frequency: "weekly" });
    expect(sameAccount.success).toBe(false);
    if (!sameAccount.success) {
      const issue = sameAccount.error.issues.find((entry) => entry.path[0] === "sourceAccountId");
      expect(issue?.message).toBe("Source and destination accounts must be different.");
    }
  });

  it("rejects zero, negative, unsafe, and malformed contribution amounts", () => {
    expect(goalPlanAmountSchema.safeParse("0.00").success).toBe(false);
    expect(goalPlanAmountSchema.safeParse("-10.00").success).toBe(false);
    expect(goalPlanAmountSchema.safeParse("99999999999999.99").success).toBe(false);
    expect(goalPlanAmountSchema.safeParse("abc").success).toBe(false);
    expect(goalPlanSaveInputSchema.safeParse({ goalId, accountId, sourceAccountId, amount: "0.00", frequency: "weekly" }).success).toBe(false);
  });

  it("coerces countsAsExpense from form values and defaults to false", () => {
    expect(goalPlanCountsAsExpenseSchema.parse("true")).toBe(true);
    expect(goalPlanCountsAsExpenseSchema.parse("on")).toBe(true);
    expect(goalPlanCountsAsExpenseSchema.parse("1")).toBe(true);
    expect(goalPlanCountsAsExpenseSchema.parse(true)).toBe(true);
    expect(goalPlanCountsAsExpenseSchema.parse("false")).toBe(false);
    expect(goalPlanCountsAsExpenseSchema.parse(undefined)).toBe(false);
    expect(goalPlanCountsAsExpenseSchema.safeParse("yes").success).toBe(false);
    const result = goalPlanSaveInputSchema.safeParse({ goalId, accountId, sourceAccountId, amount: "100.00", frequency: "weekly", countsAsExpense: "on" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countsAsExpense).toBe(true);
  });

  it("accepts and coerces boolean enabled values", () => {
    expect(goalPlanEnabledInputSchema.parse({ goalId, enabled: "true" })).toEqual({ goalId, enabled: true });
    expect(goalPlanEnabledInputSchema.parse({ goalId, enabled: "false" })).toEqual({ goalId, enabled: false });
    expect(goalPlanEnabledInputSchema.parse({ goalId, enabled: true })).toEqual({ goalId, enabled: true });
    expect(goalPlanEnabledInputSchema.parse({ goalId, enabled: false })).toEqual({ goalId, enabled: false });
    expect(goalPlanEnabledInputSchema.safeParse({ goalId, enabled: "yes" }).success).toBe(false);
    expect(goalPlanEnabledInputSchema.safeParse({ goalId }).success).toBe(false);
  });

  it("accepts achieved input with optional stopContributions", () => {
    expect(goalAchievedInputSchema.parse({ id: goalId })).toEqual({ id: goalId, stopContributions: false });
    expect(goalAchievedInputSchema.parse({ id: goalId, stopContributions: "true" })).toEqual({ id: goalId, stopContributions: true });
    expect(goalAchievedInputSchema.parse({ id: goalId, stopContributions: "false" })).toEqual({ id: goalId, stopContributions: false });
    expect(goalAchievedInputSchema.safeParse({ id: goalId, stopContributions: "yes" }).success).toBe(false);
    expect(goalAchievedInputSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});
