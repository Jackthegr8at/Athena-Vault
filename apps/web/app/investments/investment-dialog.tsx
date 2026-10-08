"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";

const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

function fallbackInert(dialog: HTMLDialogElement): () => void {
  const protectedNodes = new Set<HTMLElement>();
  let current: HTMLElement | null = dialog;
  while (current && current !== document.body) {
    protectedNodes.add(current);
    current = current.parentElement;
  }
  const previousInert = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
    .filter((element) => !protectedNodes.has(element) && !dialog.contains(element))
    .map((element) => ({ element, inert: element.inert }));
  for (const { element } of previousInert) element.inert = true;
  return () => { for (const { element, inert } of previousInert) element.inert = inert; };
}

export interface InvestmentDialogProps {
  readonly backdropClassName: string;
  readonly dialogClassName: string;
  readonly titleId: string;
  readonly descriptionId?: string;
  readonly role?: "dialog" | "alertdialog";
  readonly pending?: boolean;
  readonly dismissOnBackdrop?: boolean;
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
  readonly shouldRestoreFocus?: () => boolean;
  readonly onRestoredFocus?: () => void;
  readonly onClose: () => void;
  readonly onEscape?: () => void;
  readonly children: ReactNode;
}

export function InvestmentDialog({ backdropClassName, dialogClassName, titleId, descriptionId, role = "dialog", pending = false, dismissOnBackdrop = false, restoreFocusRef, shouldRestoreFocus, onRestoredFocus, onClose, onEscape, children }: InvestmentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusTargetRef = useRef<HTMLElement | null>(null);
  const shouldRestoreFocusRef = useRef(shouldRestoreFocus);
  const onRestoredFocusRef = useRef(onRestoredFocus);

  useEffect(() => { shouldRestoreFocusRef.current = shouldRestoreFocus; onRestoredFocusRef.current = onRestoredFocus; }, [onRestoredFocus, shouldRestoreFocus]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    restoreFocusTargetRef.current = restoreFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    let nativeModal = false;
    let fallbackCleanup: (() => void) | null = null;
    if (!dialog.open) {
      try {
        if (typeof dialog.showModal === "function") { dialog.showModal(); nativeModal = true; }
        else dialog.setAttribute("open", "");
      } catch { dialog.setAttribute("open", ""); }
      if (!dialog.open) dialog.setAttribute("open", "");
      if (!nativeModal) fallbackCleanup = fallbackInert(dialog);
    }
    const focusInitial = () => (dialog.querySelector<HTMLElement>("[data-investment-dialog-initial-focus]:not([disabled])") ?? dialog.querySelector<HTMLElement>(focusableSelector))?.focus();
    const focusFrame = window.requestAnimationFrame(focusInitial);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      try { if (dialog.open && typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); } catch { dialog.removeAttribute("open"); }
      fallbackCleanup?.();
      const trigger = restoreFocusTargetRef.current;
      restoreFocusTargetRef.current = null;
      if (shouldRestoreFocusRef.current?.() === false) return;
      window.requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); onRestoredFocusRef.current?.(); });
    };
  }, [restoreFocusRef]);

  const handleNativeCancel = (event: SyntheticEvent<HTMLDialogElement>) => { event.preventDefault(); if (!pending) (onEscape ?? onClose)(); };
  const handleDialogMouseDown = (event: MouseEvent<HTMLDialogElement>) => { if (dismissOnBackdrop && event.target === event.currentTarget && !pending) onClose(); };
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector));
    if (!focusable.length) { event.preventDefault(); event.currentTarget.focus(); return; }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <dialog ref={dialogRef} className={backdropClassName} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending} tabIndex={-1} onCancel={handleNativeCancel} onMouseDown={handleDialogMouseDown} onKeyDown={handleDialogKeyDown} style={{ width: "auto", height: "auto", maxWidth: "100vw", maxHeight: "none", margin: 0, border: 0 }}><section className={dialogClassName}>{children}</section></dialog>;
}
