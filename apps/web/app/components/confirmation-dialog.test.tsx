// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import { ConfirmationDialog } from "./confirmation-dialog";

const dom = createDomTestRoot();

describe("ConfirmationDialog", () => {
  it("renders nothing while closed", () => {
    expect(renderToStaticMarkup(<ConfirmationDialog open={false} title="Remove value" description="This cannot be undone." confirmLabel="Remove" onConfirm={() => undefined} onCancel={() => undefined} />)).toBe("");
  });

  it("renders an accessible native dialog with themed action states", async () => {
    await dom.render(<ConfirmationDialog
      open
      title="Remove value"
      description="This cannot be undone."
      confirmLabel="Remove"
      cancelLabel="Keep it"
      tone="danger"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />);

    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog?.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog?.textContent).toContain("Remove value");
    expect(dialog?.textContent).toContain("Keep it");
    expect(dialog?.querySelector(".confirmation-dialog__confirm")?.classList.contains("is-danger")).toBe(true);
  });

  it("exposes a three-way pending state and labels every outcome", async () => {
    await dom.render(<ConfirmationDialog
      open
      title="Recalculate projections?"
      description="Manual values are preserved."
      confirmLabel="Save & leave"
      cancelLabel="Stay"
      secondaryLabel="Leave without saving"
      onSecondary={() => undefined}
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />);
    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog?.textContent).toContain("Leave without saving");

    await dom.render(<ConfirmationDialog
      open
      title="Recalculate projections?"
      description="Manual values are preserved."
      confirmLabel="Save & leave"
      cancelLabel="Stay"
      secondaryLabel="Leave without saving"
      onSecondary={() => undefined}
      pending
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />);

    const pendingDialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(pendingDialog?.getAttribute("aria-busy")).toBe("true");
    expect(pendingDialog?.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")?.disabled).toBe(true);
    expect(pendingDialog?.querySelector<HTMLButtonElement>(".confirmation-dialog__secondary")?.disabled).toBe(true);
    expect(pendingDialog?.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")?.disabled).toBe(true);
    expect(pendingDialog?.textContent).toContain("Working…");
  });

  it("requires an acknowledgement before the important action can continue", async () => {
    await dom.render(<ConfirmationDialog
      open
      eyebrow="Action required"
      title="Two-factor authentication is required"
      description="Set up an authenticator app before continuing."
      confirmLabel="Continue to setup"
      cancelLabel={null}
      restoreFocus={false}
      acknowledgement={{
        label: "I understand that setup is required.",
        description: "This notice must be acknowledged before continuing.",
        checked: false,
        onChange: () => undefined,
      }}
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />);

    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog?.textContent).toContain("Action required");
    expect(dialog?.textContent).toContain("I understand that setup is required.");
    expect(dialog?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(dialog?.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")?.disabled).toBe(true);
    expect(dialog?.querySelector(".confirmation-dialog__cancel")).toBeNull();
  });

  it("clears submitted state when pending completes and when the dialog is reopened", async () => {
    const props = { title: "Delete account", description: "This cannot be undone.", confirmLabel: "Delete", onConfirm: vi.fn(), onCancel: vi.fn() };
    await dom.render(<ConfirmationDialog open {...props} />);
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")!);
    expect(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")?.disabled).toBe(true);

    await dom.render(<ConfirmationDialog open pending {...props} />);
    await dom.render(<ConfirmationDialog open {...props} />);
    expect(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")?.disabled).toBe(false);

    await dom.render(<ConfirmationDialog open={false} {...props} />);
    await dom.render(<ConfirmationDialog open {...props} />);
    expect(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__confirm")?.disabled).toBe(false);
  });

  it("opens through the DOM lifecycle and removes the portal after cancellation", async () => {
    const onCancel = vi.fn();
    const props = { title: "Remove value", description: "This cannot be undone.", confirmLabel: "Remove", onConfirm: vi.fn(), onCancel };
    await dom.render(<ConfirmationDialog open {...props} />);

    const dialog = document.body.querySelector<HTMLDialogElement>(".confirmation-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    await click(document.body.querySelector<HTMLButtonElement>(".confirmation-dialog__cancel")!);
    expect(onCancel).toHaveBeenCalledTimes(1);

    await dom.render(<ConfirmationDialog open={false} {...props} />);
    expect(document.body.querySelector(".confirmation-dialog")).toBeNull();
  });
});
