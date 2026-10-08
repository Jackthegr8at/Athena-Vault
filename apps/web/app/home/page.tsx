import "./home.css";
import { preload } from "react-dom";
import { createAccountRepository, createCashFlowRepository, createHomeRepository, createHouseholdRepository, toTorontoDateIso } from "@athena/database";
import { DataTable, ModulePage } from "../components/module-page";
import { HOME_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { MaintenanceManager } from "./maintenance-manager";
import { HouseholdExpensesManager } from "./household-expenses-manager";
import { HomePropertyManager } from "./property-manager";
import { HomeOverviewTop } from "./home-overview-top";
import { HomeMobileDisclosure } from "./home-mobile-disclosure";
import { buildHomeHelpSnapshot, buildHouseholdPresentation, shouldShowHomeFirstUse } from "./presentation";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { formatMoneyMinor } from "../../lib/format-money";

export const dynamic = "force-dynamic";

const dollars = (minor: number) => formatMoneyMinor(minor);
const displayDate = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)) : "No date";

export default async function HomePage() {
  preload("/brand/athena-vault-background-home.svg", { as: "image" });
  preload("/brand/athena-vault-background-mountains-houses.png", { as: "image" });
  preload("/brand/backgrounds/home.png", { as: "image" });
  const { expenses, liabilities, maintenanceItems, maintenanceSummary, accounts, home, householdCashFlowLinks, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const household = createHouseholdRepository(database);
    const cashFlowRepository = createCashFlowRepository(database);
    const [expenses, liabilities, maintenanceItems, maintenanceSummary, accounts, home, householdCashFlowLinks, pageHelpSeen] = await Promise.all([
      household.listExpenses(user.owner.id),
      household.listLiabilities(user.owner.id),
      household.listMaintenanceItems(user.owner.id),
      household.getMaintenanceSummary(user.owner.id),
      createAccountRepository(database).listWithLatestBalances(user.owner.id),
      createHomeRepository(database).getHome(user.owner.id),
      cashFlowRepository.listHomeHouseholdCashFlowLinks(user.owner.id),
      hasPageHelpSeen(database, user, HOME_PAGE_HELP_CONTENT.pageId),
    ]);
    return { expenses, liabilities, maintenanceItems, maintenanceSummary, accounts, home, householdCashFlowLinks, pageHelpSeen };
  }, { requireTwoFactor: true });
  const accountOptions = accounts.filter((account) => account.isActive).map((account) => ({ id: account.id, name: account.name, institution: account.institution }));
  const paymentExpenses = expenses.filter((expense) => expense.isActive && expense.frequency === "biweekly").map(({ id, name, amountMinor }) => ({ id, name, amountMinor }));
  const { monthlyMinor, biweeklyMinor, annualMinor } = buildHouseholdPresentation(expenses, maintenanceSummary);
  const liabilityMinor = liabilities.reduce((sum, liability) => sum + liability.currentBalanceMinor, 0);
  const todayIso = toTorontoDateIso();
  const activeExpenseCount = expenses.filter((expense) => expense.isActive).length;
  const currentHomeTimeline = home ? [...home.timeline].reverse().find((row) => row.asOf <= todayIso) ?? home.timeline.at(-1) ?? null : null;
  const latestPropertyValueMinor = home?.values.at(-1)?.marketValueMinor ?? null;
  const latestMortgageTerm = home?.mortgageTerms.at(-1) ?? null;
  const activeHouseholdCashFlowLink = householdCashFlowLinks.find((link) => link.seriesState !== "ended") ?? null;
  const householdCashFlowHref = activeHouseholdCashFlowLink ? `/cash-flow/recurring#recurring-series-${activeHouseholdCashFlowLink.seriesId}` : "/cash-flow";
  const homeHelp = {
    content: HOME_PAGE_HELP_CONTENT,
    snapshot: buildHomeHelpSnapshot({
      hasHome: home !== null,
      propertyValueCount: home?.values.length ?? 0,
      activeExpenseCount,
      maintenanceItemCount: maintenanceItems.length,
      hasActiveHouseholdCashFlowLink: activeHouseholdCashFlowLink !== null,
    }),
  };
  const isFirstUse = shouldShowHomeFirstUse({
    hasHome: home !== null,
    activeExpenseCount,
    maintenanceItemCount: maintenanceItems.length,
    liabilityCount: liabilities.length,
    hasActiveHouseholdCashFlowLink: activeHouseholdCashFlowLink !== null,
  });

  if (isFirstUse) {
    return <ModulePage active="Home" mainClassName="home-page editorial-module-page" eyebrow="Home · Property and household data" title="Home" subtitle="Property value, mortgage terms, and household cash-flow sources are owner-scoped in the Database." help={homeHelp} pageHelpSeen={pageHelpSeen}>
      <HomePropertyManager home={home} paymentExpenses={paymentExpenses} todayIso={todayIso} firstUse />
    </ModulePage>;
  }

  return <ModulePage active="Home" mainClassName="home-page editorial-module-page" eyebrow="Home · Property and household data" title="Home" subtitle="Property value, mortgage terms, and household cash-flow sources are owner-scoped in the Database." help={homeHelp} pageHelpSeen={pageHelpSeen}>
    <HomeOverviewTop
      monthlyMinor={monthlyMinor}
      biweeklyMinor={biweeklyMinor}
      annualMinor={annualMinor}
      homeEquityMinor={home?.currentEquityMinor ?? null}
      latestPropertyValueMinor={latestPropertyValueMinor}
      mortgageBalanceMinor={currentHomeTimeline?.mortgagePrincipalMinor ?? null}
      mortgageStatus={currentHomeTimeline?.mortgageStatus ?? null}
      mortgageTerm={latestMortgageTerm}
      liabilityMinor={liabilityMinor}
      cashFlowHref={householdCashFlowHref}
      cashFlowLinked={Boolean(activeHouseholdCashFlowLink)}
      householdCashFlowLinks={householdCashFlowLinks}
      householdCashFlowAccounts={accountOptions}
      todayIso={todayIso}
    />
    <HomeMobileDisclosure eyebrow="Recurring costs" title="Household expenses" meta={`${activeExpenseCount} active`}>
      <HouseholdExpensesManager expenses={expenses} accounts={accountOptions} />
    </HomeMobileDisclosure>
    <HomeMobileDisclosure eyebrow="Reserves" title="Annual maintenance" meta={`${maintenanceItems.length} items`}>
      <MaintenanceManager
        items={maintenanceItems.map(({ id, name, amountMinor, frequency, annualizedAmountMinor }) => ({ id, name, amountMinor, frequency, annualizedAmountMinor }))}
        summary={maintenanceSummary ? { amountMinor: maintenanceSummary.amountMinor, annualAmountMinor: maintenanceSummary.annualAmountMinor } : null}
      />
    </HomeMobileDisclosure>
      <HomePropertyManager home={home} paymentExpenses={paymentExpenses} todayIso={todayIso} />
    {liabilities.length > 0 ? <HomeMobileDisclosure eyebrow="Reference data" title="Other liabilities" meta={`${liabilities.length} linked`}>
      <section className="home-section"><div className="card section-card"><div className="card-head"><div><h3 className="card-title">Other imported liabilities</h3><p className="card-subtitle">Legacy workbook liabilities remain reference data; the Home mortgage lives only in the Home domain.</p></div></div>{liabilities.length > 0 ? <div className="home-table-spacing"><DataTable headers={["Liability", "Lender", "Kind", "Current balance", "Minimum payment", "As of"]} rows={liabilities.map((liability) => [liability.name, liability.lender ?? "Unspecified", liability.kind, dollars(liability.currentBalanceMinor), dollars(liability.minimumPaymentMinor), displayDate(liability.asOf)])} /></div> : <div className="insight"><strong>No other liabilities mapped confidently.</strong> Mortgage principal is not copied into this legacy table.</div>}</div></section>
    </HomeMobileDisclosure> : null}
  </ModulePage>;
}
