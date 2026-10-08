// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeMortgageTermView, HomeTimelineRow, HomeView, HouseholdExpenseView } from "@athena/database";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const actions = vi.hoisted(() => ({
  createHomeAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteHomeValueAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  deleteMortgageAnchorAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  saveMortgageTermsAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  upsertHomeValueAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  upsertMortgageAnchorAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
}));
vi.mock("./property-actions", () => actions);

import { HomePropertyManager } from "./property-manager";

const home: HomeView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Primary home",
  currency: "CAD",
  values: [{ id: "22222222-2222-4222-8222-222222222222", asOf: "2026-08-01", marketValueMinor: 35000000 }],
  mortgageTerms: [],
  mortgageAnchors: [{ id: "33333333-3333-4333-8333-333333333333", asOf: "2026-08-01", principalMinor: 12000000 }],
  timeline: [],
  currentEquityMinor: 23000000,
  mortgageConfigured: false,
};
const paymentExpenses: Pick<HouseholdExpenseView, "id" | "name" | "amountMinor">[] = [
  { id: "44444444-4444-4444-8444-444444444444", name: "Hypo", amountMinor: 125000 },
];
const mortgageTerm: HomeMortgageTermView = {
  id: "55555555-5555-4555-8555-555555555555",
  effectiveOn: "2024-09-22",
  annualRateBps: 549,
  compoundingConvention: "canadian_semi_annual",
  paymentExpenseId: paymentExpenses[0]!.id,
  paymentExpenseName: paymentExpenses[0]!.name,
  paymentMinor: paymentExpenses[0]!.amountMinor,
  nextPaymentOn: "2026-09-30",
  renewalOn: "2027-09-22",
  payoffOn: "2046-09-22",
};
const timelineRow: HomeTimelineRow = {
  asOf: "2026-09-16",
  marketValueMinor: 35_000_000,
  marketValueStatus: "actual",
  mortgagePrincipalMinor: 12_000_000,
  mortgageStatus: "actual",
  paymentMinor: 125_000,
  interestMinor: 25_000,
  principalPortionMinor: 100_000,
  equityMinor: 23_000_000,
};
const configuredHome: HomeView = { ...home, mortgageTerms: [mortgageTerm], timeline: [timelineRow] };
const dom = createDomTestRoot();

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Home property editors", () => {
  it("shows the active term form on request, reopens existing values for edit, and renders the fluid timeline menu", async () => {
    await dom.render(<HomePropertyManager home={configuredHome} paymentExpenses={paymentExpenses} todayIso="2026-09-22" />);

    const terms = dom.get<HTMLElement>(".home-mortgage-settings-card");
    expect(terms.querySelector(".maintenance-form")).toBeNull();
    await click(terms.querySelector<HTMLButtonElement>(".navy-action-button")!);
    expect(terms.querySelector(".maintenance-form")).not.toBeNull();
    expect(terms.querySelector<HTMLInputElement>('input[name="effectiveOn"]')?.value).toBe("2026-09-22");
    await click(terms.querySelector<HTMLButtonElement>(".maintenance-form-actions .maintenance-secondary-button")!);
    expect(terms.querySelector(".maintenance-form")).toBeNull();

    await click(terms.querySelector<HTMLButtonElement>(".home-history-table .maintenance-secondary-button")!);
    expect(terms.querySelector<HTMLInputElement>('input[name="effectiveOn"]')?.value).toBe("2024-09-22");
    expect(terms.querySelector<HTMLInputElement>('input[name="annualRate"]')?.value).toBe("5.49");
    expect(terms.querySelector<HTMLInputElement>('input[name="id"]')?.value).toBe(mortgageTerm.id);

    const timeline = dom.get<HTMLTableElement>(".home-timeline-table.is-fluid");
    expect(timeline.querySelector("caption")?.textContent).toBe("Home market value, mortgage projection, and equity timeline");
    const menuToggle = timeline.querySelector<HTMLButtonElement>('[aria-label="More actions for Sep 16, 2026"]');
    expect(menuToggle).not.toBeNull();
    await click(menuToggle!);
    expect(menuToggle?.getAttribute("aria-expanded")).toBe("true");
    const menu = timeline.querySelector<HTMLElement>('[role="menu"][aria-label="Actions for Sep 16, 2026"]');
    expect(menu?.textContent).toContain("Set house value");
    expect(menu?.textContent).toContain("Confirm mortgage balance");
  });

  it("opens a fresh mortgage term form when the latest term has expired", async () => {
    const expiredHome = { ...configuredHome, mortgageTerms: [{ ...mortgageTerm, payoffOn: "2025-09-22" }] };
    await dom.render(<HomePropertyManager home={expiredHome} paymentExpenses={paymentExpenses} todayIso="2026-09-22" />);

    const form = dom.get<HTMLFormElement>(".home-mortgage-settings-card .maintenance-form");
    expect(form.querySelector<HTMLInputElement>('input[name="effectiveOn"]')?.value).toBe("2026-09-22");
    expect(form.querySelector<HTMLInputElement>('input[name="id"]')).toBeNull();
  });

  it("resets the market-value editor at the successful save boundary", async () => {
    actions.upsertHomeValueAction.mockResolvedValue({ ok: true, message: "Value saved.", fieldErrors: {} });
    await dom.render(<HomePropertyManager home={home} paymentExpenses={paymentExpenses} todayIso="2026-09-22" />);
    await click(dom.get<HTMLButtonElement>(".home-property-history-card .maintenance-row-actions .maintenance-secondary-button"));
    expect(dom.get<HTMLInputElement>('.home-property-history-card input[name="marketValue"]').value).toBe("350000.00");
    await changeInput(dom.get<HTMLInputElement>('.home-property-history-card input[name="marketValue"]'), "360000.00");
    await submit(dom.get<HTMLFormElement>(".home-property-history-card .maintenance-form"));

    expect(actions.upsertHomeValueAction).toHaveBeenCalledOnce();
    expect(dom.get<HTMLElement>(".home-property-history-card .home-mobile-subdisclosure-title").textContent).toBe("Add market value");
    expect(dom.get<HTMLInputElement>('.home-property-history-card input[name="asOf"]').value).toBe("2026-09-22");
    expect(dom.get<HTMLInputElement>('.home-property-history-card input[name="marketValue"]').value).toBe("");
  });

  it("closes the mortgage-term editor after a successful save", async () => {
    actions.saveMortgageTermsAction.mockResolvedValue({ ok: true, message: "Mortgage terms saved.", fieldErrors: {} });
    await dom.render(<HomePropertyManager home={home} paymentExpenses={paymentExpenses} todayIso="2026-09-22" />);
    const section = dom.get<HTMLElement>(".home-mortgage-settings-card");
    await changeInput(section.querySelector<HTMLInputElement>('input[name="effectiveOn"]')!, "2026-09-22");
    await changeInput(section.querySelector<HTMLInputElement>('input[name="annualRate"]')!, "5.49");
    await changeInput(section.querySelector<HTMLInputElement>('input[name="nextPaymentOn"]')!, "2026-10-01");
    await changeInput(section.querySelector<HTMLInputElement>('input[name="renewalOn"]')!, "2027-09-22");
    await changeInput(section.querySelector<HTMLInputElement>('input[name="payoffOn"]')!, "2046-09-22");
    await submit(section.querySelector<HTMLFormElement>(".maintenance-form")!);

    expect(actions.saveMortgageTermsAction).toHaveBeenCalledOnce();
    expect(section.querySelector(".maintenance-form")).toBeNull();
    expect(section.querySelector(".home-mortgage-card-actions")?.textContent).toContain("Add new term");
  });

  it("closes anchor removal confirmation and returns to add mode after success", async () => {
    actions.deleteMortgageAnchorAction.mockResolvedValue({ ok: true, message: "Balance removed.", fieldErrors: {} });
    await dom.render(<HomePropertyManager home={home} paymentExpenses={paymentExpenses} todayIso="2026-09-22" />);
    const section = dom.get<HTMLElement>(".home-mortgage-anchors-card");
    await click(section.querySelector<HTMLButtonElement>(".maintenance-row-actions .maintenance-secondary-button")!);
    expect(section.querySelector<HTMLInputElement>('input[name="principal"]')?.value).toBe("120000.00");
    await click(section.querySelector<HTMLButtonElement>(".maintenance-row-actions .maintenance-danger-button")!);
    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.textContent).toContain("Remove the confirmed mortgage balance for");
    expect(dialog?.textContent).toContain("The confirmed balance will be removed from the mortgage history and projections.");
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")!);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
    expect(actions.deleteMortgageAnchorAction).not.toHaveBeenCalled();

    await click(section.querySelector<HTMLButtonElement>(".maintenance-row-actions .maintenance-danger-button")!);
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")!);

    expect(actions.deleteMortgageAnchorAction).toHaveBeenCalledOnce();
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
    expect(section.querySelector<HTMLInputElement>('input[name="principal"]')?.value).toBe("");
    expect(section.querySelector(".home-mobile-subdisclosure-title")?.textContent).toBe("Add confirmed balance");
  });
});
