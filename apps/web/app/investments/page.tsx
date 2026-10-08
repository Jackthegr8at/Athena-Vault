import React from "react";
import { preload } from "react-dom";
import { createInvestmentHoldingsRepository, createInvestmentProjectionRepository, toTorontoDateIso } from "@athena/database";
import { ModulePage } from "../components/module-page";
import { INVESTMENTS_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { InvestmentProjectManager } from "./investment-project-manager";
import { InvestmentHoldingsManager, type InvestmentHoldingInitialPosition } from "./holdings-manager";
import { buildInvestmentsHelpSnapshot } from "./presentation";

export const dynamic = "force-dynamic";

type InvestmentsSearchParams = {
  readonly symbol?: string | string[];
  readonly name?: string | string[];
  readonly instrumentType?: string | string[];
  readonly currency?: string | string[];
};

function firstSearchParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function initialPositionFromSearchParams(params: InvestmentsSearchParams): InvestmentHoldingInitialPosition | null {
  const symbol = firstSearchParam(params.symbol).toUpperCase();
  const name = firstSearchParam(params.name);
  const instrumentType = firstSearchParam(params.instrumentType);
  const currency = firstSearchParam(params.currency);
  if (!/^[A-Z0-9][A-Z0-9._-]{0,23}$/.test(symbol) || !name || name.length > 120) return null;
  if (instrumentType !== "mutual_fund" && instrumentType !== "etf") return null;
  if (currency !== "CAD" && currency !== "USD") return null;
  return { symbol, name, instrumentType, currency };
}

export default async function InvestmentsPage({ searchParams }: { readonly searchParams?: Promise<InvestmentsSearchParams> }) {
  preload("/brand/backgrounds/investments.png", { as: "image" });
  const params = searchParams ? await searchParams : {};
  const initialPosition = initialPositionFromSearchParams(params);
  const asOf = toTorontoDateIso();
  const { projection, holdings, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const [projection, holdings, pageHelpSeen] = await Promise.all([
      createInvestmentProjectionRepository(database).getPageData(user.owner.id, asOf),
      createInvestmentHoldingsRepository(database).getPageData(user.owner.id, asOf),
      hasPageHelpSeen(database, user, INVESTMENTS_PAGE_HELP_CONTENT.pageId),
    ]);
    return { projection, holdings, pageHelpSeen };
  }, { requireTwoFactor: true });
  const investmentsHelp = {
    content: INVESTMENTS_PAGE_HELP_CONTENT,
    snapshot: buildInvestmentsHelpSnapshot({
      projects: projection.projects,
      investmentAccountCount: projection.availableAccounts.length,
      rdspAccountCount: holdings.accounts.length,
      holdingCount: holdings.accounts.reduce((total, account) => total + account.holdings.length, 0),
    }),
  };

  return <ModulePage active="Investments" eyebrow="Investments  ›  Current holdings + Projection projects" title="Investments" subtitle="Manage REEI / RDSP FCP / MF and FNB / ETF holdings alongside reusable projection projects. Holdings and planning edits never change Cash Flow or Account balances." help={investmentsHelp} pageHelpSeen={pageHelpSeen} mainClassName="investments-page-main editorial-module-page">
    {holdings.accounts.length > 0 ? <InvestmentHoldingsManager {...holdings} initialPosition={initialPosition} /> : null}
    <InvestmentProjectManager {...projection} />
  </ModulePage>;
}
