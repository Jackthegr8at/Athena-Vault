// @vitest-environment jsdom

import React, { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import { InvestmentDialog } from "./investment-dialog";

const dom = createDomTestRoot();

function DialogHarness({ pending = false, onClose = () => undefined }: { readonly pending?: boolean; readonly onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" data-dialog-trigger onClick={() => setOpen(true)}>Open dialog</button><button type="button" data-outside-control>Outside control</button>{open ? <InvestmentDialog backdropClassName="investment-modal-backdrop" dialogClassName="investment-dialog" titleId="investment-dialog-title" pending={pending} dismissOnBackdrop onClose={() => { setOpen(false); onClose(); }}><h2 id="investment-dialog-title">Investment dialog</h2><button type="button" data-dialog-initial-focus data-investment-dialog-initial-focus onClick={() => setOpen(false)}>Close dialog</button><button type="button" data-dialog-last-control>Last control</button></InvestmentDialog> : null}</>;
}

async function dispatchCancel(dialog: HTMLDialogElement): Promise<void> { await act(async () => { dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true })); }); }
async function dispatchTab(dialog: HTMLDialogElement, shiftKey = false): Promise<KeyboardEvent> { const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, shiftKey }); await act(async () => { dialog.dispatchEvent(event); }); return event; }
async function flushAnimationFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
}


describe("InvestmentDialog", () => {
  it("opens, makes outside controls inert, and restores focus on close", async () => {
    await dom.render(<DialogHarness />);
    const trigger = dom.get<HTMLButtonElement>("[data-dialog-trigger]");
    const outside = dom.get<HTMLButtonElement>("[data-outside-control]");
    trigger.focus(); await click(trigger);
    const dialog = document.body.querySelector<HTMLDialogElement>("dialog.investment-modal-backdrop");
    expect(dialog?.open).toBe(true); expect(dialog?.getAttribute("aria-modal")).toBe("true"); expect(outside.inert).toBe(true);
    await click(dom.get<HTMLButtonElement>("[data-dialog-initial-focus]"));
    expect(outside.inert).not.toBe(true); expect(document.activeElement).toBe(trigger);
  });
  it("wraps keyboard focus at the dialog boundary", async () => {
    await dom.render(<DialogHarness />); await click(dom.get("[data-dialog-trigger]")); await flushAnimationFrame();
    const dialog = document.body.querySelector<HTMLDialogElement>("dialog.investment-modal-backdrop")!;
    const first = dom.get<HTMLButtonElement>("[data-dialog-initial-focus]"); const last = dom.get<HTMLButtonElement>("[data-dialog-last-control]");
    last.focus(); expect((await dispatchTab(dialog)).defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
    first.focus(); expect((await dispatchTab(dialog, true)).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
  });
  it("dismisses with Escape only while idle", async () => {
    const onClose = vi.fn(); await dom.render(<DialogHarness onClose={onClose} />); await click(dom.get("[data-dialog-trigger]"));
    await dispatchCancel(document.body.querySelector<HTMLDialogElement>("dialog")!); expect(onClose).toHaveBeenCalledTimes(1);
    await dom.render(<DialogHarness pending onClose={onClose} />); await click(dom.get("[data-dialog-trigger]"));
    await dispatchCancel(document.body.querySelector<HTMLDialogElement>("dialog")!); expect(onClose).toHaveBeenCalledTimes(1);
  });
});
