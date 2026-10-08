// @vitest-environment jsdom

import React, { act, useState } from "react";
import { describe, expect, it } from "vitest";
import type { InvestmentProjectionProjectView } from "@athena/database";
import { click, createDomTestRoot } from "../../test/dom";
import { InvestmentDialog } from "./investment-dialog";
import { ProjectRow } from "./investment-project-row";

const dom = createDomTestRoot();

function project(id: string, name: string): InvestmentProjectionProjectView {
  return {
    id,
    name,
    notes: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-08T00:00:00Z"),
    mode: "calculator",
    manualStartingAmountMinor: 100_000,
    horizonYears: 10,
    baselineDate: "2026-09-08",
    accountCount: 0,
    rateBps: 500,
    startingBalanceMinor: 100_000,
    endingBalanceMinor: 162_889,
    warningCount: 0,
    compoundingPeriodsPerYear: 12,
    accounts: [],
    accountSchedules: [],
    rates: [{ id: `rate-${id}`, rateBps: 500, displayOrder: 0 }],
    annualContributionSummary: [],
    scenarios: [{
      rateBps: 500,
      points: [{ year: 0, calendarYear: 2026, balanceMinor: 100_000, contributionsMinor: 0, growthMinor: 0 }],
    }],
    warnings: [],
  };
}

type DialogState = { readonly kind: "edit" | "delete"; readonly projectName: string };

function RowsWithDialog() {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const openDialog = (kind: DialogState["kind"]) => (selected: InvestmentProjectionProjectView) => setDialog({ kind, projectName: selected.name });
  return <>
    <table>
      <tbody>
        <ProjectRow project={project("project-a", "Retirement outlook")} onOpen={() => undefined} onEdit={openDialog("edit")} onDelete={openDialog("delete")} />
        <ProjectRow project={project("project-b", "Cottage fund")} onOpen={() => undefined} onEdit={openDialog("edit")} onDelete={openDialog("delete")} />
      </tbody>
    </table>
    {dialog ? <InvestmentDialog backdropClassName="investment-modal-backdrop" dialogClassName="investment-dialog" titleId="investment-row-dialog-title" onClose={() => setDialog(null)}>
      <h2 id="investment-row-dialog-title">{dialog.kind === "edit" ? "Edit" : "Delete"} {dialog.projectName}</h2>
      <button type="button" data-row-dialog-close data-investment-dialog-initial-focus onClick={() => setDialog(null)}>Close dialog</button>
      <button type="button">Last control</button>
    </InvestmentDialog> : null}
  </>;
}

async function keyboardActivate(button: HTMLButtonElement, key: "Enter" | " "): Promise<void> {
  await act(async () => {
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    // jsdom does not synthesize a native button click from key events.
    if (key === "Enter") button.click();
    button.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    if (key === " ") button.click();
  });
}

async function flushAnimationFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
}

async function openMenuItem(menuButton: HTMLButtonElement, label: string): Promise<HTMLButtonElement> {
  await click(menuButton);
  const menuItem = Array.from(document.body.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
    .find((item) => item.textContent === label);
  if (!menuItem) throw new Error(`Missing investment row menu item: ${label}`);
  return menuItem;
}

describe("ProjectRow menu actions", () => {
  it("restores focus to the originating row menu button after keyboard Edit", async () => {
    await dom.render(<RowsWithDialog />);

    const menuButton = dom.get<HTMLButtonElement>("[aria-label='More actions for Retirement outlook']");
    const menuItem = await openMenuItem(menuButton, "Edit");
    await keyboardActivate(menuItem, "Enter");

    expect(menuItem.isConnected).toBe(false);
    expect(dom.get<HTMLElement>("[role='dialog']").textContent).toContain("Edit Retirement outlook");

    await click(dom.get<HTMLButtonElement>("[data-row-dialog-close]"));
    await flushAnimationFrame();
    expect(document.activeElement).toBe(menuButton);
  });

  it("restores focus to the correct row after keyboard Delete", async () => {
    await dom.render(<RowsWithDialog />);

    const menuButton = dom.get<HTMLButtonElement>("[aria-label='More actions for Cottage fund']");
    const menuItem = await openMenuItem(menuButton, "Delete");
    await keyboardActivate(menuItem, " ");

    expect(menuItem.isConnected).toBe(false);
    expect(dom.get<HTMLElement>("[role='dialog']").textContent).toContain("Delete Cottage fund");

    await click(dom.get<HTMLButtonElement>("[data-row-dialog-close]"));
    await flushAnimationFrame();
    expect(document.activeElement).toBe(menuButton);
  });

  it("cleans up the portalled menu on Escape and outside-pointer dismissal", async () => {
    await dom.render(<RowsWithDialog />);

    const menuButton = dom.get<HTMLButtonElement>("[aria-label='More actions for Retirement outlook']");
    await click(menuButton);
    expect(document.body.querySelector(".investment-row-menu")).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.body.querySelector(".investment-row-menu")).toBeNull();
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    await click(menuButton);
    expect(document.body.querySelector(".investment-row-menu")).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.body.querySelector(".investment-row-menu")).toBeNull();
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
  });
});
