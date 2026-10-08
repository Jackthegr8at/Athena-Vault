// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeInput, click, createDomTestRoot } from "../../test/dom";

const mocks = vi.hoisted(() => {
  const snapshots: Record<string, Record<string, unknown>> = {
    "book-a": { cell: "saved" },
    "book-b": { cell: "B" },
  };
  return {
    snapshots,
    fetch: vi.fn(async (input: unknown) => {
      const url = String(input);
      const id = decodeURIComponent(url.slice("/api/workbooks/".length, url.length - "/snapshot".length));
      const snapshot = snapshots[id];
      if (!snapshot) return { ok: false, status: 404, json: async () => ({ error: "Workbook not found." }) };
      return { ok: true, status: 200, json: async () => ({ snapshot }) };
    }),
    createUniver: vi.fn(() => ({
      univer: { dispose: vi.fn() },
      univerAPI: {
        createWorkbook: vi.fn((data: Record<string, unknown>) => ({
          data,
          setName: vi.fn((name: string) => { data.name = name; }),
          setEditable: vi.fn(),
          save: vi.fn(() => ({ ...data })),
        })),
        onCommandExecuted: vi.fn(() => ({ dispose: vi.fn() })),
      },
    })),
    router: { push: vi.fn(), refresh: vi.fn() },
    saveWorkbookAction: vi.fn(async () => ({ ok: true, message: "Workbook saved." })),
    confirmationDialog: vi.fn((_props: { readonly open: boolean }) => null),
  };
});

vi.mock("@univerjs/presets", () => ({ createUniver: mocks.createUniver, LocaleType: { EN_US: "en-US" }, mergeLocales: vi.fn() }));
vi.mock("@univerjs/presets/preset-sheets-core/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/presets/preset-sheets-core", () => ({ UniverSheetsCorePreset: vi.fn() }));
vi.mock("next/dynamic", async () => ({ default: () => UniverEditor }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("./actions", () => ({ createCalculationWorkbookAction: vi.fn(), deleteCalculationWorkbookAction: vi.fn(), saveCalculationWorkbookAction: mocks.saveWorkbookAction }));
vi.mock("../components/confirmation-dialog", () => ({ ConfirmationDialog: mocks.confirmationDialog }));

import { UniverEditor, type UniverEditorProps } from "./univer-editor";
import { CalculationWorkbench, type CalculationWorkbookSummary } from "./calculation-workbench";
import type { ConfirmationDialogProps } from "../components/confirmation-dialog";

const dom = createDomTestRoot();
const selected: CalculationWorkbookSummary = { id: "book-a", name: "First workbook", updatedAt: "2026-09-07T00:00:00Z" };

function instance(index = 0) {
  const result = mocks.createUniver.mock.results[index];
  if (!result || result.type !== "return") throw new Error("Editor was not created");
  return result.value;
}

function workbook(index = 0) {
  const result = instance(index).univerAPI.createWorkbook.mock.results[0];
  if (!result || result.type !== "return") throw new Error("Workbook was not created");
  return result.value;
}

function invokeCommand(index = 0): void {
  const commandMock = instance(index).univerAPI.onCommandExecuted as unknown as {
    readonly mock: { readonly calls: readonly (readonly unknown[])[] };
  };
  const callback = commandMock.mock.calls[0]?.[0];
  if (typeof callback !== "function") throw new Error("Command callback was not registered");
  callback();
}

async function flushAsync(ticks = 8): Promise<void> {
  await act(async () => {
    for (let index = 0; index < ticks; index += 1) await Promise.resolve();
  });
}

async function waitForUniverInstances(count: number): Promise<void> {
  await flushAsync();
  await act(async () => {
    await Promise.all([
      import("@univerjs/presets"),
      import("@univerjs/presets/preset-sheets-core/locales/en-US"),
      import("@univerjs/presets/preset-sheets-core"),
    ]);
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
  });
  expect(mocks.createUniver).toHaveBeenCalledTimes(count);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("Univer editor lifecycle", () => {
  it("reuses the Strict Mode instance and preserves drafts across snapshot/name/callback refreshes", async () => {
    const props: UniverEditorProps = { workbookId: selected.id, initialName: selected.name, snapshot: mocks.snapshots["book-a"]!, readOnly: false, onDirty: vi.fn(), onSaveReady: vi.fn() };
    await dom.render(<StrictMode><UniverEditor {...props} /></StrictMode>);
    await waitForUniverInstances(1);
    expect(mocks.createUniver).toHaveBeenCalledTimes(1);
    await act(async () => { invokeCommand(); });
    expect(props.onDirty).not.toHaveBeenCalled();
    workbook().data.cell = "unsaved edit";
    const onDirty = vi.fn();
    const onSaveReady = vi.fn();
    await dom.render(<StrictMode><UniverEditor {...props} initialName="Renamed on server" snapshot={{ cell: "new server snapshot" }} onDirty={onDirty} onSaveReady={onSaveReady} /></StrictMode>);
    expect(mocks.createUniver).toHaveBeenCalledTimes(1);
    expect(workbook().save()).toMatchObject({ cell: "unsaved edit", name: selected.name });
    expect(onSaveReady).toHaveBeenCalledWith(expect.any(Function));
    await act(async () => {
      dom.get(".athena-univer-editor").dispatchEvent(new Event("pointerdown", { bubbles: true }));
      invokeCommand();
    });
    expect(onDirty).toHaveBeenCalledOnce();
    expect(props.onDirty).not.toHaveBeenCalled();
    await dom.unmount();
    vi.runOnlyPendingTimers();
    expect(instance().univer.dispose).toHaveBeenCalledOnce();
    expect(instance().univerAPI.onCommandExecuted.mock.results[0]!.value.dispose).toHaveBeenCalledOnce();
  });

  it("uses the latest committed seed on identity changes and invalidates the old save callback", async () => {
    const onSaveReady = vi.fn();
    const props: UniverEditorProps = { workbookId: "book-a", initialName: "A", snapshot: { cell: "A" }, readOnly: false, onDirty: vi.fn(), onSaveReady };
    await dom.render(<UniverEditor {...props} />);
    await waitForUniverInstances(1);
    const oldSave = onSaveReady.mock.calls.at(-1)![0] as (name: string) => unknown;
    await dom.render(<UniverEditor {...props} workbookId="book-b" initialName="B" snapshot={{ cell: "B" }} />);
    await waitForUniverInstances(2);
    expect(mocks.createUniver).toHaveBeenCalledTimes(2);
    expect(workbook(1).data).toMatchObject({ id: "book-b", name: "B", cell: "B" });
    expect(() => oldSave("Old")).toThrow("not ready to save");
    vi.runOnlyPendingTimers();
    expect(instance(0).univer.dispose).toHaveBeenCalledOnce();
    expect(instance(1).univer.dispose).not.toHaveBeenCalled();
  });

  it("reinitializes when editability changes without retaining editable commands", async () => {
    const props: UniverEditorProps = { workbookId: "book-a", initialName: "A", snapshot: {}, readOnly: false, onDirty: vi.fn(), onSaveReady: vi.fn() };
    await dom.render(<UniverEditor {...props} />);
    await waitForUniverInstances(1);
    await dom.render(<UniverEditor {...props} readOnly snapshot={{ cell: "read-only seed" }} />);
    await waitForUniverInstances(2);
    expect(mocks.createUniver).toHaveBeenCalledTimes(2);
    expect(workbook(1).setEditable).toHaveBeenCalledWith(false);
    expect(workbook(1).data.cell).toBe("read-only seed");
    dom.get(".athena-univer-editor").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    invokeCommand(1);
    expect(props.onDirty).not.toHaveBeenCalled();
  });

  it("reports an actionable message when the asynchronous Univer setup rejects", async () => {
    mocks.createUniver.mockImplementationOnce(() => { throw new Error("Univer initialization failed."); });
    const onSaveReady = vi.fn();
    await dom.render(<UniverEditor workbookId="book-a" initialName="A" snapshot={{}} readOnly={false} onDirty={vi.fn()} onSaveReady={onSaveReady} />);
    await act(async () => {
      await Promise.all([
        import("@univerjs/presets"),
        import("@univerjs/presets/preset-sheets-core/locales/en-US"),
        import("@univerjs/presets/preset-sheets-core"),
      ]);
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(onSaveReady).toHaveBeenCalledWith(null);
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toContain("Refresh the page and try again.");
  });
});

describe("workbook selection lifecycle", () => {
  const renderWorkbench = (value: CalculationWorkbookSummary | null) => dom.render(<CalculationWorkbench selectedWorkbook={value} workbooks={value ? [value] : []} isDemo={false} migrationRequired={false} />);

  it("keeps a dirty name, snapshot, and live save callback on same-workbook server refreshes", async () => {
    await renderWorkbench(selected);
    const input = dom.get<HTMLInputElement>("#calculation-workbook-name");
    expect(dom.get<HTMLButtonElement>(".workbook-save-button").disabled).toBe(false);
    await changeInput(input, "Unsaved title");
    workbook().data.cell = "unsaved cell";
    await renderWorkbench({ ...selected, name: "Persisted title" });
    expect(input.value).toBe("Unsaved title");
    expect(dom.get(".workbook-save-state").textContent).toBe("Unsaved changes");
    expect(dom.get<HTMLButtonElement>(".workbook-save-button").disabled).toBe(false);
    expect(mocks.createUniver).toHaveBeenCalledTimes(1);
    expect(workbook().data.cell).toBe("unsaved cell");
  });

  it("aborts an in-flight snapshot request when switching workbooks", async () => {
    let firstSignal: AbortSignal | null | undefined;
    mocks.fetch.mockImplementationOnce(async (_input: unknown, init?: RequestInit) => {
      firstSignal = init?.signal;
      return await new Promise<never>(() => undefined);
    });

    await renderWorkbench(selected);
    await renderWorkbench({ id: "book-b", name: "Second workbook", updatedAt: "2026-09-08T00:00:00Z" });

    expect(firstSignal?.aborted).toBe(true);
  });

  it("exposes accessible expand controls and keeps saving available for a ready editor", async () => {
    await renderWorkbench(selected);
    const saveButton = dom.get<HTMLButtonElement>(".workbook-save-button");
    expect(saveButton.disabled).toBe(false);
    await waitForUniverInstances(1);
    expect(saveButton.disabled).toBe(false);

    const expandButton = dom.get<HTMLButtonElement>(".workbook-expand-button");
    await click(expandButton);
    expect(dom.get(".workbook-shell").classList.contains("is-expanded")).toBe(true);
    expect(expandButton.getAttribute("aria-pressed")).toBe("true");
    expect(expandButton.getAttribute("aria-label")).toBe("Restore workbook size");
    await click(expandButton);
    expect(dom.get(".workbook-shell").classList.contains("is-expanded")).toBe(false);
  });

  it("keeps Save disabled when the calculation editor fails to initialize", async () => {
    mocks.createUniver.mockImplementationOnce(() => { throw new Error("Univer initialization failed."); });
    await renderWorkbench(selected);
    await act(async () => {
      await Promise.all([
        import("@univerjs/presets"),
        import("@univerjs/presets/preset-sheets-core/locales/en-US"),
        import("@univerjs/presets/preset-sheets-core"),
      ]);
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });

    expect(dom.get<HTMLButtonElement>(".workbook-save-button").disabled).toBe(true);
    expect(dom.get('[role="alert"]').textContent).toContain("Refresh the page and try again.");
  });

  it("reports when browser fullscreen is unavailable for the workbook editor", async () => {
    await renderWorkbench(selected);
    await waitForUniverInstances(1);
    const editor = dom.get<HTMLDivElement>(".workbook-editor-shell");
    const requestFullscreen = vi.fn().mockRejectedValue(new Error("fullscreen is blocked"));
    Object.defineProperty(editor, "requestFullscreen", { configurable: true, value: requestFullscreen });

    await act(async () => {
      dom.get<HTMLButtonElement>(".workbook-full-page-button").click();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(dom.get(".workbook-full-page-error").textContent).toBe("Full-page mode is unavailable. Check your browser permissions and try again.");
  });

  it("intercepts app links and browser unload while dirty, then lets Stay keep the workbook open", async () => {
    mocks.router.push.mockClear();
    const otherWorkbook = { id: "book-b", name: "Second workbook", updatedAt: "2026-09-08T00:00:00Z" };
    await dom.render(<CalculationWorkbench selectedWorkbook={selected} workbooks={[selected, otherWorkbook]} isDemo={false} migrationRequired={false} />);
    await changeInput(dom.get<HTMLInputElement>("#calculation-workbook-name"), "Unsaved title");

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const anchor = document.createElement("a");
    anchor.href = "/accounts";
    anchor.textContent = "Accounts";
    dom.container.append(anchor);
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { anchor.dispatchEvent(clickEvent); });
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(mocks.confirmationDialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }), undefined);

    const dialogProps = mocks.confirmationDialog.mock.lastCall?.[0] as ConfirmationDialogProps | undefined;
    if (!dialogProps?.onCancel) throw new Error("Missing stay-on-workbook action");
    await act(async () => { dialogProps.onCancel?.(); });
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.confirmationDialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }), undefined);
  });

  it("keeps failed saves dirty and renders the server's actionable message", async () => {
    mocks.saveWorkbookAction.mockResolvedValueOnce({ ok: false, message: "The server rejected this workbook." });
    await renderWorkbench(selected);
    await waitForUniverInstances(1);
    await changeInput(dom.get<HTMLInputElement>("#calculation-workbook-name"), "Unsaved title");
    await act(async () => {
      dom.get<HTMLButtonElement>(".workbook-save-button").click();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(dom.get(".workbook-save-state").textContent).toBe("The server rejected this workbook.");
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it("resets selection state only when changing workbooks, including null transitions", async () => {
    await renderWorkbench(selected);
    await changeInput(dom.get("#calculation-workbook-name"), "Unsaved title");
    await renderWorkbench({ id: "book-b", name: "Second workbook", updatedAt: "2026-09-08T00:00:00Z" });
    expect(dom.get<HTMLInputElement>("#calculation-workbook-name").value).toBe("Second workbook");
    expect(dom.get(".workbook-save-state").textContent).toBe("Saved");
    expect(dom.get<HTMLButtonElement>(".workbook-save-button").disabled).toBe(false);
    expect(workbook(1).data.cell).toBe("B");
    await renderWorkbench(null);
    expect(dom.container.querySelector("#calculation-workbook-name")).toBeNull();
    await renderWorkbench(selected);
    expect(dom.get<HTMLInputElement>("#calculation-workbook-name").value).toBe(selected.name);
    expect(dom.get<HTMLButtonElement>(".workbook-save-button").disabled).toBe(false);
  });

  it("navigates to the captured destination directly from the discard action", async () => {
    mocks.router.push.mockClear();
    const otherWorkbook = { id: "book-b", name: "Second workbook", updatedAt: "2026-09-08T00:00:00Z" };
    await dom.render(<CalculationWorkbench selectedWorkbook={selected} workbooks={[selected, otherWorkbook]} isDemo={false} migrationRequired={false} />);
    await changeInput(dom.get<HTMLInputElement>("#calculation-workbook-name"), "Unsaved title");
    const otherWorkbookButton = dom.container.querySelectorAll<HTMLButtonElement>(".workbook-list-item")[1];
    if (!otherWorkbookButton) throw new Error("Missing second workbook selection");
    await click(otherWorkbookButton);
    expect(mocks.confirmationDialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }), undefined);
    const dialogProps = mocks.confirmationDialog.mock.lastCall?.[0] as ConfirmationDialogProps | undefined;
    if (!dialogProps?.onSecondary) throw new Error("Missing discard navigation action");
    await act(async () => { dialogProps.onSecondary?.(); });

    expect(mocks.router.push).toHaveBeenCalledWith("/workbooks?workbook=book-b");
    expect(mocks.confirmationDialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }), undefined);
  });

  it("saves and navigates from the explicit Save & leave action", async () => {
    mocks.router.push.mockClear();
    mocks.saveWorkbookAction.mockClear();
    mocks.saveWorkbookAction.mockResolvedValueOnce({ ok: true, message: "Workbook saved." });
    const otherWorkbook = { id: "book-b", name: "Second workbook", updatedAt: "2026-09-08T00:00:00Z" };
    await dom.render(<CalculationWorkbench selectedWorkbook={selected} workbooks={[selected, otherWorkbook]} isDemo={false} migrationRequired={false} />);
    await changeInput(dom.get<HTMLInputElement>("#calculation-workbook-name"), "Unsaved title");
    const otherWorkbookButton = dom.container.querySelectorAll<HTMLButtonElement>(".workbook-list-item")[1];
    if (!otherWorkbookButton) throw new Error("Missing second workbook selection");
    await click(otherWorkbookButton);
    const dialogProps = mocks.confirmationDialog.mock.lastCall?.[0] as ConfirmationDialogProps | undefined;
    if (!dialogProps?.onConfirm) throw new Error("Missing save-and-leave navigation action");

    await act(async () => {
      dialogProps.onConfirm();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(mocks.saveWorkbookAction).toHaveBeenCalledOnce();
    expect(mocks.router.push).toHaveBeenCalledWith("/workbooks?workbook=book-b");
    expect(mocks.confirmationDialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }), undefined);
  });
});
