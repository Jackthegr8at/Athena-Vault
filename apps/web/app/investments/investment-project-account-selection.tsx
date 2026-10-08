"use client";

import type { InvestmentProjectionAvailableAccountView } from "@athena/database";
import { accountLabel, cashFlowSources, money } from "./investment-calculation";

function InvestmentAccountIcon({ kind, label }: { readonly kind: string; readonly label: string }) {
  if (/wealthsimple/i.test(label)) return <span className="investment-account-option-icon is-letter" aria-hidden="true">W</span>;
  return <span className="investment-account-option-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === "registered" || kind === "rrsp" || kind === "tfsa" ? <><path d="M12 3 5 6v5c0 4.4 2.8 8.1 7 10 4.2-1.9 7-5.6 7-10V6z" /><path d="m9.5 12 1.7 1.7 3.5-3.7" /></> : kind === "other" ? <><path d="M12 3 3 10v1h18v-1z" /><path d="M6 21V11h3v10M15 21V11h3v10M3 21h18" /></> : <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M8 15h3" /></>}
  </svg></span>;
}

export function AccountSelection({
  accounts,
  selectedIds,
  onToggle,
}: {
  readonly accounts: readonly InvestmentProjectionAvailableAccountView[];
  readonly selectedIds: readonly string[];
  readonly onToggle: (account: InvestmentProjectionAvailableAccountView) => void;
}) {
  return <fieldset className="investment-account-picker">
    <legend>Portfolio accounts <span>{selectedIds.length} of {accounts.length} selected</span></legend>
    {accounts.length === 0 ? <p className="investment-empty-note">No active investment accounts are available yet. Add an investment account on the Accounts page first.</p> : <div className="investment-account-options">
      {accounts.map((account) => {
        const checked = selectedIds.includes(account.id);
        const sourceCount = cashFlowSources(account).length;
        return <label key={account.id} className={`investment-account-option ${checked ? "is-selected" : ""}`}>
          <input type="checkbox" name="investmentAccountChoice" value={account.id} checked={checked} onChange={() => onToggle(account)} />
          <span className="investment-account-option-copy">
            <strong>{accountLabel(account)}</strong>
            {account.latest ? (
              <>
                <small>Latest {money(account.latest.balanceMinor)}</small>
                <small>{account.latest.asOf}</small>
              </>
            ) : (
              <small>No saved balance snapshot</small>
            )}
            <small className={`investment-account-option-source ${sourceCount > 0 ? "is-active" : ""}`}>{sourceCount > 0 ? `${sourceCount} active Cash Flow source${sourceCount === 1 ? "" : "s"}` : account.contributionRuleCount > 0 ? `${account.contributionRuleCount} manual prefill rule${account.contributionRuleCount === 1 ? "" : "s"}` : "No active Cash Flow source"}</small>
          </span>
          <InvestmentAccountIcon kind={account.kind} label={account.name} />
        </label>;
      })}
    </div>}
  </fieldset>;
}
