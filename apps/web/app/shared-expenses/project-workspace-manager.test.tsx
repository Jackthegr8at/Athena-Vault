// @vitest-environment jsdom

import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";
import type { SharedProjectSummaryView } from "@athena/database";

const mocks = vi.hoisted(() => ({
  cloneProjectAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  createProjectExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  createProjectParticipantAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteProjectExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteProjectParticipantAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  refresh: vi.fn(),
  setProjectArchivedAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  updateProjectAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  updateProjectExpenseAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  updateProjectParticipantAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
}));

vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ refresh: mocks.refresh })) }));
vi.mock("./actions", () => ({
  cloneProjectAction: mocks.cloneProjectAction,
  createProjectExpenseAction: mocks.createProjectExpenseAction,
  createProjectParticipantAction: mocks.createProjectParticipantAction,
  deleteProjectExpenseAction: mocks.deleteProjectExpenseAction,
  deleteProjectParticipantAction: mocks.deleteProjectParticipantAction,
  setProjectArchivedAction: mocks.setProjectArchivedAction,
  updateProjectAction: mocks.updateProjectAction,
  updateProjectExpenseAction: mocks.updateProjectExpenseAction,
  updateProjectParticipantAction: mocks.updateProjectParticipantAction,
}));

import { ProjectWorkspaceManager, quickPaidCheckboxChecked, type ProjectWorkspacePresentation } from "./project-workspace-manager";

const summary: SharedProjectSummaryView = {
  totalExpensesMinor: 10_000,
  participantCount: 2,
  splitCount: 2,
  sharePerPersonMinor: 5_000,
  ownerShareMinor: 5_000,
  expectedFromOthersMinor: 5_000,
  receivedFromOthersMinor: 2_500,
  outstandingMinor: 2_500,
  overpaymentReceivedMinor: 0,
  roundingDifferenceMinor: 0,
  netCashResultMinor: -2_500,
  canCalculate: true,
  collectionStatus: "partial",
};

const project: ProjectWorkspacePresentation = {
  id: "project-1",
  name: "Cabin weekend",
  projectYear: 2026,
  ownerParticipates: true,
  note: "Friends trip",
  archived: false,
  summary,
  expenses: [{
    id: "expense-1",
    projectId: "project-1",
    description: "Cabin rental",
    expenseOn: "2026-08-22",
    quantity: 2,
    amountMinor: 5_000,
    totalMinor: 10_000,
    note: "Paid online",
  }],
  participants: [{
    id: "participant-1",
    projectId: "project-1",
    name: "Sam",
    paidMinor: 2_500,
    owedMinor: 5_000,
    remainingMinor: 2_500,
    extraMinor: null,
    status: "partial",
  }],
};

const dom = createDomTestRoot();

describe("Project workspace manager", () => {
  it("renders the labelled summary and two responsive ledgers", () => {
    const markup = renderToStaticMarkup(<ProjectWorkspaceManager project={project} />);

    expect(markup).toContain('id="project-workspace"');
    expect(markup).toContain("project-title-line");
    expect(markup).toContain('aria-label="Project summary"');
    expect(markup).toContain("Rounding difference");
    expect(markup).toContain("Net cash result");
    expect(markup).toContain("Expenses");
    expect(markup).toContain("Participants");
    expect(markup).toContain('data-label="Quantity"');
    expect(markup).toContain('data-label="Unit amount"');
    expect(markup).toContain('data-label="Participant"');
    expect(markup).toContain('data-label="Total"');
  });

  it("opens edit and template controls with their scoped defaults and confirmation boundary", async () => {
    await dom.render(<ProjectWorkspaceManager project={project} />);

    const detailsEditor = dom.get<HTMLDetailsElement>(".project-details-editor");
    await click(detailsEditor.querySelector("summary") as HTMLElement);
    if (!dom.container.querySelector(".project-details-form")) {
      await act(async () => {
        detailsEditor.open = true;
        detailsEditor.dispatchEvent(new Event("toggle", { bubbles: true }));
      });
    }
    expect(dom.get<HTMLInputElement>('.project-details-form input[name="name"]').value).toBe("Cabin weekend");
    expect(dom.get<HTMLInputElement>('.project-details-form input[name="year"]').value).toBe("2026");

    const cloneEditor = dom.get<HTMLDetailsElement>(".project-clone-editor");
    await click(cloneEditor.querySelector("summary") as HTMLElement);
    if (!dom.container.querySelector(".project-clone-form")) {
      await act(async () => {
        cloneEditor.open = true;
        cloneEditor.dispatchEvent(new Event("toggle", { bubbles: true }));
      });
    }
    expect(dom.get<HTMLInputElement>('.project-clone-form input[name="sourceProjectId"]').value).toBe("project-1");
    expect(dom.get(".project-clone-help").textContent).toContain("participant payments start at $0.00");
    expect(dom.container.querySelectorAll('input[name="confirm"][required]')).toHaveLength(3);
  });

  it("submits the quick-paid amount from the rendered checkbox and follows refreshed props", async () => {
    expect(quickPaidCheckboxChecked({ status: "extra", paidMinor: 1_200, owedMinor: 1_000 })).toBe(true);
    expect(quickPaidCheckboxChecked({ status: "paid", paidMinor: 1_000, owedMinor: 1_000 })).toBe(true);
    expect(quickPaidCheckboxChecked({ status: "partial", paidMinor: 500, owedMinor: 1_000 })).toBe(false);
    expect(quickPaidCheckboxChecked({ status: "unpaid", paidMinor: 0, owedMinor: 1_200 })).toBe(false);

    await dom.render(<ProjectWorkspaceManager project={project} />);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => undefined);
    const paid = dom.get<HTMLInputElement>(".project-paid-checkbox input");
    expect(paid.checked).toBe(false);
    await click(paid);
    expect(paid.checked).toBe(true);
    const paidAmount = dom.get<HTMLInputElement>('.project-quick-paid-form input[name="paidAmount"]');
    expect(paidAmount.value).toBe("50.00");
    expect(paidAmount.value).not.toMatch(/[,$]|NaN/);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("closes project details only after a successful update action", async () => {
    mocks.updateProjectAction.mockResolvedValueOnce({ ok: true, message: "Project updated.", fieldErrors: {} });
    await dom.render(<ProjectWorkspaceManager project={project} />);
    const details = dom.get<HTMLDetailsElement>(".project-details-editor");
    await click(details.querySelector("summary") as HTMLElement);
    if (!dom.container.querySelector(".project-details-form")) {
      await act(async () => {
        details.open = true;
        details.dispatchEvent(new Event("toggle", { bubbles: true }));
      });
    }

    const form = dom.get<HTMLFormElement>(".project-details-form");
    await act(async () => {
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.updateProjectAction).toHaveBeenCalledOnce();
    expect(dom.container.querySelector(".project-details-form")).toBeNull();
  });

  it("closes the new-expense form at successful submission rather than in an effect", async () => {
    mocks.createProjectExpenseAction.mockResolvedValueOnce({ ok: true, message: "Expense added.", fieldErrors: {} });
    await dom.render(<ProjectWorkspaceManager project={project} />);
    await click(dom.get<HTMLButtonElement>('#project-expenses-panel button[aria-expanded="false"]'));
    const form = dom.get<HTMLFormElement>("#project-expenses-panel form.project-inline-form");
    await changeInput(dom.get<HTMLInputElement>('#project-expenses-panel input[name="description"]'), "Train tickets");
    await changeInput(dom.get<HTMLInputElement>('#project-expenses-panel input[name="amount"]'), "42.00");

    await act(async () => {
      form.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.createProjectExpenseAction).toHaveBeenCalledOnce();
    expect(dom.container.querySelector("#project-expenses-panel form.project-inline-form")).toBeNull();
  });

  it("derives the quick-paid checkbox from the newly persisted participant status", async () => {
    await dom.render(<ProjectWorkspaceManager project={project} />);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => undefined);
    const checkbox = dom.get<HTMLInputElement>(".project-paid-checkbox input");
    await click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(requestSubmit).toHaveBeenCalledOnce();

    const paidProject: ProjectWorkspacePresentation = {
      ...project,
      participants: [{ ...project.participants[0]!, paidMinor: 5_000, remainingMinor: 0, status: "paid" }],
    };
    await dom.render(<ProjectWorkspaceManager project={paidProject} />);
    expect(dom.get<HTMLInputElement>(".project-paid-checkbox input").checked).toBe(true);

    const partialProject: ProjectWorkspacePresentation = {
      ...project,
      participants: [{ ...project.participants[0]!, paidMinor: 3_000, remainingMinor: 2_000, status: "partial" }],
    };
    await dom.render(<ProjectWorkspaceManager project={partialProject} />);
    expect(dom.get<HTMLInputElement>(".project-paid-checkbox input").checked).toBe(false);
  });
});
