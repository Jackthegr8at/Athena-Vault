"use client";

import React, { useEffect, useId, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

export type ConfirmationDialogTone = "default" | "danger";

export interface ConfirmationDialogAcknowledgement {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export interface ConfirmationDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | null;
  readonly secondaryLabel?: string;
  readonly tone?: ConfirmationDialogTone;
  readonly eyebrow?: string;
  readonly acknowledgement?: ConfirmationDialogAcknowledgement;
  readonly restoreFocus?: boolean;
  readonly pending?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onSecondary?: () => void;
}

/**
 * A small, reusable confirmation boundary for actions that can change data.
 * The native dialog element supplies the modal/inert behavior; the component
 * owns only presentation and focus, leaving the action contract to callers.
 */
export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  secondaryLabel,
  tone = "default",
  eyebrow = "Please confirm",
  acknowledgement,
  restoreFocus = true,
  pending = false,
  onConfirm,
  onCancel,
  onSecondary,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const acknowledgementRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [submissionState, setSubmissionState] = useState({ open, pending, submitted: false });
  if (submissionState.open !== open || submissionState.pending !== pending) {
    setSubmissionState({ open, pending, submitted: false });
  }
  const submitted = submissionState.submitted;
  const id = useId();
  const titleId = `confirmation-dialog-title-${id}`;
  const descriptionId = `confirmation-dialog-description-${id}`;
  const acknowledgementDescriptionId = `confirmation-dialog-acknowledgement-description-${id}`;
  const hasSecondaryAction = Boolean(secondaryLabel && onSecondary);
  const acknowledgementComplete = !acknowledgement || acknowledgement.checked;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Keep the component usable in environments that expose <dialog> but
        // do not implement showModal (for example, a limited test browser).
        dialog.setAttribute("open", "");
      }
    }
    window.requestAnimationFrame(() => (cancelButtonRef.current ?? acknowledgementRef.current ?? confirmButtonRef.current)?.focus());

    return () => {
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      const trigger = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restoreFocus && trigger?.isConnected) {
        window.requestAnimationFrame(() => {
          if (trigger.isConnected) trigger.focus();
        });
      }
    };
  }, [open, restoreFocus]);

  if (!open) return null;

  const busy = pending || submitted;
  const handleConfirm = () => {
    if (busy || !acknowledgementComplete) return;
    setSubmissionState((current) => ({ ...current, submitted: true }));
    onConfirm();
  };
  const handleSecondary = () => {
    if (busy || !acknowledgementComplete || !onSecondary) return;
    setSubmissionState((current) => ({ ...current, submitted: true }));
    onSecondary();
  };

  const handleNativeCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!busy && acknowledgementComplete) onCancel();
  };

  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (!busy && acknowledgementComplete && event.target === event.currentTarget) onCancel();
  };

  const dialog = <dialog
    ref={dialogRef}
    className={`confirmation-dialog confirmation-dialog--${tone}`}
    role="alertdialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    aria-busy={busy}
    onCancel={handleNativeCancel}
    onClick={handleDialogClick}
  >
    <div className="confirmation-dialog__surface" onClick={(event) => event.stopPropagation()}>
      <p className="confirmation-dialog__eyebrow">{eyebrow}</p>
      <h2 className="confirmation-dialog__title" id={titleId}>{title}</h2>
      <p className="confirmation-dialog__description" id={descriptionId}>{description}</p>
      {acknowledgement ? <label className="confirmation-dialog__acknowledgement">
        <input ref={acknowledgementRef} type="checkbox" checked={acknowledgement.checked} onChange={(event) => acknowledgement.onChange(event.target.checked)} required aria-describedby={acknowledgement.description ? acknowledgementDescriptionId : undefined} />
        <span><strong>{acknowledgement.label}</strong>{acknowledgement.description ? <small id={acknowledgementDescriptionId}>{acknowledgement.description}</small> : null}</span>
      </label> : null}
      <div className="confirmation-dialog__actions">
        {cancelLabel !== null ? <button ref={cancelButtonRef} className="account-secondary-button confirmation-dialog__cancel" type="button" onClick={onCancel} disabled={busy || !acknowledgementComplete}>{cancelLabel}</button> : null}
        {hasSecondaryAction ? <button className="account-secondary-button confirmation-dialog__secondary" type="button" onClick={handleSecondary} disabled={busy || !acknowledgementComplete}>{busy ? "Working…" : secondaryLabel}</button> : null}
        <button ref={confirmButtonRef} className={`account-primary-button confirmation-dialog__confirm${tone === "danger" ? " is-danger" : ""}`} type="button" onClick={handleConfirm} disabled={busy || !acknowledgementComplete}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  </dialog>;

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
