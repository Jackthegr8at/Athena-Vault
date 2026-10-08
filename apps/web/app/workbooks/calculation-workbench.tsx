"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Calculator, FileSpreadsheet, LockKeyhole, Maximize2, Minimize2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import {
  createCalculationWorkbookAction,
  deleteCalculationWorkbookAction,
  saveCalculationWorkbookAction,
} from "./actions";
import { resolveWorkbookNavigationHref } from "./workbook-navigation";

const UniverEditor = dynamic(() => import("./univer-editor").then((module) => module.UniverEditor), {
  ssr: false,
  loading: () => <div className="workbook-editor-loading">Loading the calculation editor…</div>,
});

export interface CalculationWorkbookSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

type WorkbookSnapshotState =
  | { readonly kind: "loading"; readonly workbookId: string | null }
  | { readonly kind: "error"; readonly workbookId: string }
  | { readonly kind: "ready"; readonly workbookId: string; readonly snapshot: Record<string, unknown> };

interface CalculationWorkbenchProps {
  readonly workbooks: readonly CalculationWorkbookSummary[];
  readonly selectedWorkbook: CalculationWorkbookSummary | null;
  readonly isDemo: boolean;
  readonly migrationRequired: boolean;
}

type SaveWorkbook = (name: string) => Record<string, unknown>;
type WorkbookStatus = "saved" | "dirty" | "saving" | "error";
interface PendingNavigation {
  readonly href: string;
}

function workbookActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message === "An unexpected response was received from the server.") {
    return "The workbook request was rejected. Refresh the page and use the configured local app address, then try again.";
  }
  return fallback;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(date);
}

export function CalculationWorkbench({ workbooks, selectedWorkbook, isDemo, migrationRequired }: CalculationWorkbenchProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(selectedWorkbook?.name ?? "");
  const [status, setStatus] = useState<WorkbookStatus>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullPage, setIsFullPage] = useState(false);
  const [fullPageError, setFullPageError] = useState<string | null>(null);
  const saveWorkbookRef = useRef<SaveWorkbook | null>(null);
  const workbookEditorRef = useRef<HTMLDivElement>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [snapshotState, setSnapshotState] = useState<WorkbookSnapshotState>({ kind: "loading", workbookId: selectedWorkbook?.id ?? null });
  const selectedWorkbookId = selectedWorkbook?.id ?? null;
  const selectedWorkbookName = selectedWorkbook?.name ?? "";
  const previousWorkbookIdRef = useRef(selectedWorkbookId);
  const currentSnapshotState = snapshotState.workbookId === selectedWorkbookId
    ? snapshotState
    : { kind: "loading" as const, workbookId: selectedWorkbookId };
  useEffect(() => {
    // A save/refresh may change the persisted name without changing workbooks.
    // Keep the draft, dirty state, and live save callback in that case.
    if (previousWorkbookIdRef.current === selectedWorkbookId) return;
    previousWorkbookIdRef.current = selectedWorkbookId;
    setName(selectedWorkbookName);
    setStatus("saved");
    setHasUnsavedChanges(false);
    setMessage(null);
    setIsExpanded(false);
    setIsFullPage(false);
    setFullPageError(null);
    saveWorkbookRef.current = null;
    setEditorReady(false);
    if (document.fullscreenElement === workbookEditorRef.current) void document.exitFullscreen().catch(() => undefined);
  }, [selectedWorkbookId, selectedWorkbookName]);
  useEffect(() => {
    // The snapshot travels through the owner-scoped API route instead of the
    // page payload so switching workbooks never serializes every sheet twice.
    if (!selectedWorkbookId) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/workbooks/${encodeURIComponent(selectedWorkbookId)}/snapshot`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Workbook snapshot request failed with status ${response.status}.`);
        const body = (await response.json()) as { readonly snapshot?: unknown };
        if (!body || typeof body !== "object" || !body.snapshot || typeof body.snapshot !== "object") {
          throw new Error("Workbook snapshot response was malformed.");
        }
        if (!controller.signal.aborted) setSnapshotState({ kind: "ready", workbookId: selectedWorkbookId, snapshot: body.snapshot as Record<string, unknown> });
      } catch {
        if (!controller.signal.aborted) setSnapshotState({ kind: "error", workbookId: selectedWorkbookId });
      }
    })();
    return () => controller.abort();
  }, [selectedWorkbookId]);
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    function handleDocumentClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = resolveWorkbookNavigationHref({
        href: anchor.href,
        currentHref: window.location.href,
        button: event.button,
        defaultPrevented: event.defaultPrevented,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target: anchor.target,
        download: anchor.hasAttribute("download"),
      });
      if (!href) return;
      event.preventDefault();
      setPendingNavigation({ href });
    }

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);
  useEffect(() => {
    function handleFullscreenChange(): void {
      const active = document.fullscreenElement === workbookEditorRef.current;
      setIsFullPage(active);
      if (active) setFullPageError(null);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);


  async function toggleFullPage(): Promise<void> {
    const editor = workbookEditorRef.current;
    if (!editor) return;

    setFullPageError(null);
    try {
      if (document.fullscreenElement === editor) {
        await document.exitFullscreen();
      } else {
        await editor.requestFullscreen();
      }
    } catch {
      setFullPageError("Full-page mode is unavailable. Check your browser permissions and try again.");
    }
  }

  function navigateTo(href: string): void {
    if (hasUnsavedChanges) {
      setPendingNavigation({ href });
      return;
    }
    router.push(href);
  }

  function selectWorkbook(workbookId: string): void {
    if (selectedWorkbook?.id === workbookId) return;
    navigateTo(`/workbooks?workbook=${encodeURIComponent(workbookId)}`);
  }

  function createWorkbook(): void {
    if (isDemo || migrationRequired) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await createCalculationWorkbookAction();
        if (!result.ok) {
          setStatus("error");
          setMessage(result.message);
          return;
        }
        router.push(`/workbooks?workbook=${encodeURIComponent(result.workbook.id)}`);
      } catch (error) {
        setStatus("error");
        setMessage(workbookActionErrorMessage(error, "The workbook could not be created. Please try again."));
      }
    });
  }

  async function persistWorkbook({ refresh }: { readonly refresh: boolean }): Promise<boolean> {
    if (isDemo || migrationRequired || !selectedWorkbook) return false;
    const workbookName = name.trim();
    if (!workbookName) {
      setStatus("error");
      setMessage("Enter a workbook name before saving.");
      setHasUnsavedChanges(true);
      return false;
    }
    const save = saveWorkbookRef.current;
    if (!save) {
      setStatus("error");
      setMessage("The calculation editor is not ready to save. Please wait a moment and try again.");
      setHasUnsavedChanges(true);
      return false;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const snapshot = save(workbookName);
      const result = await saveCalculationWorkbookAction({ id: selectedWorkbook.id, name: workbookName, snapshot });
      if (!result.ok) {
        setStatus("error");
        setMessage(result.message);
        setHasUnsavedChanges(true);
        return false;
      }
      setStatus("saved");
      setHasUnsavedChanges(false);
      setMessage("Saved just now.");
      if (refresh) router.refresh();
      return true;
    } catch (error) {
      setStatus("error");
      if (error instanceof Error && error.name === "EditorSaveUnavailableError") {
        setMessage(error.message);
      } else {
        setMessage(workbookActionErrorMessage(error, "The workbook could not be saved. Please try again."));
      }
      setHasUnsavedChanges(true);
      return false;
    }
  }

  function saveWorkbook(): void {
    startTransition(async () => {
      await persistWorkbook({ refresh: true });
    });
  }
  function saveAndLeave(): void {
    const destination = pendingNavigation;
    if (!destination) return;
    startTransition(async () => {
      const saved = await persistWorkbook({ refresh: false });
      if (!saved) return;
      setPendingNavigation(null);
      router.push(destination.href);
    });
  }

  function leaveWithoutSaving(): void {
    const destination = pendingNavigation;
    if (!destination) return;
    setHasUnsavedChanges(false);
    setPendingNavigation(null);
    router.push(destination.href);
  }

  function stayOnWorkbook(): void {
    setPendingNavigation(null);
  }

  function deleteWorkbook(): void {
    if (isDemo || migrationRequired || !selectedWorkbook || !window.confirm(`Delete “${selectedWorkbook.name}”? This cannot be undone.`)) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await deleteCalculationWorkbookAction({ id: selectedWorkbook.id });
        if (!result.ok) {
          setStatus("error");
          setMessage(result.message);
          return;
        }
        router.push("/workbooks");
      } catch (error) {
        setStatus("error");
        setMessage(workbookActionErrorMessage(error, "The workbook could not be deleted. Please try again."));
      }
    });
  }

  return (
    <section className="workbook-page" aria-label="Calculation workbench">
      <div className="workbook-intro card editorial-page-art-surface">
        <div className="workbook-intro-icon" aria-hidden="true"><Calculator size={22} strokeWidth={1.8} /></div>
        <div>
          <p className="eyebrow">Private scratch space</p>
          <h3>Formulas, notes, and what-if calculations</h3>
          <p>Use a familiar spreadsheet for calculations that do not belong in your financial records. Paste a selected range from Excel or another sheet; values, formulas, and formatting come across with the range.</p>
        </div>
        <div className="workbook-intro-boundary"><LockKeyhole size={16} aria-hidden="true" /><span>Separate from Athena data</span></div>
      </div>
      <div className={`workbook-shell ${isExpanded ? "is-expanded" : ""}`}>
        <aside className="workbook-sidebar card" aria-label="Saved workbooks">
          <div className="workbook-sidebar-head">
            <div>
              <p className="eyebrow">Your workbooks</p>
              <p className="workbook-sidebar-count">{workbooks.length} saved {workbooks.length === 1 ? "workbook" : "workbooks"}</p>
            </div>
            <button type="button" className="workbook-add-button" onClick={createWorkbook} disabled={isDemo || migrationRequired || isPending} aria-label="Create workbook" title={isDemo ? "The demo is read-only" : migrationRequired ? "Apply the latest database migration first" : "Create workbook"}>
              <Plus size={17} aria-hidden="true" />
            </button>
          </div>

          {isDemo ? <p className="workbook-demo-note"><LockKeyhole size={14} aria-hidden="true" /> Demo workbooks are read-only.</p> : null}
          {migrationRequired ? <p className="workbook-migration-note" role="status"><LockKeyhole size={14} aria-hidden="true" /> Apply the latest local database migration to save workbooks.</p> : null}

          <div className="workbook-list">
            {workbooks.map((workbook) => (
              <button
                type="button"
                key={workbook.id}
                className={`workbook-list-item ${selectedWorkbook?.id === workbook.id ? "is-selected" : ""}`}
                onClick={() => selectWorkbook(workbook.id)}
                aria-current={selectedWorkbook?.id === workbook.id ? "page" : undefined}
              >
                <span className="workbook-list-item-icon" aria-hidden="true"><FileSpreadsheet size={17} strokeWidth={1.8} /></span>
                <span className="workbook-list-item-copy"><strong>{workbook.name}</strong><small>{formatUpdatedAt(workbook.updatedAt)}</small></span>
              </button>
            ))}
          </div>

          {!workbooks.length ? <div className="workbook-sidebar-empty"><FileSpreadsheet size={25} aria-hidden="true" /><p>{migrationRequired ? "Saved workbooks are unavailable until the database is updated." : "Your saved workbooks will appear here."}</p></div> : null}
        </aside>

        <div ref={workbookEditorRef} className="workbook-editor-shell card">
          {selectedWorkbook ? (
            <>
              <header className="workbook-editor-head">
                <div className="workbook-title-field">
                  <label htmlFor="calculation-workbook-name">Workbook name</label>
                  <input
                    id="calculation-workbook-name"
                    value={name}
                    onChange={(event) => { setName(event.target.value); setHasUnsavedChanges(true); setStatus("dirty"); setMessage(null); }}
                    maxLength={80}
                    disabled={isDemo || isPending}
                  />
                </div>
                <div className="workbook-editor-actions">
                  <span className={`workbook-save-state is-${status}`} aria-live="polite">
                    {status === "saving" ? "Saving…" : status === "dirty" ? "Unsaved changes" : status === "error" ? message ?? "Not saved" : message ?? "Saved"}
                  </span>
                  <button type="button" className="workbook-full-page-button" onClick={() => { void toggleFullPage(); }} aria-pressed={isFullPage} aria-label={isFullPage ? "Exit full page" : "Full page"} title={isFullPage ? "Exit full page" : "Full page"}>
                    {isFullPage ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                    <span>{isFullPage ? "Exit full page" : "Full page"}</span>
                  </button>
                  <button type="button" className="workbook-expand-button" onClick={() => setIsExpanded((expanded) => !expanded)} aria-expanded={isExpanded} aria-pressed={isExpanded} aria-label={isExpanded ? "Restore workbook size" : "Expand workbook"} title={isExpanded ? "Restore workbook size" : "Expand workbook"}>
                    {isExpanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                  </button>
                  {!isDemo && !migrationRequired ? <button type="button" className="workbook-save-button" onClick={saveWorkbook} disabled={isPending || !editorReady || !name.trim()}><Save size={16} aria-hidden="true" />Save</button> : null}
                  {!isDemo && !migrationRequired ? <button type="button" className="workbook-delete-button" onClick={deleteWorkbook} disabled={isPending} aria-label="Delete workbook" title="Delete workbook"><Trash2 size={16} aria-hidden="true" /></button> : null}
                  {fullPageError ? <span className="workbook-full-page-error" role="status">{fullPageError}</span> : null}
                </div>
              </header>
              <div className="workbook-editor-meta"><span>Last saved {formatUpdatedAt(selectedWorkbook.updatedAt)}</span><span>Excel range paste is supported</span></div>
              <div className="workbook-editor-frame">
                {currentSnapshotState.kind === "ready" ? (
                  <UniverEditor
                    key={selectedWorkbook.id}
                    workbookId={selectedWorkbook.id}
                    initialName={selectedWorkbook.name}
                    snapshot={currentSnapshotState.snapshot}
                    readOnly={isDemo}
                    onDirty={() => { if (!isDemo) { setHasUnsavedChanges(true); setStatus("dirty"); setMessage(null); } }}
                    onSaveReady={(save) => { saveWorkbookRef.current = save as SaveWorkbook | null; setEditorReady(save !== null); }}
                  />
                ) : currentSnapshotState.kind === "error" ? (
                  <div className="athena-univer-editor">
                    <div className="workbook-editor-error" role="alert">The workbook could not be loaded. Refresh the page and try again.</div>
                  </div>
                ) : (
                  <div className="workbook-editor-loading">Loading the calculation editor…</div>
                )}
              </div>
            </>
          ) : (
            <div className="workbook-empty-state">
              <div className="workbook-empty-icon" aria-hidden="true"><Calculator size={30} strokeWidth={1.6} /></div>
              <p className="eyebrow">Calculation workbench</p>
              <h3>{migrationRequired ? "Update the local database" : "Start a private workbook"}</h3>
              <p>{migrationRequired ? "The workbench is ready, but saved workbooks need the latest additive database migration first." : "Create a saved sheet for formulas, comparisons, and temporary planning. It stays outside Accounts, Cash Flow, Annual Expenses, and Investments."}</p>
              <button type="button" className="account-primary-button" onClick={createWorkbook} disabled={isDemo || migrationRequired || isPending}><Plus size={17} aria-hidden="true" />{isDemo ? "Read-only demo" : migrationRequired ? "Database migration required" : "Create workbook"}</button>
              {status === "error" && message ? <p className="workbook-action-error" role="alert">{message}</p> : null}
            </div>
          )}
        </div>
      </div>
      <p className="workbook-footnote">This first version saves Univer’s workbook snapshot. Excel file upload and download are planned separately; the browser clipboard already supports selected Excel ranges.</p>
      <ConfirmationDialog
        open={pendingNavigation !== null}
        title="Save workbook changes before leaving?"
        description="This workbook has unsaved changes. Save them before you leave, or continue without saving."
        confirmLabel="Save & leave"
        cancelLabel="Stay"
        secondaryLabel="Leave without saving"
        pending={isPending}
        onConfirm={saveAndLeave}
        onCancel={stayOnWorkbook}
        onSecondary={leaveWithoutSaving}
      />
    </section>
  );
}
