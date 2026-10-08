"use client";

import React from "react";

export function ScenarioIcon({ index }: { readonly index: number }) {
  return <span className={`investment-scenario-icon is-${index}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17 9 12l3 3 7-8" /><path d="M15 7h4v4" /></svg></span>;
}

export type ProjectionNoteIconName = "rates" | "contributions" | "scope" | "date";

export function ProjectionNoteIcon({ name }: { readonly name: ProjectionNoteIconName }) {
  return <span className={`investment-detail-note-icon is-${name}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {name === "rates" ? <><path d="m4 17 5-5 3 3 6-8" /><path d="M15 7h4v4" /></> : null}
    {name === "contributions" ? <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v10M15 9.5c-.7-.7-1.6-1-3-1-1.6 0-2.7.7-2.7 1.8 0 2.8 5.4 1.1 5.4 4 0 1.1-1.1 1.8-2.7 1.8-1.4 0-2.4-.4-3.1-1" /></> : null}
    {name === "scope" ? <><path d="M12 3 5 6v5c0 4.4 2.8 8.1 7 10 4.2-1.9 7-5.6 7-10V6z" /><path d="m9.5 12 1.7 1.7 3.5-3.7" /></> : null}
    {name === "date" ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="M8 14h.01M12 14h.01M16 14h.01" /></> : null}
  </svg></span>;
}

export type ProjectionDetailIconName = "bank" | "coins" | "target" | "folder" | "scale" | "notes";

export function ProjectionDetailIcon({ name }: { readonly name: ProjectionDetailIconName }) {
  return <span className="investment-detail-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {name === "bank" ? <><path d="M3 9h18M5 9v9M9 9v9M15 9v9M19 9v9M3 18h18M12 4l9 5H3z" /></> : null}
    {name === "coins" ? <><ellipse cx="9" cy="7" rx="4" ry="2" /><path d="M5 7v5c0 1.1 1.8 2 4 2s4-.9 4-2V7" /><ellipse cx="15" cy="11" rx="4" ry="2" /><path d="M11 11v5c0 1.1 1.8 2 4 2s4-.9 4-2v-5" /></> : null}
    {name === "target" ? <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m12 12 6-6M15 6h3v3" /></> : null}
    {name === "folder" ? <><path d="M3 7.5h6l1.8 2H21v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 7.5v-1a2 2 0 0 1 2-2h4l1.8 2H15" /></> : null}
    {name === "scale" ? <><path d="M12 4v15M6 19h12M4 7h16M7 7l-3 6a3 3 0 0 0 6 0zM17 7l-3 6a3 3 0 0 0 6 0z" /></> : null}
    {name === "notes" ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01" /></> : null}
  </svg></span>;
}

export function PlanningGuideIcon({ name }: { readonly name: "scenarios" | "assumptions" | "insights" }) {
  return <span className={`investment-guidance-icon is-${name}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {name === "scenarios" ? <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /><path d="M10 4v16" /></> : null}
    {name === "assumptions" ? <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="var(--surface)" /><circle cx="15" cy="12" r="2" fill="var(--surface)" /><circle cx="11" cy="17" r="2" fill="var(--surface)" /></> : null}
    {name === "insights" ? <><path d="M12 4a8 8 0 1 1-5.7 2.3" /><path d="M12 8v4l3 2" /><path d="M4 4v5h5" /></> : null}
  </svg></span>;
}
