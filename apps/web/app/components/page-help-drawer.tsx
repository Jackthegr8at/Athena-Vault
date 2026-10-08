"use client";

import { ArrowRight, CircleHelp, X } from "lucide-react";
import { createPortal } from "react-dom";
import React, { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from "react";
import Link from "next/link";
import type { PageHelp } from "./page-help-content";
import { markPageHelpSeen } from "./page-help-actions";

export interface PageHelpDrawerProps extends PageHelp {
  readonly initialOpen?: boolean;
  /** Demo users get a first visit in each browser instead of one shared owner visit. */
  readonly demoAutoOpen?: boolean;
}

const drawerFocusableSelector = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
const demoPageHelpStoragePrefix = "athena-vault:demo-page-help-seen:v1:";

function subscribeToHydration(): () => void {
  return () => undefined;
}

function getHydratedSnapshot(): boolean {
  return true;
}

function getServerHydrationSnapshot(): boolean {
  return false;
}

function demoPageHelpStorageKey(pageId: string): string {
  return `${demoPageHelpStoragePrefix}${pageId}`;
}

function hasDemoPageHelpBeenSeen(pageId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(demoPageHelpStorageKey(pageId)) === "1";
  } catch {
    return false;
  }
}

function markDemoPageHelpSeen(pageId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(demoPageHelpStorageKey(pageId), "1");
  } catch {
    // Private browsing or a restrictive storage policy can disable localStorage.
  }
}

export function PageHelpDrawer({ content, snapshot, initialOpen = false, demoAutoOpen = false }: PageHelpDrawerProps) {
  const isHydrated = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerHydrationSnapshot);
  const openKey = JSON.stringify([content.pageId, demoAutoOpen, initialOpen]);
  const [openState, setOpenState] = useState({ key: openKey, open: false, hydrated: false });
  const shouldAutoOpen = isHydrated && (demoAutoOpen ? !hasDemoPageHelpBeenSeen(content.pageId) : initialOpen);
  if (openState.key !== openKey || (isHydrated && !openState.hydrated)) {
    setOpenState({ key: openKey, open: openState.open || shouldAutoOpen, hydrated: isHydrated });
  }
  const open = openState.key === openKey ? openState.open : false;
  const setOpen = (nextOpen: boolean): void => setOpenState({ key: openKey, open: nextOpen, hydrated: true });
  const [, startSeenTransition] = useTransition();
  const markedPageIdRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const rawId = useId();
  const id = rawId.replace(/:/g, "");
  const dialogId = `page-help-dialog-${id}`;
  const titleId = `page-help-title-${id}`;
  const descriptionId = `page-help-description-${id}`;
  const snapshotHeadingId = `page-help-snapshot-${id}`;
  const stepsHeadingId = `page-help-steps-${id}`;

  useEffect(() => {
    if (!open || markedPageIdRef.current === content.pageId) return;
    markedPageIdRef.current = content.pageId;
    if (demoAutoOpen) markDemoPageHelpSeen(content.pageId);
    startSeenTransition(async () => {
      try {
        await markPageHelpSeen(content.pageId);
      } catch {
        if (markedPageIdRef.current === content.pageId) markedPageIdRef.current = null;
      }
    });
  }, [content.pageId, demoAutoOpen, open, startSeenTransition]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Keep the component usable in limited test browsers that expose
        // <dialog> without implementing showModal.
        dialog.setAttribute("open", "");
      }
    }

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");

      const trigger = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (trigger?.isConnected) {
        window.requestAnimationFrame(() => {
          if (trigger.isConnected) trigger.focus();
        });
      }
    };
  }, [open]);

  const openDrawer = (event: MouseEvent<HTMLButtonElement>) => {
    restoreFocusRef.current = event.currentTarget;
    setOpen(true);
  };

  const closeDrawer = () => setOpen(false);

  const handleNativeCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    closeDrawer();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(drawerFocusableSelector));
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) closeDrawer();
  };

  const dialog = (
    <dialog
      ref={dialogRef}
      id={dialogId}
      className="page-help-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={handleNativeCancel}
      onClick={handleDialogClick}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="page-help-drawer__surface" onClick={(event) => event.stopPropagation()}>
        <header className="page-help-drawer__header">
          <div>
            <p className="page-help-drawer__eyebrow">Page guide</p>
            <h2 className="page-help-drawer__title" id={titleId}>{content.title}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="page-help-drawer__close"
            type="button"
            onClick={closeDrawer}
            aria-label={`Close ${content.title}`}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.9} />
            <span>Close</span>
          </button>
        </header>

        <p className="page-help-drawer__introduction" id={descriptionId}>{content.introduction}</p>

        <section className="page-help-drawer__section" aria-labelledby={snapshotHeadingId}>
          <h3 className="page-help-drawer__section-title" id={snapshotHeadingId}>At a glance</h3>
          <dl className="page-help-drawer__snapshot">
            {snapshot.items.map((item, index) => (
              <div className="page-help-drawer__snapshot-item" key={`${item.label}-${index}`}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="page-help-drawer__section" aria-labelledby={stepsHeadingId}>
          <h3 className="page-help-drawer__section-title" id={stepsHeadingId}>How it works</h3>
          <ol className="page-help-drawer__steps">
            {content.steps.map((step, index) => (
              <li key={`${step}-${index}`}>
                <span className="page-help-drawer__step-marker" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span className="page-help-drawer__step-copy">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="page-help-drawer__action">
          <p className="page-help-drawer__action-label">Recommended next step</p>
          <Link className="account-primary-button page-help-drawer__action-link" href={snapshot.action.href} onClick={closeDrawer}>
            <span>{snapshot.action.label}</span>
            <ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} />
          </Link>
        </div>
      </div>
    </dialog>
  );

  return (
    <>
      <button
        className="page-help-trigger"
        type="button"
        aria-label={content.triggerLabel}
        aria-controls={dialogId}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={content.triggerLabel}
        onClick={openDrawer}
      >
        <CircleHelp aria-hidden="true" size={19} strokeWidth={1.8} />
      </button>
      {open ? (typeof document === "undefined" ? dialog : createPortal(dialog, document.body)) : null}
    </>
  );
}
