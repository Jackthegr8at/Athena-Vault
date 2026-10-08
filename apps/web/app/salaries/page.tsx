import "./salaries.css";
import React from "react";
import { preload } from "react-dom";
import { createSalaryTrackingRepository, toTorontoDateIso, type SalaryYearView } from "@athena/database";
import { ModulePage } from "../components/module-page";
import { SALARIES_PAGE_HELP_CONTENT } from "../components/page-help-content";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { hasPageHelpSeen } from "../../lib/server/page-help";
import { SalariesManager, type SalarySnapshotPresentation, type SalaryYearPresentation } from "./salaries-manager";
import { buildSalariesHelpSnapshot } from "./presentation";

export const dynamic = "force-dynamic";

interface SalariesSearchParams {
  readonly year?: string | string[];
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function presentation(snapshot: SalaryYearView["snapshots"][number]): SalarySnapshotPresentation {
  return {
    id: snapshot.id,
    salaryYearId: snapshot.salaryYearId,
    snapshotOn: snapshot.snapshotOn,
    federalCumulativeMinor: snapshot.federalCumulativeMinor,
    provincialCumulativeMinor: snapshot.provincialCumulativeMinor,
    completedPayNumber: snapshot.completedPayNumber,
    completedPayNumberOverride: snapshot.completedPayNumberOverride,
    rrqContributionYtdMinor: snapshot.rrqContributionYtdMinor,
    note: snapshot.note,
    federalDeltaMinor: snapshot.federalDeltaMinor,
    provincialDeltaMinor: snapshot.provincialDeltaMinor,
    federalProjectedYearEndMinor: snapshot.federalProjectedYearEndMinor,
    provincialProjectedYearEndMinor: snapshot.provincialProjectedYearEndMinor,
  };
}

function yearPresentation(year: SalaryYearView): SalaryYearPresentation {
  const snapshots = year.snapshots.map(presentation);
  return {
    id: year.id,
    taxYear: year.taxYear,
    annualBaseMinor: year.annualBaseMinor,
    status: year.status,
    finalFederalMinor: year.finalFederalMinor,
    payPeriodsPerYearOverride: year.payPeriodsPerYearOverride,
    totalPayPeriods: year.totalPayPeriods,
    paydayAnchorOn: year.paydayAnchorOn,
    note: year.note,
    snapshots,
    latestSnapshot: snapshots.at(-1) ?? null,
    federalCumulativeMinor: year.federalCumulativeMinor,
    provincialCumulativeMinor: year.provincialCumulativeMinor,
    federalProjectedYearEndMinor: year.federalProjectedYearEndMinor,
    provincialProjectedYearEndMinor: year.provincialProjectedYearEndMinor,
    federalVarianceToBaseMinor: year.federalVarianceToBaseMinor,
    rrqContributionTracker: year.rrqContributionTracker,
  };
}

function availableYears(years: readonly SalaryYearPresentation[], currentYear: number): readonly number[] {
  const firstYear = Math.min(currentYear - 2, ...years.map((year) => year.taxYear));
  return Array.from({ length: currentYear + 2 - firstYear }, (_, index) => firstYear + index);
}

function selectedYear(value: string | undefined, years: readonly number[], currentYear: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && years.includes(parsed) ? parsed : currentYear;
}

export default async function SalariesPage({ searchParams }: { readonly searchParams?: Promise<SalariesSearchParams> }) {
  preload("/brand/back_7.png", { as: "image" });
  const params = searchParams ? await searchParams : {};
  const { years, pageHelpSeen, preferenceScope } = await withAuthenticatedPageDatabase(async (database, user) => {
    const [years, pageHelpSeen] = await Promise.all([
      createSalaryTrackingRepository(database).listByOwner(user.owner.id),
      hasPageHelpSeen(database, user, SALARIES_PAGE_HELP_CONTENT.pageId),
    ]);
    return { years: years.map(yearPresentation), pageHelpSeen, preferenceScope: user.authUserId };
  }, { requireTwoFactor: true });
  const currentYear = Number(toTorontoDateIso().slice(0, 4));
  const yearsForSelector = availableYears(years, currentYear);
  const taxYear = selectedYear(firstValue(params.year), yearsForSelector, currentYear);
  const selected = years.find((year) => year.taxYear === taxYear) ?? null;
  const salariesHelp = {
    content: SALARIES_PAGE_HELP_CONTENT,
    snapshot: buildSalariesHelpSnapshot({
      salaryYearCount: years.length,
      selectedTaxYear: taxYear,
      currentTaxYear: currentYear,
      hasSelectedYear: selected !== null,
      selectedYearStatus: selected?.status ?? null,
      snapshotCount: selected?.snapshots.length ?? 0,
      hasOfficialFederalTotal: selected?.finalFederalMinor !== null && selected?.finalFederalMinor !== undefined,
      hasRrqObservation: (selected?.rrqContributionTracker.recentEntries.length ?? 0) > 0,
    }),
  };

  return <ModulePage active="Salaries" mainClassName="salaries-page editorial-page-art" eyebrow="Income tracking" title="Salaries" subtitle="A private gross-income ledger for biweekly pay, year-end projections, and finalized federal history." help={salariesHelp} pageHelpSeen={pageHelpSeen}>
    <SalariesManager preferenceScope={preferenceScope} years={years} selectedYear={selected} availableYears={yearsForSelector} selectedTaxYear={taxYear} currentTaxYear={currentYear} />
  </ModulePage>;
}
