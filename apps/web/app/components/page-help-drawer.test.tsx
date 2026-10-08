// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import { ACCOUNTS_PAGE_HELP_CONTENT, ANNUAL_EXPENSES_PAGE_HELP_CONTENT, CASH_FLOW_PAGE_HELP_CONTENT, HOME_PAGE_HELP_CONTENT, INVESTMENTS_PAGE_HELP_CONTENT, OVERVIEW_PAGE_HELP_CONTENT, PAGE_HELP_CONTENT, PROJECTS_PAGE_HELP_CONTENT, PROJECT_WORKSPACE_PAGE_HELP_CONTENT, RECURRING_PAYMENTS_PAGE_HELP_CONTENT, SALARIES_PAGE_HELP_CONTENT, SETTINGS_PAGE_HELP_CONTENT } from "./page-help-content";

vi.mock("./page-help-actions", () => ({ markPageHelpSeen: vi.fn(async () => undefined) }));

import { PageHelpDrawer } from "./page-help-drawer";

const snapshot = {
  items: [
    { label: "Active accounts", value: "1" },
    { label: "Pay periods", value: "26" },
    { label: "Current balance", value: "Recorded" },
    { label: "Recurring movements", value: "2" },
  ],
  action: { label: "Review current projection", href: "/cash-flow" },
} as const;

const dom = createDomTestRoot();

describe("PageHelpDrawer", () => {
  it("centralizes the Projects and Investments guide content under stable page keys", () => {
    expect(PAGE_HELP_CONTENT.projects).toBe(PROJECTS_PAGE_HELP_CONTENT);
    expect(PROJECTS_PAGE_HELP_CONTENT.title).toBe("Projects guide");
    expect(PROJECTS_PAGE_HELP_CONTENT.introduction).toContain("equal-split workspace");
    expect(PROJECTS_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(PROJECTS_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      activeProjects: "Active projects",
      archivedProjects: "Archived projects",
      projectsWithExpenses: "Projects with expenses",
      participants: "Participants",
      projectsNeedingPayment: "Projects needing payment",
    });
    expect(PAGE_HELP_CONTENT.investments).toBe(INVESTMENTS_PAGE_HELP_CONTENT);
    expect(INVESTMENTS_PAGE_HELP_CONTENT.title).toBe("Investments guide");
    expect(INVESTMENTS_PAGE_HELP_CONTENT.introduction).toContain("manual starting amount");
    expect(INVESTMENTS_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(INVESTMENTS_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      rdspAccounts: "REEI / RDSP accounts",
      holdings: "Current holdings",
      projectionProjects: "Projection projects",
      calculatorPlans: "Calculator plans",
      portfolioPlans: "Portfolio plans",
      investmentAccounts: "Investment accounts",
      contributionSchedules: "Contribution schedules",
      plansNeedingReview: "Plans needing review",
    });
    expect(PAGE_HELP_CONTENT.settings).toBe(SETTINGS_PAGE_HELP_CONTENT);
    expect(SETTINGS_PAGE_HELP_CONTENT.title).toBe("Settings guide");
    expect(SETTINGS_PAGE_HELP_CONTENT.introduction).toContain("signed-in account");
    expect(SETTINGS_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(SETTINGS_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      passwordStatus: "Password status",
      activeSessions: "Active sessions",
      currentSession: "Current session",
      recoveryOptions: "Recovery options",
      twoFactorAuthentication: "Two-factor authentication",
    });
    expect(PAGE_HELP_CONTENT["annual-expenses"]).toBe(ANNUAL_EXPENSES_PAGE_HELP_CONTENT);
    expect(ANNUAL_EXPENSES_PAGE_HELP_CONTENT.title).toBe("Annual expenses guide");
    expect(ANNUAL_EXPENSES_PAGE_HELP_CONTENT.introduction).toContain("yearly obligations");
    expect(ANNUAL_EXPENSES_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(ANNUAL_EXPENSES_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      planningYear: "Planning year",
      activeBudgets: "Active budgets",
      archivedBudgets: "Archived budgets",
      activeExpenses: "Active yearly expenses",
      expensesNeedingPayment: "Expenses needing payment",
      forecasts: "Funding forecasts",
      availableFundingAccounts: "Available funding accounts",
    });
    expect(PAGE_HELP_CONTENT["recurring-payments"]).toBe(RECURRING_PAYMENTS_PAGE_HELP_CONTENT);
    expect(RECURRING_PAYMENTS_PAGE_HELP_CONTENT.title).toBe("Recurring payments guide");
    expect(RECURRING_PAYMENTS_PAGE_HELP_CONTENT.introduction).toContain("generate planned Cash Flow rows");
    expect(RECURRING_PAYMENTS_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(RECURRING_PAYMENTS_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      availableAccounts: "Available accounts",
      activeSchedules: "Active schedules",
      pausedSchedules: "Paused schedules",
      endedSchedules: "Ended schedules",
      scheduleVersions: "Schedule versions",
      activeExceptions: "Active exceptions",
      cashFlowPeriods: "Cash Flow periods",
    });
    expect(PAGE_HELP_CONTENT["project-workspace"]).toBe(PROJECT_WORKSPACE_PAGE_HELP_CONTENT);
    expect(PROJECT_WORKSPACE_PAGE_HELP_CONTENT.title).toBe("Project workspace guide");
    expect(PROJECT_WORKSPACE_PAGE_HELP_CONTENT.introduction).toContain("shared expense split");
    expect(PROJECT_WORKSPACE_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(PROJECT_WORKSPACE_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      projectYear: "Project year",
      projectStatus: "Project status",
      ownerParticipation: "Owner participation",
      participants: "Participants",
      expenses: "Expenses",
      participantsNeedingPayment: "Participants needing payment",
      paidParticipants: "Paid or settled participants",
      collectionStatus: "Collection status",
    });
  });

  it("centralizes the Salaries guide content under the shared page-help registry", () => {
    expect(PAGE_HELP_CONTENT.salaries).toBe(SALARIES_PAGE_HELP_CONTENT);
    expect(SALARIES_PAGE_HELP_CONTENT.title).toBe("Salaries guide");
    expect(SALARIES_PAGE_HELP_CONTENT.introduction).toContain("gross-income record by tax year");
    expect(SALARIES_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(SALARIES_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      salaryYears: "Salary years",
      selectedYear: "Selected tax year",
      ledgerStatus: "Ledger status",
      payStubSnapshots: "Pay-stub snapshots",
      officialFederalTotal: "Official federal total",
      rrqTracker: "RRQ tracker",
    });
    expect(SALARIES_PAGE_HELP_CONTENT.actionLabels).toEqual({
      create: "Create salary year",
      finalized: "Add finalized income",
      snapshot: "Add salary snapshot",
      review: "Review salary ledger",
    });
  });

  it("centralizes the Overview guide content under the shared page-help registry", () => {
    expect(PAGE_HELP_CONTENT.overview).toBe(OVERVIEW_PAGE_HELP_CONTENT);
    expect(OVERVIEW_PAGE_HELP_CONTENT.title).toBe("Overview guide");
    expect(OVERVIEW_PAGE_HELP_CONTENT.introduction).toContain("current financial picture");
    expect(OVERVIEW_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(OVERVIEW_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      activeAccounts: "Active accounts",
      payPeriods: "Pay periods",
      currentBalance: "Current balance",
      recurringMovement: "Recurring movement",
      homeProfile: "Home profile",
    });
    expect(OVERVIEW_PAGE_HELP_CONTENT.actionLabels).toEqual({
      account: "Create main account",
      timeline: "Set up Cash Flow rhythm",
      balance: "Record current balance",
      recurring: "Add recurring income or expense",
      projection: "Review current projection",
    });
  });

  it("centralizes the Home guide content under the shared page-help registry", () => {
    expect(PAGE_HELP_CONTENT.home).toBe(HOME_PAGE_HELP_CONTENT);
    expect(HOME_PAGE_HELP_CONTENT.title).toBe("Home guide");
    expect(HOME_PAGE_HELP_CONTENT.introduction).toContain("property, mortgage, household costs");
    expect(HOME_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(HOME_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      homeProfile: "Home profile",
      propertyValue: "Property value",
      activeExpenses: "Active household expenses",
      maintenanceItems: "Annual-maintenance items",
      cashFlowLink: "Cash Flow link",
    });
    expect(HOME_PAGE_HELP_CONTENT.actionLabels).toEqual({
      home: "Create Home profile",
      property: "Add property value",
      expense: "Add household expense",
      cashFlow: "Connect household Cash Flow",
      review: "Review Home timeline",
    });
  });

  it("centralizes the Accounts guide content under the shared page-help registry", () => {
    expect(PAGE_HELP_CONTENT.accounts).toBe(ACCOUNTS_PAGE_HELP_CONTENT);
    expect(ACCOUNTS_PAGE_HELP_CONTENT.title).toBe("Accounts guide");
    expect(ACCOUNTS_PAGE_HELP_CONTENT.introduction).toContain("foundation for your balance timeline");
    expect(ACCOUNTS_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(ACCOUNTS_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      activeAccounts: "Active accounts",
      payPeriods: "Pay periods",
      currentBalance: "Current balance",
      availableCashAccounts: "Available cash accounts",
    });
    expect(ACCOUNTS_PAGE_HELP_CONTENT.actionLabels).toEqual({
      account: "Create main account",
      timeline: "Set up Cash Flow rhythm",
      balance: "Record current balance",
      availableCash: "Configure available cash",
      timelineReview: "Review balance timeline",
    });
  });

  it("centralizes the approved Cash Flow static content under a stable page key", () => {
    expect(PAGE_HELP_CONTENT["cash-flow"]).toBe(CASH_FLOW_PAGE_HELP_CONTENT);
    expect(CASH_FLOW_PAGE_HELP_CONTENT.title).toBe("Cash Flow guide");
    expect(CASH_FLOW_PAGE_HELP_CONTENT.introduction).toBe("Cash Flow connects your account balances and scheduled movements to each pay period.");
    expect(CASH_FLOW_PAGE_HELP_CONTENT.steps).toHaveLength(5);
    expect(CASH_FLOW_PAGE_HELP_CONTENT.snapshotLabels).toEqual({
      activeAccounts: "Active accounts",
      payPeriods: "Pay periods",
      currentBalance: "Current balance",
      recurringMovements: "Recurring movements",
    });
    expect(CASH_FLOW_PAGE_HELP_CONTENT.actionLabels).toEqual({
      account: "Create main account",
      timeline: "Set up Cash Flow rhythm",
      balance: "Record current balance",
      recurring: "Add recurring income or expense",
      projection: "Review current projection",
    });
  });

  it("renders a descriptive native trigger and keeps the dialog closed initially", () => {
    const markup = renderToStaticMarkup(<PageHelpDrawer content={CASH_FLOW_PAGE_HELP_CONTENT} snapshot={snapshot} />);

    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Open Cash Flow help"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<dialog");
  });

  it("opens an accessible portal dialog and closes it through the local lifecycle", async () => {
    await dom.render(<PageHelpDrawer content={CASH_FLOW_PAGE_HELP_CONTENT} snapshot={snapshot} />);

    const trigger = dom.get<HTMLButtonElement>('button[aria-label="Open Cash Flow help"]');
    await click(trigger);

    const dialog = document.body.querySelector<HTMLDialogElement>(".page-help-drawer");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.textContent).toContain("At a glance");
    expect(dialog?.textContent).toContain("How it works");
    expect(dialog?.textContent).toContain("01");
    expect(dialog?.querySelector('a[href="/cash-flow"]')).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    if (!dialog) throw new Error("Missing help dialog");
    const close = dialog.querySelector<HTMLButtonElement>(".page-help-drawer__close");
    if (!close) throw new Error("Missing help dialog close button");
    await click(close);
    expect(document.body.querySelector(".page-help-drawer")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("honors the hydrated first-open request and keeps a manual close closed", async () => {
    await dom.render(<PageHelpDrawer content={CASH_FLOW_PAGE_HELP_CONTENT} snapshot={snapshot} initialOpen />);
    expect(document.body.querySelector(".page-help-drawer")).not.toBeNull();

    await click(document.body.querySelector<HTMLButtonElement>(".page-help-drawer__close")!);
    await dom.render(<PageHelpDrawer content={CASH_FLOW_PAGE_HELP_CONTENT} snapshot={snapshot} initialOpen />);
    expect(document.body.querySelector(".page-help-drawer")).toBeNull();
  });

  it("auto-opens an unseen demo guide once and keeps a manual close closed", async () => {
    const storageKey = "athena-vault:demo-page-help-seen:v1:cash-flow";
    window.localStorage.removeItem(storageKey);
    await dom.render(<PageHelpDrawer content={CASH_FLOW_PAGE_HELP_CONTENT} snapshot={snapshot} demoAutoOpen />);
    expect(document.body.querySelector(".page-help-drawer")).not.toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe("1");

    await click(document.body.querySelector<HTMLButtonElement>(".page-help-drawer__close")!);
    await dom.render(<PageHelpDrawer content={CASH_FLOW_PAGE_HELP_CONTENT} snapshot={snapshot} demoAutoOpen />);
    expect(document.body.querySelector(".page-help-drawer")).toBeNull();
    window.localStorage.removeItem(storageKey);
  });

  it("keeps the automatic first-open decision out of the server-rendered markup", () => {
    const markup = renderToStaticMarkup(<PageHelpDrawer content={CASH_FLOW_PAGE_HELP_CONTENT} snapshot={snapshot} initialOpen />);

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<dialog");
  });
});
