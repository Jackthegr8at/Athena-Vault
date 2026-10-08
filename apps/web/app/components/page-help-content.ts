import { PASSWORD_POLICY_ERROR } from "../../lib/password-policy";

export type PageHelpPageId = "overview" | "cash-flow" | "accounts" | "home" | "salaries" | "projects" | "project-workspace" | "investments" | "settings" | "annual-expenses" | "recurring-payments";

export type PageHelpLabelMap = Readonly<Record<string, string>>;

export interface PageHelpContent {
  readonly pageId: PageHelpPageId;
  readonly triggerLabel: string;
  readonly title: string;
  readonly introduction: string;
  readonly steps: readonly string[];
  readonly snapshotLabels: PageHelpLabelMap;
  readonly actionLabels: PageHelpLabelMap;
}

export interface PageHelpSnapshotItem {
  readonly label: string;
  readonly value: string;
}

export interface PageHelpAction {
  readonly label: string;
  readonly href: string;
}

export interface PageHelpSnapshot {
  readonly items: readonly PageHelpSnapshotItem[];
  readonly action: PageHelpAction;
}

export interface PageHelp {
  readonly content: PageHelpContent;
  readonly snapshot: PageHelpSnapshot;
}

export type CashFlowPageHelpActionId = "account" | "timeline" | "balance" | "recurring" | "projection";

export type AccountsPageHelpActionId = "account" | "timeline" | "balance" | "availableCash" | "timelineReview";

export type HomePageHelpActionId = "home" | "property" | "expense" | "cashFlow" | "review";

export type OverviewPageHelpActionId = "account" | "timeline" | "balance" | "recurring" | "projection";

export type SalariesPageHelpActionId = "create" | "finalized" | "snapshot" | "review";

export type ProjectsPageHelpActionId = "create" | "participants" | "expense" | "payments" | "review";

export type ProjectWorkspacePageHelpActionId = "participants" | "expense" | "payments" | "review";

export type InvestmentsPageHelpActionId = "create" | "accounts" | "schedules" | "review";

export type SettingsPageHelpActionId = "password" | "sessions" | "review";

export type AnnualExpensesPageHelpActionId = "account" | "budget" | "expense" | "payment" | "forecast" | "review";

export type RecurringPaymentsPageHelpActionId = "account" | "income" | "exceptions" | "review";

export const OVERVIEW_PAGE_HELP_CONTENT = {
  pageId: "overview",
  triggerLabel: "Open Overview help",
  title: "Overview guide",
  introduction: "Overview brings your current financial picture together and points you to the next useful setup step.",
  steps: [
    "Create your main account.",
    "Set up the Cash Flow pay-period rhythm.",
    "Record the current balance.",
    "Add recurring income or expenses.",
    "Review the current projection; Home, goals, investments, annual expenses, and projects are optional next areas.",
  ],
  snapshotLabels: {
    activeAccounts: "Active accounts",
    payPeriods: "Pay periods",
    currentBalance: "Current balance",
    recurringMovement: "Recurring movement",
    homeProfile: "Home profile",
  },
  actionLabels: {
    account: "Create main account",
    timeline: "Set up Cash Flow rhythm",
    balance: "Record current balance",
    recurring: "Add recurring income or expense",
    projection: "Review current projection",
  },
} as const satisfies PageHelpContent;

export const CASH_FLOW_PAGE_HELP_CONTENT = {
  pageId: "cash-flow",
  triggerLabel: "Open Cash Flow help",
  title: "Cash Flow guide",
  introduction: "Cash Flow connects your account balances and scheduled movements to each pay period.",
  steps: [
    "Add your main account.",
    "Set up your pay-period rhythm.",
    "Record the current balance.",
    "Add recurring income or expenses.",
    "Review and adjust the projection.",
  ],
  snapshotLabels: {
    activeAccounts: "Active accounts",
    payPeriods: "Pay periods",
    currentBalance: "Current balance",
    recurringMovements: "Recurring movements",
  },
  actionLabels: {
    account: "Create main account",
    timeline: "Set up Cash Flow rhythm",
    balance: "Record current balance",
    recurring: "Add recurring income or expense",
    projection: "Review current projection",
  },
} as const satisfies PageHelpContent;

export const ACCOUNTS_PAGE_HELP_CONTENT = {
  pageId: "accounts",
  triggerLabel: "Open Accounts help",
  title: "Accounts guide",
  introduction: "Accounts are the foundation for your balance timeline. Start with the account where your regular money arrives, record its current balance, then connect it to Cash Flow.",
  steps: [
    "Create your main account. The first account is included in available cash and the Cash Flow planned timeline automatically.",
    "Set up your Cash Flow pay-period rhythm.",
    "Record the current balance for each account.",
    "Keep Available cash on for accounts that should fund everyday projections.",
    "Use the Planned timeline switch when Cash Flow should drive an account’s projected balances.",
  ],
  snapshotLabels: {
    activeAccounts: "Active accounts",
    payPeriods: "Pay periods",
    currentBalance: "Current balance",
    availableCashAccounts: "Available cash accounts",
  },
  actionLabels: {
    account: "Create main account",
    timeline: "Set up Cash Flow rhythm",
    balance: "Record current balance",
    availableCash: "Configure available cash",
    timelineReview: "Review balance timeline",
  },
} as const satisfies PageHelpContent;

export const HOME_PAGE_HELP_CONTENT = {
  pageId: "home",
  triggerLabel: "Open Home help",
  title: "Home guide",
  introduction: "Home brings your property, mortgage, household costs, and maintenance reserves into one owner-scoped view.",
  steps: [
    "Create your Home profile.",
    "Add a current property value.",
    "Optionally add mortgage terms and a confirmed balance.",
    "Add recurring household costs and annual maintenance reserves.",
    "Link household totals to Cash Flow when you want them in projections.",
  ],
  snapshotLabels: {
    homeProfile: "Home profile",
    propertyValue: "Property value",
    activeExpenses: "Active household expenses",
    maintenanceItems: "Annual-maintenance items",
    cashFlowLink: "Cash Flow link",
  },
  actionLabels: {
    home: "Create Home profile",
    property: "Add property value",
    expense: "Add household expense",
    cashFlow: "Connect household Cash Flow",
    review: "Review Home timeline",
  },
} as const satisfies PageHelpContent;

export const SALARIES_PAGE_HELP_CONTENT = {
  pageId: "salaries",
  triggerLabel: "Open Salaries help",
  title: "Salaries guide",
  introduction: "Salaries keeps a private gross-income record by tax year so pay-stub observations, year-end projections, RRQ tracking, and finalized totals stay together.",
  steps: [
    "Select the tax year you want to track.",
    "Create the year record with its annual base and payday rhythm when applicable.",
    "Add cumulative gross values from each pay stub as they arrive.",
    "Use the federal, provincial, and RRQ projections to spot missing or changing information.",
    "Finalize the official federal total when the year is complete; finalized history can be reopened for corrections.",
  ],
  snapshotLabels: {
    salaryYears: "Salary years",
    selectedYear: "Selected tax year",
    ledgerStatus: "Ledger status",
    payStubSnapshots: "Pay-stub snapshots",
    officialFederalTotal: "Official federal total",
    rrqTracker: "RRQ tracker",
  },
  actionLabels: {
    create: "Create salary year",
    finalized: "Add finalized income",
    snapshot: "Add salary snapshot",
    review: "Review salary ledger",
  },
} as const satisfies PageHelpContent;

export const PROJECTS_PAGE_HELP_CONTENT = {
  pageId: "projects",
  triggerLabel: "Open Projects help",
  title: "Projects guide",
  introduction: "Projects keeps shared expenses and participant payments in a focused equal-split workspace. It is separate from Accounts, Cash Flow, and Annual Expenses.",
  steps: [
    "Create a project with its year and whether you participate in the split.",
    "Add the people sharing the project and record each expense with its date, quantity, and amount.",
    "Review the calculated share for each participant and the project’s collection status.",
    "Record payments as they arrive so outstanding balances stay clear.",
    "Archive completed projects when you want to keep their history without showing them in the active list.",
  ],
  snapshotLabels: {
    activeProjects: "Active projects",
    archivedProjects: "Archived projects",
    projectsWithExpenses: "Projects with expenses",
    participants: "Participants",
    projectsNeedingPayment: "Projects needing payment",
  },
  actionLabels: {
    create: "Create first project",
    participants: "Add project participants",
    expense: "Record first expense",
    payments: "Review project payments",
    review: "Open project workspace",
  },
} as const satisfies PageHelpContent;

export const PROJECT_WORKSPACE_PAGE_HELP_CONTENT = {
  pageId: "project-workspace",
  triggerLabel: "Open Project workspace help",
  title: "Project workspace guide",
  introduction: "A project workspace keeps one shared expense split together: project details, participant shares, expenses, and payments remain visible in one owner-scoped ledger.",
  steps: [
    "Review the project year and whether you participate in the split; edit the project details when the setup changes.",
    "Add everyone who should reimburse the owner. Their owed share is calculated from the project expenses and participation settings.",
    "Record each expense with its date, quantity, unit amount, and optional note; the workspace calculates the total for the split.",
    "Use the participant ledger to compare owed, paid, remaining, or extra amounts, then save payments as they arrive.",
    "Archive a completed project to preserve its history, or use it as a template when you want to start another similar split.",
  ],
  snapshotLabels: {
    projectYear: "Project year",
    projectStatus: "Project status",
    ownerParticipation: "Owner participation",
    participants: "Participants",
    expenses: "Expenses",
    participantsNeedingPayment: "Participants needing payment",
    paidParticipants: "Paid or settled participants",
    collectionStatus: "Collection status",
  },
  actionLabels: {
    participants: "Add participants",
    expense: "Record first expense",
    payments: "Review participant payments",
    review: "Review project summary",
  },
} as const satisfies PageHelpContent;

export const INVESTMENTS_PAGE_HELP_CONTENT = {
  pageId: "investments",
  triggerLabel: "Open Investments help",
  title: "Investments guide",
  introduction: "Investments combines current REEI / RDSP holdings management with long-term projection planning. Holdings track FCP / MF and FNB / ETF positions; a calculator uses a manual starting amount; a portfolio plan uses live investment accounts and saved contribution schedules.",
  steps: [
    "Create an REEI / RDSP Account on Accounts, then add as many FCP / MF or FNB / ETF positions as you need to the same Account.",
    "Record opening positions, buys, sells, distributions, and fees; add dated prices and USD-to-CAD rates when needed. Supported Vanguard mutual-fund codes can refresh their dated NAV automatically. Delete position is for an erroneous holding; use a Sell ledger entry when you want to preserve a genuine sale.",
    "Create a projection and choose Manual calculator or Portfolio planner when you want to compare long-term outcomes.",
    "For a portfolio, select investment accounts and review each contribution schedule, horizon, return scenario, and annual override.",
    "Review current holdings and saved plans; these Investments workflows never create or change Cash Flow transactions.",
  ],
  snapshotLabels: {
    rdspAccounts: "REEI / RDSP accounts",
    holdings: "Current holdings",
    projectionProjects: "Projection projects",
    calculatorPlans: "Calculator plans",
    portfolioPlans: "Portfolio plans",
    investmentAccounts: "Investment accounts",
    contributionSchedules: "Contribution schedules",
    plansNeedingReview: "Plans needing review",
  },
  actionLabels: {
    create: "Create first projection",
    accounts: "Configure investment accounts",
    schedules: "Review contribution schedules",
    review: "Review projections",
  },
} as const satisfies PageHelpContent;

export const SETTINGS_PAGE_HELP_CONTENT = {
  pageId: "settings",
  triggerLabel: "Open Settings help",
  title: "Settings guide",
  introduction: "Settings protects access to your signed-in account. Use it to change your password, review active sessions, and sign out devices you no longer trust.",
  steps: [
    "Keep a unique password for this workspace and never share it with another person.",
    `Change your password with the current password. New passwords must satisfy: ${PASSWORD_POLICY_ERROR} The change signs you out everywhere.`,
    "Review active sessions and revoke any device you no longer recognize or use.",
    "Use Log out everywhere after a shared, lost, or compromised device needs immediate sign-out.",
    "Two-factor backup codes are shown once during setup. This deployment does not provide email or phone account recovery.",
  ],
  snapshotLabels: {
    passwordStatus: "Password status",
    activeSessions: "Active sessions",
    currentSession: "Current session",
    recoveryOptions: "Recovery options",
    twoFactorAuthentication: "Two-factor authentication",
  },
  actionLabels: {
    password: "Review password security",
    sessions: "Review active sessions",
    review: "Review account security",
  },
} as const satisfies PageHelpContent;

export const ANNUAL_EXPENSES_PAGE_HELP_CONTENT = {
  pageId: "annual-expenses",
  triggerLabel: "Open Annual expenses help",
  title: "Annual expenses guide",
  introduction: "Annual expenses turns yearly obligations into funded, auditable plans. Each active budget uses one funding account and keeps planned amounts, payments, and forecasts together.",
  steps: [
    "Make sure an active account is available, then create a budget that will hold the reserve for these yearly costs.",
    "Add each annual expense with its planned amount, budget, and due month or date.",
    "Use the selected planning year to adjust that year’s amount or due date without losing the reusable template.",
    "Record payments as they happen and review paid, remaining, variance, and over-budget status for each item.",
    "Review the funding forecast and recurring account contributions; archive completed budgets or items when you want to preserve their history.",
  ],
  snapshotLabels: {
    planningYear: "Planning year",
    activeBudgets: "Active budgets",
    archivedBudgets: "Archived budgets",
    activeExpenses: "Active yearly expenses",
    expensesNeedingPayment: "Expenses needing payment",
    forecasts: "Funding forecasts",
    availableFundingAccounts: "Available funding accounts",
  },
  actionLabels: {
    account: "Add funding account",
    budget: "Create annual budget",
    expense: "Add annual expense",
    payment: "Review annual payments",
    forecast: "Review funding forecast",
    review: "Review annual plan",
  },
} as const satisfies PageHelpContent;

export const RECURRING_PAYMENTS_PAGE_HELP_CONTENT = {
  pageId: "recurring-payments",
  triggerLabel: "Open Recurring payments help",
  title: "Recurring payments guide",
  introduction: "Recurring payments turn income, expenses, and transfers into schedules that generate planned Cash Flow rows while preserving history and manual changes.",
  steps: [
    "Start with an active account. Add your main income first if you are setting up Cash Flow for the first time.",
    "Create a series with a name, kind, amount, account or accounts, frequency, and schedule anchor. New income defaults to biweekly.",
    "Use Regenerate to extend planned occurrences through the period you need; generated rows remain separate from actual or manual records.",
    "For changes, use This and future for a new version, Entire series only when every linked row should move, and occurrence exceptions for one-off changes.",
    "Pause or end a schedule when movement stops, and keep history unless you intentionally remove every linked row.",
  ],
  snapshotLabels: {
    availableAccounts: "Available accounts",
    activeSchedules: "Active schedules",
    pausedSchedules: "Paused schedules",
    endedSchedules: "Ended schedules",
    scheduleVersions: "Schedule versions",
    activeExceptions: "Active exceptions",
    cashFlowPeriods: "Cash Flow periods",
  },
  actionLabels: {
    account: "Add an account",
    income: "Add first income",
    exceptions: "Review occurrence exceptions",
    review: "Review recurring schedules",
  },
} as const satisfies PageHelpContent;

export const PAGE_HELP_CONTENT = {
  overview: OVERVIEW_PAGE_HELP_CONTENT,
  "cash-flow": CASH_FLOW_PAGE_HELP_CONTENT,
  accounts: ACCOUNTS_PAGE_HELP_CONTENT,
  home: HOME_PAGE_HELP_CONTENT,
  salaries: SALARIES_PAGE_HELP_CONTENT,
  projects: PROJECTS_PAGE_HELP_CONTENT,
  "project-workspace": PROJECT_WORKSPACE_PAGE_HELP_CONTENT,
  investments: INVESTMENTS_PAGE_HELP_CONTENT,
  settings: SETTINGS_PAGE_HELP_CONTENT,
  "annual-expenses": ANNUAL_EXPENSES_PAGE_HELP_CONTENT,
  "recurring-payments": RECURRING_PAYMENTS_PAGE_HELP_CONTENT,
} as const satisfies Readonly<Record<PageHelpPageId, PageHelpContent>>;
