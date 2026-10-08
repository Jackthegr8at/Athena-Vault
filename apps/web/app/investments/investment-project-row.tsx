"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { InvestmentProjectionProjectView } from "@athena/database";
import { isoDateLabel, money, percentFromBasisPoints } from "./investment-calculation";

export function ProjectRow({ project, onOpen, onEdit, onDelete }: {
  readonly project: InvestmentProjectionProjectView;
  readonly onOpen: (project: InvestmentProjectionProjectView) => void;
  readonly onEdit: (project: InvestmentProjectionProjectView) => void;
  readonly onDelete: (project: InvestmentProjectionProjectView) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ readonly top: number; readonly left: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `investment-project-menu-${project.id}`;

  useEffect(() => {
    if (!menuOpen) return;
    function updateMenuPosition(): void {
      const anchor = menuButtonRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 142;
      const menuHeight = menuRef.current?.offsetHeight ?? 82;
      const maxLeft = Math.max(12, window.innerWidth - menuWidth - 12);
      const left = Math.min(Math.max(12, rect.right - menuWidth), maxLeft);
      const below = rect.bottom + 6;
      const top = below + menuHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - menuHeight - 6);
      setMenuPosition((previous) => previous?.top === top && previous.left === left ? previous : { top, left });
    }
    function dismissMenu(event: PointerEvent): void {
      if (event.target instanceof Node && (menuRef.current?.contains(event.target) || menuButtonRef.current?.contains(event.target))) return;
      setMenuOpen(false);
      setMenuPosition(null);
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setMenuPosition(null);
    }
    updateMenuPosition();
    document.addEventListener("pointerdown", dismissMenu);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", dismissMenu);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  function runMenuAction(action: (project: InvestmentProjectionProjectView) => void): void {
    menuButtonRef.current?.focus();
    setMenuOpen(false);
    setMenuPosition(null);
    action(project);
  }

  function toggleMenu(): void {
    setMenuPosition(null);
    setMenuOpen((open) => !open);
  }

  const menu = menuOpen && typeof document !== "undefined"
    ? createPortal(
      <div ref={menuRef} id={menuId} className="investment-row-menu" role="menu" aria-label={`Actions for ${project.name}`} style={menuPosition ? { top: menuPosition.top, left: menuPosition.left } : { top: -10000, left: 0, visibility: "hidden" }}>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onEdit)}>Edit</button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onDelete)}>Delete</button>
      </div>,
      document.body,
    )
    : null;

  return <>
    <tr>
      <th scope="row"><button className="investment-table-link" type="button" onClick={() => onOpen(project)}>{project.name}</button><small>{project.mode === "calculator" ? "Manual calculator" : `${project.accountCount} account${project.accountCount === 1 ? "" : "s"}`} · baseline {project.baselineDate}</small></th>
      <td>{project.mode === "calculator" ? "Calculator" : "Portfolio"}</td>
      <td>{project.horizonYears} years</td>
      <td>{project.rates.map((rate) => `${percentFromBasisPoints(rate.rateBps)}%`).join(" · ") || "—"}</td>
      <td>{money(project.startingBalanceMinor)}</td>
      <td>{money(project.endingBalanceMinor)}</td>
      <td>{project.warningCount > 0 ? <span className="investment-warning-badge">Review · {project.warningCount}</span> : <span className="investment-ok-badge">Live</span>}</td>
      <td>{isoDateLabel(project.updatedAt)}</td>
      <td><div className="investment-row-actions">
        <button className="investment-secondary-button investment-table-action" type="button" onClick={() => onOpen(project)}>View</button>
        <button ref={menuButtonRef} className="investment-row-menu-button" type="button" aria-label={`More actions for ${project.name}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} onClick={toggleMenu}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r=".8" fill="currentColor" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><circle cx="19" cy="12" r=".8" fill="currentColor" /></svg>
        </button>
      </div></td>
    </tr>
    {menu}
  </>;
}
