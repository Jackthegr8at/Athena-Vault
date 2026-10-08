import React from "react";
import { addIsoDays, createCashFlowRepository, toTorontoDateIso } from "@athena/database";
import { ModulePage } from "../../components/module-page";
import { ModuleFirstUseCard } from "../../components/module-first-use-card";
import { RECURRING_PAYMENTS_PAGE_HELP_CONTENT } from "../../components/page-help-content";
import { withAuthenticatedPageDatabase } from "../../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../../lib/server/page-help";
import { RecurringCashFlowManager, RecurringCreateHeaderAction } from "../recurring-manager";
import { InitialCashFlowIncomeSetup } from "../initial-income-setup";
import { buildRecurringPaymentsHelpSnapshot } from "../recurring-presentation";

export const dynamic = "force-dynamic";

interface RecurringCashFlowSearchParams {
  readonly first?: string | string[];
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RecurringCashFlowPage({ searchParams }: { readonly searchParams?: Promise<RecurringCashFlowSearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const firstUseRequested = firstValue(params.first) === "1";
  const todayIso = toTorontoDateIso();
  const { series, accounts, periods, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const repository = createCashFlowRepository(database);
    const [series, accounts, periods, pageHelpSeen] = await Promise.all([
      repository.listRecurringSeries(user.owner.id, { includeHistory: true, asOfIso: todayIso }),
      repository.listCashFlowAccounts(user.owner.id),
      repository.listPeriods(user.owner.id),
      hasPageHelpSeen(database, user, RECURRING_PAYMENTS_PAGE_HELP_CONTENT.pageId),
    ]);
    return { series, accounts, periods, pageHelpSeen };
  }, { requireTwoFactor: true });
  const accountOptions = accounts.map((account) => ({ id: account.id, label: `${account.name} · ${account.institution}` }));
  const hasNoActiveAccounts = accountOptions.length === 0;
  const showFirstIncomeSetup = firstUseRequested && !hasNoActiveAccounts && series.length === 0;
  const recurringPaymentsHelp = {
    content: RECURRING_PAYMENTS_PAGE_HELP_CONTENT,
    snapshot: buildRecurringPaymentsHelpSnapshot({
      series,
      accountCount: accountOptions.length,
      periodCount: periods.length,
    }),
  };
  const showRecurringCreateAction = !showFirstIncomeSetup && !(hasNoActiveAccounts && series.length === 0);

  return <ModulePage active="Cash flow" pageArtwork="cash-flow" eyebrow="Cash flow · Recurring schedules" title="Recurring payments" subtitle="Manage owner-scoped schedules, versions, exceptions, notes, and generated planned occurrences." headerAction={showRecurringCreateAction ? <RecurringCreateHeaderAction /> : undefined} help={recurringPaymentsHelp} pageHelpSeen={pageHelpSeen}>
    {showFirstIncomeSetup ? <ModuleFirstUseCard headingId="recurring-first-income-heading" title="Add your first income" description="Tell Athena Vault about the income that normally arrives in your main account. We’ll create the Cash Flow rhythm and generate planned occurrences for you." supportingText="Main account → first income → planned Cash Flow" seed="recurring-first-income">
      <InitialCashFlowIncomeSetup accountOptions={accountOptions} todayIso={todayIso} defaultThroughDate={addIsoDays(todayIso, 364)} hasExistingTimeline={periods.length > 0} />
    </ModuleFirstUseCard> : hasNoActiveAccounts && series.length === 0 ? <ModuleFirstUseCard headingId="recurring-first-account-heading" title="Add an account before scheduling movement" description="Recurring payments need an active owner-scoped account. Add one first, then return here to create a paycheque, bill, or transfer." actionHref="/accounts" actionLabel="Add account" secondaryHref="/" secondaryLabel="Back to overview" supportingText="Account → recurring movement → planned occurrences" seed="recurring-first-account" /> : <RecurringCashFlowManager series={series} accountOptions={accountOptions} todayIso={todayIso} />}
  </ModulePage>;
}
