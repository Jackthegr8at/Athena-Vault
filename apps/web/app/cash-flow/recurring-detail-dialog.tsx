import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X, type LucideIcon } from "lucide-react";

interface RecurringDetailDialogProps {
  readonly title: string;
  readonly description: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  readonly variant?: "danger";
  readonly icon?: LucideIcon;
}

export function RecurringDetailDialog({ title, description, onClose, children, variant, icon: Icon }: RecurringDetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const titleId = `recurring-detail-dialog-title-${id}`;
  const descriptionId = `recurring-detail-dialog-description-${id}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
    };
  }, []);

  const dialog = <dialog
    ref={dialogRef}
    className="recurring-detail-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <div className={`recurring-detail-dialog-surface${variant === "danger" ? " is-danger" : ""}`} onClick={(event) => event.stopPropagation()}>
      <div className="recurring-detail-dialog-header">
        <div className="recurring-detail-dialog-header-main">
          {Icon ? <Icon aria-hidden="true" size={22} strokeWidth={1.8} className="recurring-detail-dialog-title-icon" /> : null}
          <div className="recurring-detail-dialog-header-text">
            <p className="eyebrow">Recurring series</p>
            <h2 id={titleId} className="recurring-detail-dialog-title">{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
        </div>
        <button ref={closeButtonRef} className="recurring-detail-dialog-close" type="button" onClick={onClose} aria-label="Close dialog"><X aria-hidden="true" size={18} strokeWidth={1.9} /></button>
      </div>
      <div className="recurring-detail-dialog-body">{children}</div>
    </div>
  </dialog>;

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
