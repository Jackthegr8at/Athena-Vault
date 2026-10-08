export type MinorUnits = number & { readonly __brand: "MinorUnits" };
export type CurrencyCode = "CAD" | "USD" | "EUR";

export const money = (value: number): MinorUnits => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Money must be a safe integer minor-unit amount.");
  }
  return value as MinorUnits;
};

export type CashFlowKind = "income" | "expense" | "transfer";

export interface CashFlowItem {
  id: string;
  recordId?: string;
  label: string;
  account: string;
  accountId?: string;
  recurringTransactionId?: string;
  amount: MinorUnits;
  kind: CashFlowKind;
  date?: string;
  direction?: "in" | "out";
  fromAccountId?: string;
  toAccountId?: string;
  planned: boolean;
  category?: string;
}

export interface PayPeriod {
  id: string;
  label: string;
  payDate: string;
  openingBalance: MinorUnits;
  items: CashFlowItem[];
}

export interface CashFlowProjection {
  openingBalance: MinorUnits;
  income: MinorUnits;
  expenses: MinorUnits;
  transfers: MinorUnits;
  transferIn: MinorUnits;
  transferOut: MinorUnits;
  endingBalance: MinorUnits;
  availableBeforeNextPay: MinorUnits;
  variance: MinorUnits;
  warnings: string[];
}

export interface AnnualExpense {
  id: string;
  label: string;
  account: string;
  amount: MinorUnits;
  dueDate: string;
  funded: MinorUnits;
  envelope?: string;
}

export interface InvestmentProjectionInput {
  initialValue: MinorUnits;
  monthlyContribution: MinorUnits;
  /**
   * Investment growth uses nominal-rate ÷ periods-per-year compounding, unlike
   * the mortgage effective-rate convention in `mortgage.ts`.
   */
  annualRateBps: number;
  years: number;
  compoundingPeriodsPerYear: number;
}

export interface InvestmentProjectionPoint {
  year: number;
  balance: MinorUnits;
  contributions: MinorUnits;
  growth: MinorUnits;
}

export interface ScheduledInvestmentProjectionInput {
  initialValue: MinorUnits;
  monthlyContributions: readonly MinorUnits[];
  annualRateBps: number;
  years: number;
}

/** The supported contribution cadence for a live investment schedule. */
export type InvestmentContributionFrequency = "monthly" | "biweekly";

/** How a recurring contribution base changes at the start of each calendar year. */
export type InvestmentAnnualIncreaseMode = "percentage" | "fixed_amount";

/** A fixed contribution amount for one calendar year. */
export interface InvestmentAnnualContributionOverride {
  /** Calendar year, for example 2027. */
  year: number;
  amountMinor: MinorUnits;
}

/** Inputs for one account's recurring contribution schedule. */
export interface InvestmentContributionScheduleInput {
  frequency: InvestmentContributionFrequency;
  baseContributionMinor: MinorUnits;
  annualIncreaseBps: number;
  /** Defaults to percentage for backwards-compatible callers. */
  annualIncreaseMode?: InvestmentAnnualIncreaseMode;
  /** Fixed minor-unit amount added once per later calendar year. */
  annualIncreaseMinor?: MinorUnits;
  annualOverrides?: readonly InvestmentAnnualContributionOverride[];
  /** Alias accepted by callers that use the shorter name. */
  overrides?: readonly InvestmentAnnualContributionOverride[];
  /** The first date on which this schedule can contribute. */
  startDate?: string;
  /** Alias used by the persistence layer for a schedule start date. */
  startsOn?: string;
}

/** One dated contribution supplied by an external recurring Cash Flow source. */
export interface InvestmentContributionEvent {
  /** ISO calendar date on which the contribution is expected. */
  on: string;
  amountMinor: MinorUnits;
}

/** One calendar-year contribution summary derived from a portfolio schedule. */
export interface InvestmentAnnualContributionSummary {
  readonly calendarYear: number;
  readonly biweeklyAmountMinor: MinorUnits | null;
  readonly monthlyAmountMinor: MinorUnits | null;
  readonly annualContributionMinor: MinorUnits;
  readonly eventCount: number;
}

/** One account schedule and its optional dated Cash Flow contribution events. */
export interface InvestmentAnnualContributionAccountInput {
  readonly accountId: string;
  readonly schedule: InvestmentContributionScheduleInput;
  readonly contributionEvents?: readonly InvestmentContributionEvent[];
}

/** Inputs for deriving calendar-year contribution summaries. */
export interface InvestmentAnnualContributionSummaryInput {
  readonly baselineDate: string;
  readonly years: number;
  readonly accounts: readonly InvestmentAnnualContributionAccountInput[];
}

/** A live investment account included in a portfolio projection. */
export interface InvestmentPortfolioAccountInput {
  accountId: string;
  initialValue: MinorUnits;
  schedule: InvestmentContributionScheduleInput;
  /** When present, these dated events replace the schedule's periodic cadence. */
  contributionEvents?: readonly InvestmentContributionEvent[];
}

/** Manual, contribution-free calculator inputs. */
export interface InvestmentCalculatorInput {
  initialValue: MinorUnits;
  annualRateBps: number;
  years: number;
  compoundingPeriodsPerYear?: number;
}

/** A portfolio scenario is projected at one annual return rate. */
export interface InvestmentPortfolioInput {
  baselineDate: string;
  years: number;
  annualRateBps: number;
  accounts: readonly InvestmentPortfolioAccountInput[];
}

/** The projection for one account at a year boundary. */
export interface InvestmentAccountProjectionPoint extends InvestmentProjectionPoint {
  accountId: string;
}

/** An aggregate portfolio point plus the independent account points. */
export interface InvestmentPortfolioProjectionPoint extends InvestmentProjectionPoint {
  accounts: readonly InvestmentAccountProjectionPoint[];
}

export type InvestmentProjectionValidationCode =
  | "invalid-horizon"
  | "invalid-rate"
  | "invalid-frequency"
  | "invalid-date"
  | "invalid-amount"
  | "invalid-schedule"
  | "duplicate-override-year"
  | "overflow";

/** A stable, inspectable error for new calculator/portfolio inputs. */
export class InvestmentProjectionValidationError extends RangeError {
  readonly code: InvestmentProjectionValidationCode;

  constructor(code: InvestmentProjectionValidationCode, message: string) {
    super(message);
    this.name = "InvestmentProjectionValidationError";
    this.code = code;
  }
}
