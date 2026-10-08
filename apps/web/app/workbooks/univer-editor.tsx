"use client";

import type { createUniver, IWorkbookData } from "@univerjs/presets";
import { useEffect, useRef, useState } from "react";
import "@univerjs/preset-sheets-core/lib/index.css";

const univerModulesPromise = Promise.all([
  import("@univerjs/presets"),
  import("@univerjs/presets/preset-sheets-core/locales/en-US"),
  import("@univerjs/presets/preset-sheets-core"),
]);
void univerModulesPromise.catch(() => undefined);

type WorkbookSnapshot = Record<string, unknown>;
type SaveWorkbook = (name: string) => IWorkbookData;
type UniverApi = ReturnType<typeof createUniver>["univerAPI"];
type UniverWorkbook = ReturnType<UniverApi["createWorkbook"]>;
type UniverInstance = ReturnType<typeof createUniver>["univer"];

interface UniverEditorLifecycle {
  readonly container: HTMLDivElement;
  readonly workbookId: string;
  readonly readOnly: boolean;
  readonly univer: UniverInstance;
  readonly workbook: UniverWorkbook;
  readonly commandSubscription: { readonly dispose: () => void };
  readonly inputListeners: { readonly dispose: () => void };
  readonly save: SaveWorkbook;
  active: boolean;
  acceptsDirtyCommands: boolean;
  disposeTimer: number | null;
}

export interface UniverEditorProps {
  readonly workbookId: string;
  readonly initialName: string;
  readonly snapshot: WorkbookSnapshot;
  readonly readOnly: boolean;
  readonly onDirty: () => void;
  readonly onSaveReady: (save: SaveWorkbook | null) => void;
}

export function UniverEditor({ workbookId, initialName, snapshot, readOnly, onDirty, onSaveReady }: UniverEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workbookRef = useRef<UniverWorkbook | null>(null);
  const lifecycleRef = useRef<UniverEditorLifecycle | null>(null);
  const onDirtyRef = useRef(onDirty);
  const onSaveReadyRef = useRef(onSaveReady);
  const previousOnSaveReadyRef = useRef(onSaveReady);
  const [error, setError] = useState<string | null>(null);
  const initialWorkbookDataRef = useRef({ snapshot, initialName });

  // New server snapshots seed a newly created editor, never an active draft.
  // Update after commit, before the identity/editability lifecycle below.
  useEffect(() => {
    initialWorkbookDataRef.current = { snapshot, initialName };
  }, [snapshot, initialName]);

  useEffect(() => {
    onDirtyRef.current = onDirty;
    onSaveReadyRef.current = onSaveReady;
  }, [onDirty, onSaveReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let active = true;

    const existing = lifecycleRef.current;
    if (existing?.container === container && existing.workbookId === workbookId && existing.readOnly === readOnly) {
      if (existing.disposeTimer !== null) {
        window.clearTimeout(existing.disposeTimer);
        existing.disposeTimer = null;
      }
      existing.active = true;
      workbookRef.current = existing.workbook;
      onSaveReadyRef.current(existing.save);

      return () => {
        active = false;
        existing.active = false;
        onSaveReadyRef.current(null);
        if (workbookRef.current === existing.workbook) workbookRef.current = null;
        if (existing.disposeTimer !== null) return;
        const disposeTimer = window.setTimeout(() => {
          if (existing.disposeTimer !== disposeTimer) return;
          existing.disposeTimer = null;
          existing.inputListeners.dispose();
          existing.commandSubscription.dispose();
          existing.univer.dispose();
          if (lifecycleRef.current === existing) lifecycleRef.current = null;
        }, 0);
        existing.disposeTimer = disposeTimer;
      };
    }

    let lifecycle: UniverEditorLifecycle | null = null;
    let createdInstance: ReturnType<typeof createUniver> | null = null;

    void univerModulesPromise.then(([presets, locale, sheets]) => {
      if (!active) return;
      setError(null);
      const created = presets.createUniver({
        locale: presets.LocaleType.EN_US,
        locales: { [presets.LocaleType.EN_US]: presets.mergeLocales(locale.default) },
        presets: [sheets.UniverSheetsCorePreset({
          container,
          header: true,
          toolbar: true,
          formulaBar: true,
          footer: { sheetBar: true, statisticBar: true, menus: true, zoomSlider: true },
        })],
      });
      createdInstance = created;

      const { snapshot: initialSnapshot, initialName: name } = initialWorkbookDataRef.current;
      const workbookData = { ...(initialSnapshot as Partial<IWorkbookData>), id: workbookId, name };
      const workbook = created.univerAPI.createWorkbook(workbookData);
      if (readOnly) workbook.setEditable(false);

      const save: SaveWorkbook = (name) => {
        if (!lifecycle || !lifecycle.active) {
          const error = new Error("The calculation editor is not ready to save. Please wait a moment and try again.");
          error.name = "EditorSaveUnavailableError";
          throw error;
        }
        workbook.setName(name);
        return workbook.save();
      };
      let acceptsDirtyCommands = false;
      const markUserEdited = (): void => {
        acceptsDirtyCommands = true;
        if (lifecycle) lifecycle.acceptsDirtyCommands = true;
      };
      const commandSubscription = created.univerAPI.onCommandExecuted(() => {
        if (lifecycle?.active && !readOnly && lifecycle.acceptsDirtyCommands) onDirtyRef.current();
      });
      const inputListenerOptions = { capture: true } as const;
      container.addEventListener("pointerdown", markUserEdited, inputListenerOptions);
      container.addEventListener("keydown", markUserEdited, inputListenerOptions);
      const inputListeners = {
        dispose: () => {
          container.removeEventListener("pointerdown", markUserEdited, inputListenerOptions);
          container.removeEventListener("keydown", markUserEdited, inputListenerOptions);
        },
      };
      lifecycle = {
        container,
        workbookId,
        readOnly,
        univer: created.univer,
        workbook,
        commandSubscription,
        inputListeners,
        save,
        active: true,
        acceptsDirtyCommands,
        disposeTimer: null,
      };
      lifecycleRef.current = lifecycle;
      workbookRef.current = workbook;
      onSaveReadyRef.current(save);
    }).catch(() => {
      if (lifecycle) {
        lifecycle.active = false;
        lifecycle.inputListeners.dispose();
        lifecycle.commandSubscription.dispose();
        lifecycle.univer.dispose();
        if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
        if (workbookRef.current === lifecycle.workbook) workbookRef.current = null;
      } else {
        createdInstance?.univer.dispose();
      }
      if (!active) return;
      onSaveReadyRef.current(null);
      setError("The calculation editor could not be loaded. Refresh the page and try again.");
    });

    return () => {
      active = false;
      onSaveReadyRef.current(null);
      if (!lifecycle) return;
      lifecycle.active = false;
      if (workbookRef.current === lifecycle.workbook) workbookRef.current = null;
      // Univer owns a nested React root. Defer its root unmount until React has
      // finished the current commit, and allow React's development remount to
      // cancel this cleanup before a second Univer instance is created.
      if (lifecycle.disposeTimer !== null) return;
      const disposeTimer = window.setTimeout(() => {
        if (lifecycle?.disposeTimer !== disposeTimer) return;
        lifecycle.disposeTimer = null;
        lifecycle.inputListeners.dispose();
        lifecycle.commandSubscription.dispose();
        lifecycle.univer.dispose();
        if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      }, 0);
      lifecycle.disposeTimer = disposeTimer;
    };
  }, [readOnly, workbookId]);
  useEffect(() => {
    if (previousOnSaveReadyRef.current === onSaveReady) return;
    previousOnSaveReadyRef.current = onSaveReady;
    const lifecycle = lifecycleRef.current;
    if (lifecycle?.active) {
      onSaveReady(lifecycle.save);
    }
  }, [onSaveReady]);

  return (
    <div className="athena-univer-editor" ref={containerRef} aria-label="Calculation workbook editor">
      {error ? <div className="workbook-editor-error" role="alert">{error}</div> : null}
    </div>
  );
}
