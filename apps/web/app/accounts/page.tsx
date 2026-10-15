import "./accounts.css";
import Image from "next/image";
import {
  ACCOUNT_KIND_OPTIONS,
  createAccountTimelineRepository,
  toTorontoDateIso,
} from "@athena/database";
import { preload } from "react-dom";
import { CalendarDays, Landmark } from "lucide-react";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { ModulePage } from "../components/module-page";
import { ACCOUNTS_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { PageHelpDrawer } from "../components/page-help-drawer";
import type { PageHelp } from "../components/page-help-content";
import { UserMenu } from "../components/user-menu";
import { AccountCommandCenter } from "./account-command-center";
import type { AccountCommandSummary } from "./account-command-center";
import { AccountSelectedPeriodCard } from "./account-selected-period-card";
import { AccountsHeroTimeline } from "./accounts-hero-timeline";
import { AccountsMobileCockpit } from "./accounts-mobile-cockpit";
import { AccountsMobileDisclosure } from "./accounts-mobile-disclosure";
import { AccountManager } from "./account-manager";
import { buildAccountsHelpSnapshot, buildAccountsPresentation, shouldShowAccountsFirstUse, type AccountsPresentation } from "./presentation";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function accountsHref(selectedDate: string | null, showArchived: boolean, pastPeriods = 3, futurePeriods = 5): string {
  const params = new URLSearchParams();
  if (selectedDate) params.set("selected", selectedDate);
  if (showArchived) params.set("archived", "1");
  params.set("past", String(pastPeriods));
  params.set("future", String(futurePeriods));
  const query = params.toString();
  return query ? `/accounts?${query}` : "/accounts";
}

interface AccountsPageSearchParams {
  readonly selected?: string | string[];
  readonly archived?: string | string[];
  readonly past?: string | string[];
  readonly future?: string | string[];
}

function boundedCount(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 24 ? parsed : fallback;
}

function buildAccountKindSummaries(presentation: AccountsPresentation): readonly AccountCommandSummary[] {
  const selectedColumnIndex = presentation.columns.findIndex((column) => column.selected);
  return ACCOUNT_KIND_OPTIONS.map((option) => {
    const accounts = presentation.groups.flatMap((group) => group.accounts).filter((account) => account.isActive && account.kind === option.code);
    const balances = accounts.map((account) => selectedColumnIndex >= 0 ? account.cells[selectedColumnIndex]?.balanceMinor ?? null : null).filter((balance): balance is number => balance !== null);
    return {
      code: option.code,
      label: option.label,
      count: accounts.length,
      totalMinor: balances.length > 0 ? balances.reduce((sum, balance) => sum + balance, 0) : null,
    };
  }).filter((summary) => summary.count > 0);
}

function AccountsOverview({ presentation, showArchived, isAdmin, isDemo, accountKindSummaries, help, pageHelpSeen }: { readonly presentation: AccountsPresentation; readonly showArchived: boolean; readonly isAdmin: boolean; readonly isDemo: boolean; readonly accountKindSummaries: readonly AccountCommandSummary[]; readonly help: PageHelp; readonly pageHelpSeen: boolean }) {
  const selectedColumnIndex = presentation.columns.findIndex((column) => column.selected);
  const liquidGroup = presentation.groups.find((group) => group.key === "liquid");
  const liquidChangeMinor = selectedColumnIndex >= 0 ? liquidGroup?.totalDeltas[selectedColumnIndex]?.deltaMinor ?? null : null;
  const largestMovement = selectedColumnIndex >= 0
    ? presentation.groups.flatMap((group) => group.accounts.map((account) => {
      const delta = account.cells[selectedColumnIndex]?.delta;
      return delta ? { accountName: account.name, deltaMinor: delta.deltaMinor } : null;
    })).filter((movement): movement is { accountName: string; deltaMinor: number } => movement !== null).sort((left, right) => Math.abs(right.deltaMinor) - Math.abs(left.deltaMinor))[0] ?? null
    : null;

  return <>
    <section className="accounts-overview" aria-label="Accounts overview">
      <div className="accounts-overview-primary">
        <article className="accounts-overview-hero">
          {/* The optimizer's internal asset fetch lacks the trusted-proxy marker; use the preloaded URL directly. */}
          <Image src="/brand/bank.webp" alt="" width={2400} height={1111} sizes="(max-width: 720px) 82vw, 620px" className="accounts-overview-hero-art" aria-hidden="true" loading="eager" fetchPriority="high" unoptimized />
          <div className="accounts-overview-hero-content">
            <p className="eyebrow">Accounts · balances</p>
            <h1>Accounts</h1>
            <p>One owner-scoped balance timeline for all accounts.</p>
          </div>
          <AccountsHeroTimeline columns={presentation.columns} values={presentation.totalTimeline} />
        </article>
        <AccountsMobileDisclosure className="is-breakdown" eyebrow="BREAKDOWN" title="Category breakdown" meta="Switch between dollars and percentages"><AccountCommandCenter summaries={accountKindSummaries} selectedTotalMinor={presentation.selectedTotalMinor} /></AccountsMobileDisclosure>
      </div>
      <div className="accounts-overview-side">
        <div className="accounts-overview-actions"><PageHelpDrawer {...help} initialOpen={!pageHelpSeen} demoAutoOpen={isDemo} /><UserMenu isAdmin={isAdmin} isDemo={isDemo} /></div>
        <aside className="accounts-overview-summary">
          <div className="accounts-summary-row"><CalendarDays aria-hidden="true" size={17} strokeWidth={1.8} /><span>Selected payday</span><strong>{presentation.selectedDate ?? "—"}</strong></div>
          <div className="accounts-summary-row"><CalendarDays aria-hidden="true" size={17} strokeWidth={1.8} /><span>Toronto today</span><strong>{presentation.todayIso}</strong></div>
          <div className="accounts-summary-row"><Landmark aria-hidden="true" size={17} strokeWidth={1.8} /><span>Visible accounts</span><strong>{presentation.visibleAccountCount}</strong></div>
          <p className="accounts-summary-note">{presentation.activeAccountCount} active · {presentation.columns.length} paydays</p>
          <a className="account-secondary-button accounts-summary-archive" href={accountsHref(presentation.selectedDate, !showArchived, presentation.pastPeriods, presentation.futurePeriods)}>{showArchived ? "Hide archived" : "Show archived"}</a>
        </aside>
        <AccountSelectedPeriodCard selectedTotalMinor={presentation.selectedTotalMinor} liquidChangeMinor={liquidChangeMinor} largestMovement={largestMovement} />
      </div>
    </section>
  </>;
}

export default async function AccountsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<AccountsPageSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const selectedParam = firstValue(params.selected) ?? null;
  const requestedDate = selectedParam && /^\d{4}-\d{2}-\d{2}$/.test(selectedParam) ? selectedParam : null;
  const showArchived = firstValue(params.archived) === "1";
  const pastPeriods = boundedCount(firstValue(params.past), 3);
  const futurePeriods = boundedCount(firstValue(params.future), 5);
  const todayIso = toTorontoDateIso();
  const { timeline, pageHelpSeen } = await withAuthenticatedPageDatabase(async (database, user) => {
    const [timeline, pageHelpSeen] = await Promise.all([
      createAccountTimelineRepository(database).getTimelineWindow(user.owner.id, {
        includeArchived: showArchived,
        selectedDate: requestedDate ?? undefined,
        todayIso, pastPeriods, futurePeriods,
      }),
      hasPageHelpSeen(database, user, ACCOUNTS_PAGE_HELP_CONTENT.pageId),
    ]);
    return { timeline, pageHelpSeen };
  }, { requireTwoFactor: true });
  const presentation = buildAccountsPresentation(timeline, { todayIso, selectedDate: requestedDate, pastPeriods, futurePeriods });
  const isFirstUse = shouldShowAccountsFirstUse(presentation);
  const accountsHelp = {
    content: ACCOUNTS_PAGE_HELP_CONTENT,
    snapshot: buildAccountsHelpSnapshot(presentation),
  };
  if (!isFirstUse) {
    preload("/brand/bank.webp", { as: "image" });
  }
  const accountKindSummaries = buildAccountKindSummaries(presentation);
  const kindOptions = ACCOUNT_KIND_OPTIONS.map((option) => ({ code: option.code, label: option.label }));
  const mobileHref = (date: string | null): string | null => date ? accountsHref(date, showArchived, pastPeriods, futurePeriods) : null;

  return <ModulePage active="Accounts" eyebrow="Accounts · balances" title="Accounts" subtitle="One owner-scoped balance timeline for all accounts." headerMode={isFirstUse ? "default" : "content"} help={accountsHelp} pageHelpSeen={pageHelpSeen}>
    {({ isAdmin, isDemo, pageHelpSeen }) => <>
      <div className={`accounts-view${isFirstUse ? " accounts-mobile-first-use" : ""}`}>
        {isFirstUse ? <AccountManager presentation={presentation} kindOptions={kindOptions} firstUse /> : <>
          <AccountsOverview presentation={presentation} showArchived={showArchived} isAdmin={isAdmin} isDemo={isDemo} accountKindSummaries={accountKindSummaries} help={accountsHelp} pageHelpSeen={pageHelpSeen} />
          <AccountsMobileCockpit presentation={presentation} showArchived={showArchived} kindOptions={kindOptions} previousHref={mobileHref(presentation.navigation.previous)} todayHref={mobileHref(presentation.navigation.today)} nextHref={mobileHref(presentation.navigation.next)} archiveHref={accountsHref(presentation.selectedDate, !showArchived, pastPeriods, futurePeriods)} />
        </>}
      </div>
    </>}
  </ModulePage>;
}
