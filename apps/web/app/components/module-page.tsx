import { AppMobileNav } from "./app-mobile-nav";
import { AppSidebar } from "./app-shell";
import { getAuthenticatedUser } from "../../lib/server/auth-session";
import { getServerDatabase } from "../../lib/server/database";
import { getPrimaryOwnerId } from "../../lib/server/auth-setup";
import { PageHelpDrawer } from "./page-help-drawer";
import type { PageHelp } from "./page-help-content";
import { UserMenu } from "./user-menu";

type ModulePageChild = React.ReactNode | ((context: { readonly isAdmin: boolean; readonly isDemo: boolean; readonly pageHelpSeen: boolean }) => React.ReactNode);

export type ModulePageArtwork = "overview" | "cash-flow" | "salaries" | "shared-expenses" | "workbooks";

export type ModulePageProps = {
  readonly active: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly mainClassName?: string;
  readonly pageArtwork?: ModulePageArtwork;
  readonly headerMode?: "default" | "content";
  readonly headerAction?: React.ReactNode;
  readonly children: ModulePageChild;
} & (
  | { readonly help?: undefined; readonly pageHelpSeen?: undefined }
  | { readonly help: PageHelp; readonly pageHelpSeen: boolean }
);

export async function ModulePage({ active, eyebrow, title, subtitle, mainClassName, pageArtwork, headerMode = "default", headerAction, help, pageHelpSeen = true, children }: ModulePageProps) {
  const [user, primaryId] = await Promise.all([getAuthenticatedUser(), getPrimaryOwnerId(getServerDatabase())]);
  const isAdmin = user?.authUserId === primaryId;
  const isDemo = user?.owner.isDemo ?? false;
  const content = typeof children === "function" ? children({ isAdmin, isDemo, pageHelpSeen }) : children;
  const artwork = !mainClassName && active !== "Accounts" ? pageArtwork ?? "overview" : null;
  const mainClasses = ["main", mainClassName, artwork ? "module-page-art" : "", artwork ? `module-page-art-${artwork}` : ""].filter(Boolean).join(" ");
  return <div className={`app-shell ${active === "Home" ? "home-shell" : ""} ${active === "Accounts" ? "accounts-shell" : ""} ${active === "Settings" ? "settings-shell" : ""}`}><AppSidebar active={active} /><main className={mainClasses}>{headerMode === "default" ? <header className="topbar"><div className="topbar-copy"><div className="eyebrow">{eyebrow}</div><h2 className="page-title">{title}</h2><div className="topbar-subtitle-row"><p className="card-subtitle" style={{ fontSize: 14, marginTop: 10 }}>{subtitle}</p>{headerAction ? <div className="topbar-header-action">{headerAction}</div> : null}</div></div><div className="top-actions">{help ? <PageHelpDrawer {...help} initialOpen={!pageHelpSeen} demoAutoOpen={isDemo} /> : null}<UserMenu isAdmin={isAdmin} isDemo={isDemo} /></div></header> : null}{content}</main><AppMobileNav active={active} isAdmin={isAdmin} isDemo={isDemo} /></div>;
}

const containsNumericGlyph = /\d/;

export function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) { return <div className="card section-card data-table-wrap"><table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{headers.map((header) => <th key={header} style={{ textAlign: "left", padding: "0 12px 14px", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`} style={{ borderTop: "1px solid var(--line)" }}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`} className={containsNumericGlyph.test(cell) ? "data-table-numeric" : undefined} data-label={headers[cellIndex]} style={{ padding: "15px 12px", fontSize: 13, fontWeight: cellIndex === 0 ? 700 : 500, color: cellIndex > 0 && cell.startsWith("-") ? "#a55c50" : "var(--ink)" }}>{cell}</td>)}</tr>)}</tbody></table></div>; }
