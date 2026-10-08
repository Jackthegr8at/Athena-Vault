"use client";

import { CreditCard, Landmark, PiggyBank, Sparkle, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { formatMoneyMinor } from "../../lib/format-money";

export interface AccountCommandSummary {
  readonly code: string;
  readonly label: string;
  readonly count: number;
  readonly totalMinor: number | null;
}

type AccountCommandMode = "amount" | "percent";

export function formatAccountCommandDollars(minor: number | null): string {
  return formatMoneyMinor(minor, { unavailableLabel: "—" });
}

export function percentageOfSelectedTotal(totalMinor: number | null, selectedTotalMinor: number): string {
  if (totalMinor === null) return "—";
  if (selectedTotalMinor === 0) return "0.0%";
  const percentageTenths = Math.round((totalMinor * 1000) / selectedTotalMinor);
  const absolute = Math.abs(percentageTenths);
  return `${percentageTenths < 0 ? "-" : ""}${Math.floor(absolute / 10)}.${absolute % 10}%`;
}

function accountKindIcon(kind: string): LucideIcon {
  if (kind === "checking" || kind === "cash") return Wallet;
  if (kind === "savings") return PiggyBank;
  if (kind === "credit") return CreditCard;
  if (kind === "loan") return Landmark;
  return TrendingUp;
}

export function AccountCommandCenter({ summaries, selectedTotalMinor, headingId = "account-command-center-title" }: { readonly summaries: readonly AccountCommandSummary[]; readonly selectedTotalMinor: number; readonly headingId?: string }) {
  const [mode, setMode] = useState<AccountCommandMode>("amount");
  const showingPercent = mode === "percent";

  return <section className="account-command-center" aria-labelledby={headingId}>
    <div className="account-command-center-head">
      <div className="account-command-center-title"><span className="account-command-center-title-icon"><Sparkle aria-hidden="true" size={28} strokeWidth={1.5} /></span><div><h2 id={headingId}>Account command center</h2><p>A consolidated view of your money across all active account kinds.</p></div></div>
      <div className="account-command-center-unit" role="group" aria-label="Account total display mode">
        <button type="button" className={showingPercent ? "" : "is-active"} aria-label="Show account totals in dollars" aria-pressed={!showingPercent} onClick={() => setMode("amount")}>$</button>
        <button type="button" className={showingPercent ? "is-active" : ""} aria-label="Show account totals as percentages" aria-pressed={showingPercent} onClick={() => setMode("percent")}>%</button>
      </div>
    </div>
    <div className="account-command-grid">
      {summaries.map((summary) => {
        const Icon = accountKindIcon(summary.code);
        return <article className="account-command-card" key={summary.code}>
          <span className="account-command-icon"><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span>
          <div><strong>{summary.label}</strong><b>{showingPercent ? percentageOfSelectedTotal(summary.totalMinor, selectedTotalMinor) : formatAccountCommandDollars(summary.totalMinor)}</b><small>{summary.count} {summary.count === 1 ? "account" : "accounts"}</small></div>
        </article>;
      })}
    </div>
  </section>;
}
