import "./workbooks.css";
import React from "react";
import { createCalculationWorkbooksRepository } from "@athena/database";
import { ModulePage } from "../components/module-page";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { CalculationWorkbench, type CalculationWorkbookSummary } from "./calculation-workbench";

export const dynamic = "force-dynamic";

interface WorkbooksPageProps {
  readonly searchParams?: Promise<{ readonly workbook?: string | string[] }>;
}

interface WorkbooksPageData {
  readonly workbooks: readonly CalculationWorkbookSummary[];
  readonly selectedWorkbook: CalculationWorkbookSummary | null;
  readonly migrationRequired: boolean;
  readonly isDemo: boolean;
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function emptyWorkbooksPageData(migrationRequired = false): WorkbooksPageData {
  return { workbooks: [], selectedWorkbook: null, migrationRequired, isDemo: false };
}

function isMissingCalculationWorkbooksTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const databaseError = error as { readonly code?: unknown; readonly message?: unknown; readonly cause?: unknown };
  if (databaseError.code === "42P01") return true;
  if (typeof databaseError.message === "string" && databaseError.message.includes('relation "calculation_workbooks" does not exist')) return true;
  return databaseError.cause !== undefined && databaseError.cause !== error && isMissingCalculationWorkbooksTable(databaseError.cause);
}

export default async function WorkbooksPage({ searchParams }: WorkbooksPageProps) {
  const query = searchParams ? await searchParams : {};
  const requestedWorkbookId = firstQueryValue(query.workbook);
  let data: WorkbooksPageData;
  try {
    data = await withAuthenticatedPageDatabase(async (database, user) => {
      // The demo is intentionally read-only. Keep it available while an older
      // local/deployed database is waiting for the additive workbook migration.
      if (user.owner.isDemo) return { ...emptyWorkbooksPageData(), isDemo: true };

      const repository = createCalculationWorkbooksRepository(database);
      const rows = await repository.listByOwner(user.owner.id);
      const requested = requestedWorkbookId ? await repository.getById(user.owner.id, requestedWorkbookId) : null;
      const selected = requested ?? (rows[0] ? await repository.getById(user.owner.id, rows[0].id) : null);
      const workbooks: CalculationWorkbookSummary[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt.toISOString(),
      }));
      const selectedWorkbook: CalculationWorkbookSummary | null = selected ? {
        id: selected.id,
        name: selected.name,
        updatedAt: selected.updatedAt.toISOString(),
      } : null;
      return { workbooks, selectedWorkbook, migrationRequired: false, isDemo: user.owner.isDemo };
    }, { requireTwoFactor: true });
  } catch (error) {
    if (!isMissingCalculationWorkbooksTable(error)) throw error;
    data = emptyWorkbooksPageData(true);
  }

  return (
    <ModulePage
      active="Workbench"
      pageArtwork="workbooks"
      eyebrow="Personal calculations"
      title="Calculation workbench"
      subtitle="A private spreadsheet for formulas, comparisons, and scratch planning."
    >
      <CalculationWorkbench {...data} />
    </ModulePage>
  );
}
