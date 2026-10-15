import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { selectAccountTimelineWindow } from "../account-timeline-window";
import {
  accounts,
  annualBudgets,
  accountContributionExceptions,
  accountBalanceNotes,
  accountContributionRules,
  accountGroups,
  auditEvents,
  balanceSnapshots,
  cashFlowPaydayChecks,
  cashFlowPeriods,
  institutions,
  recurringTransactions,
  transfers,
} from "../drizzle-schema";
import {
  addIsoDays,
  contributionFrequencies,
  isIsoDate,
  occurrencesBetween,
  type ContributionExceptionKind,
  type ContributionFrequency,
} from "../account-contributions";
import {
  normalizeIsoDates,
  accountTimelineDedicatedOtherSectionKeys,
  accountTimelineSectionForAccount,
  selectClosestPaydayOnOrBefore,
  toTorontoDateIso,
  type AccountTimelineSectionKey,
  type SnapshotStatus,
} from "../account-timeline";

import type { AccountProjectionPreloadedData, CashFlowEndingBalancesPeriod, TimelineExtensionResult, TimelineDatabase } from "./shared";

import { isUniqueViolation, requireOwnerText, accountBalanceNoteView, accountContributionRuleSchedule, loadCashFlowProjectionPeriods, loadContributionRules, upsertAccountBalanceNote, cashFlowEndingBalancesByAccountAndPayDate, recalculateAccountProjection, assertAccountTimelineSnapshotEditable, assertAccountTimelineStatusAllowed, OWNER_WRITE_CHUNK_SIZE } from "./shared";

export interface AccountBalanceView {
  readonly id: string;
  readonly name: string;
  readonly institution: string;
  readonly kind: (typeof accounts.$inferSelect)["kind"];
  readonly currency: (typeof accounts.$inferSelect)["currency"];
  readonly includeInAvailableCash: boolean;
  readonly balanceMinor: number | null;
  readonly asOf: string | null;
}


export interface AccountTimelineSnapshotView {
  readonly id: string;
  readonly accountId: string;
  readonly asOf: string;
  readonly balanceMinor: number;
  readonly status: SnapshotStatus;
  readonly isGenerated: boolean;
  readonly currency: (typeof balanceSnapshots.$inferSelect)["currency"];
  readonly note?: string | null;
}


export interface AccountBalanceNoteView {
  readonly id: string;
  readonly accountId: string;
  readonly asOf: string;
  readonly note: string;
}


export interface AccountContributionExceptionView {
  readonly id: string;
  readonly occurrenceOn: string;
  readonly kind: ContributionExceptionKind;
  readonly amountMinor: number | null;
}


export interface AccountContributionRuleView {
  readonly id: string;
  readonly accountId: string;
  readonly amountMinor: number;
  readonly frequency: ContributionFrequency;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly isEnabled: boolean;
  readonly nextOccurrenceOn: string | null;
  readonly exceptions: readonly AccountContributionExceptionView[];
}


export interface AccountTimelineInstitutionView {
  readonly id: string;
  readonly name: string;
  readonly currency: (typeof institutions.$inferSelect)["currency"];
}


export interface AccountTimelineAccountView {
  readonly id: string;
  readonly name: string;
  readonly institutionId: string;
  readonly institution: string;
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly timelineOrder: number;
  readonly kind: (typeof accounts.$inferSelect)["kind"];
  readonly customTypeLabel: string | null;
  readonly lastFour: string | null;
  readonly currency: (typeof accounts.$inferSelect)["currency"];
  readonly isActive: boolean;
  readonly includeInAvailableCash: boolean;
  readonly useCashFlowPlannedTimeline: boolean;
  readonly snapshots: readonly AccountTimelineSnapshotView[];
  readonly notes: readonly AccountBalanceNoteView[];
  readonly contributionRules: readonly AccountContributionRuleView[];
  readonly selectedSnapshot: AccountTimelineSnapshotView | null;
}


export interface AccountTimelineView {
  readonly accounts: readonly AccountTimelineAccountView[];
  readonly institutions: readonly AccountTimelineInstitutionView[];
  readonly paydays: readonly string[];
  readonly selectedPayday: string | null;
  readonly selectedValues: Readonly<Record<string, AccountTimelineSnapshotView | null>>;
}


export interface AccountMutationSnapshotInput {
  readonly asOf: string;
  readonly balanceMinor: number;
  readonly status: SnapshotStatus;
  readonly note?: string | null;
}


export interface AccountBalanceNoteMutationInput {
  readonly accountId: string;
  readonly asOf: string;
  readonly note: string | null;
}


export interface AccountContributionRuleInput {
  readonly accountId: string;
  readonly amountMinor: number;
  readonly frequency: ContributionFrequency;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly isEnabled: boolean;
  readonly id?: string;
}


export type ContributionRecalculationScope = "rule_only" | "from_rule_start" | "all_future";


export interface AccountContributionExceptionMutationInput {
  readonly ruleId: string;
  readonly occurrenceDates: readonly string[];
  readonly kind: ContributionExceptionKind | "restore";
  readonly amountMinor?: number | null;
}


export interface AccountProjectionRecalculationResult {
  readonly accountCount: number;
  readonly snapshotsCreated: number;
  readonly snapshotsUpdated: number;
}


export interface AccountReorderResult {
  readonly section: AccountTimelineSectionKey;
  readonly accountIds: readonly string[];
}


export interface AccountCreateInput {
  readonly name: string;
  readonly institutionName: string;
  readonly kind: (typeof accounts.$inferInsert)["kind"];
  readonly customTypeLabel?: string | null;
  readonly lastFour?: string | null;
  readonly currency?: (typeof accounts.$inferInsert)["currency"];
  readonly initialSnapshot?: AccountMutationSnapshotInput;
}


export interface AccountUpdateInput {
  readonly name: string;
  readonly institutionName: string;
  readonly kind: (typeof accounts.$inferInsert)["kind"];
  readonly customTypeLabel?: string | null;
  readonly lastFour?: string | null;
}


function normalizedOwnerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-CA");
}


function normalizedCustomTypeLabel(kind: (typeof accounts.$inferInsert)["kind"], value: string | null | undefined): string | null {
  const customTypeLabel = value?.trim() || null;
  if (kind !== "other" && customTypeLabel) throw new Error("Custom type labels are only allowed for Other accounts.");
  return customTypeLabel;
}


function normalizedLastFour(kind: (typeof accounts.$inferInsert)["kind"], value: string | null | undefined): string | null {
  const lastFour = value?.trim() || null;
  if (!lastFour) return null;
  const normalized = kind === "rdsp" ? lastFour.toUpperCase() : lastFour;
  const isValid = kind === "rdsp" ? /^[A-Z0-9]{4}$/.test(normalized) : /^\d{4}$/.test(normalized);
  if (!isValid) {
    throw new Error(kind === "rdsp"
      ? "Account last four must contain exactly four letters or digits."
      : "Account last four must contain exactly four digits.");
  }
  return normalized;
}


type MutableTimelineSnapshot = {
  -readonly [K in keyof AccountTimelineSnapshotView]: AccountTimelineSnapshotView[K];
};


type MutableTimelineAccount = Omit<AccountTimelineAccountView, "snapshots" | "notes" | "selectedSnapshot"> & {
  snapshots: MutableTimelineSnapshot[];
  notes: AccountBalanceNoteView[];
  contributionRules: AccountContributionRuleView[];
};


function snapshotView(row: {
  id: string;
  accountId: string;
  asOf: string;
  balanceMinor: number;
  status: SnapshotStatus;
  isGenerated: boolean;
  currency: (typeof balanceSnapshots.$inferSelect)["currency"];
}): AccountTimelineSnapshotView {
  return {
    id: row.id,
    accountId: row.accountId,
    asOf: row.asOf,
    balanceMinor: row.balanceMinor,
    status: row.status,
    isGenerated: row.isGenerated,
    currency: row.currency,
  };
}


function assertContributionAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Contribution amount must be a positive safe integer.");
}


function assertContributionRuleInput(input: AccountContributionRuleInput): void {
  assertContributionAmount(input.amountMinor);
  if (!(contributionFrequencies as readonly string[]).includes(input.frequency)) throw new RangeError("Contribution frequency is not supported.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) throw new RangeError("Contribution start date must be a valid ISO date.");
  if (input.endsOn && (!/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.startsOn)) throw new RangeError("Contribution end date must be on or after its start date.");
}


async function findOrCreateInstitution(
  db: TimelineDatabase,
  ownerId: string,
  institutionName: string,
  currency: (typeof institutions.$inferInsert)["currency"] = "CAD",
): Promise<AccountTimelineInstitutionView> {
  const name = requireOwnerText(institutionName, "Institution name");
  const existing = await db.select({ id: institutions.id, name: institutions.name, currency: institutions.currency })
    .from(institutions)
    .where(eq(institutions.ownerId, ownerId));
  const normalized = normalizedOwnerName(name);
  const matched = existing.find((institution) => normalizedOwnerName(institution.name) === normalized);
  if (matched) return matched;
  try {
    const [created] = await db.insert(institutions).values({ ownerId, name, currency }).returning({
      id: institutions.id,
      name: institutions.name,
      currency: institutions.currency,
    });
    if (!created) throw new Error("Institution insert returned no row.");
    return created;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [created] = await db.select({ id: institutions.id, name: institutions.name, currency: institutions.currency })
      .from(institutions)
      .where(eq(institutions.ownerId, ownerId));
    if (!created || normalizedOwnerName(created.name) !== normalized) throw error;
    return created;
  }
}


async function getTimelineAccount(
  db: TimelineDatabase,
  ownerId: string,
  accountId: string,
  selectedDate: string | null = null,
): Promise<AccountTimelineAccountView> {
  const [account] = await db.select({
    id: accounts.id,
    name: accounts.name,
    institutionId: accounts.institutionId,
    institution: institutions.name,
    groupId: accounts.groupId,
    groupName: accountGroups.name,
    timelineOrder: accounts.timelineOrder,
    kind: accounts.kind,
    customTypeLabel: accounts.customTypeLabel,
    lastFour: accounts.lastFour,
    currency: accounts.currency,
    isActive: accounts.isActive,
    includeInAvailableCash: accounts.includeInAvailableCash,
    useCashFlowPlannedTimeline: accounts.useCashFlowPlannedTimeline,
  }).from(accounts)
    .innerJoin(institutions, and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)))
    .leftJoin(accountGroups, and(eq(accountGroups.id, accounts.groupId), eq(accountGroups.ownerId, ownerId)))
    .where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) throw new Error("Account not found.");
  const [rows, noteRows] = await Promise.all([
    db.select({
      id: balanceSnapshots.id,
      accountId: balanceSnapshots.accountId,
      asOf: balanceSnapshots.asOf,
      balanceMinor: balanceSnapshots.balanceMinor,
      status: balanceSnapshots.status,
      isGenerated: balanceSnapshots.isGenerated,
      currency: balanceSnapshots.currency,
    }).from(balanceSnapshots)
      .where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.accountId, accountId)))
      .orderBy(asc(balanceSnapshots.asOf), asc(balanceSnapshots.id)),
    db.select({ id: accountBalanceNotes.id, accountId: accountBalanceNotes.accountId, asOf: accountBalanceNotes.asOf, note: accountBalanceNotes.note })
      .from(accountBalanceNotes)
      .where(and(eq(accountBalanceNotes.ownerId, ownerId), eq(accountBalanceNotes.accountId, accountId)))
      .orderBy(asc(accountBalanceNotes.asOf), asc(accountBalanceNotes.id)),
  ]);
  const notes = noteRows.flatMap((row) => {
    const note = row.note;
    return note === null ? [] : [accountBalanceNoteView({ ...row, note })];
  });
  const notesByDate = new Map(notes.map((note) => [note.asOf, note]));
  const snapshots = rows.map((row) => ({ ...snapshotView(row), note: notesByDate.get(row.asOf)?.note ?? null }));
  const rules = (await loadContributionRules(db, ownerId, [accountId])).get(accountId) ?? [];
  return { ...account, snapshots, notes, contributionRules: rules, selectedSnapshot: snapshots.find((snapshot) => snapshot.asOf === selectedDate) ?? null };
}


export async function recalculateAnnualBudgetLinkedAccountProjections(
  db: TimelineDatabase,
  ownerId: string,
  accountIds: readonly string[],
): Promise<void> {
  const today = toTorontoDateIso();
  for (const accountId of new Set(accountIds)) {
    await recalculateAccountProjection(db, ownerId, accountId, {
      fromDate: addIsoDays(today, 1),
      futureAfter: today,
    });
  }
}


function accountContributionRuleViewFromRow(
  rule: AccountContributionRuleView,
  exceptions: readonly AccountContributionExceptionView[] = rule.exceptions,
): AccountContributionRuleView {
  return { ...rule, exceptions };
}


export function createAccountTimelineRepository(db: Database) {
  return {
    async getTimelineWindow(ownerId: string, options: { includeArchived?: boolean; selectedDate?: string; todayIso: string; pastPeriods?: number; futurePeriods?: number }): Promise<AccountTimelineView> {
      const dates = await db.select({ payDate: cashFlowPeriods.payDate }).from(cashFlowPeriods)
        .where(eq(cashFlowPeriods.ownerId, ownerId)).orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id));
      const window = selectAccountTimelineWindow(dates.map(row => row.payDate), options);
      return createAccountTimelineRepository(db).getTimeline(ownerId, {
        includeArchived: options.includeArchived, selectedDate: window.selectedDate ?? undefined,
        windowDates: window.visibleDates, preloadedPaydays: dates,
      });
    },
    async getTimeline(ownerId: string, options: { includeArchived?: boolean; selectedDate?: string; cashFlowPeriods?: readonly CashFlowEndingBalancesPeriod[] | Promise<readonly CashFlowEndingBalancesPeriod[]>; windowDates?: readonly string[]; preloadedPaydays?: readonly { payDate: string }[] } = {}): Promise<AccountTimelineView> {
      const includeArchived = options.includeArchived ?? false;
      const accountWhere = includeArchived
        ? eq(accounts.ownerId, ownerId)
        : and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true));
      const periodRowsPromise = options.preloadedPaydays !== undefined ? Promise.resolve(options.preloadedPaydays) : options.cashFlowPeriods !== undefined
        ? Promise.resolve(options.cashFlowPeriods).then((rows) => rows.map((row) => ({ payDate: row.payDate })))
        : db.select({ payDate: cashFlowPeriods.payDate })
          .from(cashFlowPeriods)
          .where(eq(cashFlowPeriods.ownerId, ownerId))
          .orderBy(asc(cashFlowPeriods.payDate), asc(cashFlowPeriods.id));
      const [rows, periodRows, paydayCheckRows, noteRows] = await Promise.all([
        db.select({
          id: accounts.id,
          name: accounts.name,
          institutionId: accounts.institutionId,
          institution: institutions.name,
          groupId: accounts.groupId,
          groupName: accountGroups.name,
          timelineOrder: accounts.timelineOrder,
          kind: accounts.kind,
          customTypeLabel: accounts.customTypeLabel,
          lastFour: accounts.lastFour,
          currency: accounts.currency,
          isActive: accounts.isActive,
          includeInAvailableCash: accounts.includeInAvailableCash,
          useCashFlowPlannedTimeline: accounts.useCashFlowPlannedTimeline,
          snapshotId: balanceSnapshots.id,
          snapshotAccountId: balanceSnapshots.accountId,
          snapshotAsOf: balanceSnapshots.asOf,
          snapshotBalanceMinor: balanceSnapshots.balanceMinor,
          snapshotStatus: balanceSnapshots.status,
          snapshotIsGenerated: balanceSnapshots.isGenerated,
          snapshotCurrency: balanceSnapshots.currency,
        }).from(accounts)
          .innerJoin(institutions, and(eq(institutions.id, accounts.institutionId), eq(institutions.ownerId, ownerId)))
          .leftJoin(accountGroups, and(eq(accountGroups.id, accounts.groupId), eq(accountGroups.ownerId, ownerId)))
          .leftJoin(balanceSnapshots, and(eq(balanceSnapshots.accountId, accounts.id), eq(balanceSnapshots.ownerId, ownerId), options.windowDates === undefined ? undefined : or(
            inArray(balanceSnapshots.asOf, [...options.windowDates]),
            // Preserve separate Actual/manual predecessors; CF projections below still
            // obtain their complete authoritative seed set through the existing helper.
            sql`${balanceSnapshots.asOf} = (select max(seed.as_of) from balance_snapshots seed where seed.owner_id = ${ownerId} and seed.account_id = ${accounts.id} and seed.as_of < ${options.windowDates[0] ?? "0001-01-01"} and seed.status = 'actual')`,
            sql`${balanceSnapshots.asOf} = (select max(seed.as_of) from balance_snapshots seed where seed.owner_id = ${ownerId} and seed.account_id = ${accounts.id} and seed.as_of < ${options.windowDates[0] ?? "0001-01-01"} and seed.status = 'planned' and seed.is_generated = false)`,
          )))
          .where(accountWhere)
          .orderBy(asc(accounts.timelineOrder), asc(accounts.name), asc(accounts.id), asc(balanceSnapshots.asOf), asc(balanceSnapshots.id)),
        periodRowsPromise,
        db.select({
          id: cashFlowPaydayChecks.id,
          accountId: cashFlowPaydayChecks.accountId,
          payDate: cashFlowPaydayChecks.payDate,
          actualBalanceMinor: cashFlowPaydayChecks.actualBalanceMinor,
        }).from(cashFlowPaydayChecks)
          .where(and(eq(cashFlowPaydayChecks.ownerId, ownerId), options.windowDates === undefined ? undefined : inArray(cashFlowPaydayChecks.payDate, [...options.windowDates])))
          .orderBy(asc(cashFlowPaydayChecks.payDate), asc(cashFlowPaydayChecks.accountId), asc(cashFlowPaydayChecks.id)),
        db.select({ id: accountBalanceNotes.id, accountId: accountBalanceNotes.accountId, asOf: accountBalanceNotes.asOf, note: accountBalanceNotes.note })
          .from(accountBalanceNotes)
          .where(and(eq(accountBalanceNotes.ownerId, ownerId), options.windowDates === undefined ? undefined : inArray(accountBalanceNotes.asOf, [...options.windowDates])))
          .orderBy(asc(accountBalanceNotes.asOf), asc(accountBalanceNotes.accountId), asc(accountBalanceNotes.id)),
      ]);
      const notes = noteRows.flatMap((row) => {
        const note = row.note;
        return note === null ? [] : [accountBalanceNoteView({ ...row, note })];
      });
      const notesByKey = new Map(notes.map((note) => [`${note.accountId}:${note.asOf}`, note]));
      const byAccount = new Map<string, MutableTimelineAccount>();
      const institutionsById = new Map<string, AccountTimelineInstitutionView>();
      for (const row of rows) {
        let account = byAccount.get(row.id);
        if (!account) {
          account = {
            id: row.id,
            name: row.name,
            institutionId: row.institutionId,
            institution: row.institution,
            groupId: row.groupId,
            groupName: row.groupName,
            timelineOrder: row.timelineOrder,
            kind: row.kind,
            customTypeLabel: row.customTypeLabel,
            lastFour: row.lastFour,
            currency: row.currency,
            isActive: row.isActive,
            includeInAvailableCash: row.includeInAvailableCash,
            useCashFlowPlannedTimeline: row.useCashFlowPlannedTimeline,
            snapshots: [],
            notes: [],
            contributionRules: [],
          };
          byAccount.set(row.id, account);
          institutionsById.set(row.institutionId, { id: row.institutionId, name: row.institution, currency: row.currency });
        }
        if (row.snapshotId && row.snapshotAccountId && row.snapshotAsOf && row.snapshotBalanceMinor !== null && row.snapshotStatus && row.snapshotCurrency) {
          account.snapshots.push({
            ...snapshotView({
              id: row.snapshotId,
              accountId: row.snapshotAccountId,
              asOf: row.snapshotAsOf,
              balanceMinor: row.snapshotBalanceMinor,
              status: row.snapshotStatus,
              isGenerated: row.snapshotIsGenerated ?? false,
              currency: row.snapshotCurrency,
            }),
            note: notesByKey.get(`${row.snapshotAccountId}:${row.snapshotAsOf}`)?.note ?? null,
          });
        }
      }
      for (const note of notes) {
        const account = byAccount.get(note.accountId);
        if (account) account.notes.push(note);
      }
      const optedInAccountIds = [...byAccount.values()]
        .filter((account) => account.useCashFlowPlannedTimeline)
        .map((account) => account.id);
      const [contributionRules, cashFlowOpenings] = await Promise.all([
        loadContributionRules(db, ownerId, [...byAccount.keys()]),
        // Overlay CF projected openings only for accounts that opted into CF planned timeline.
        optedInAccountIds.length > 0
          ? cashFlowEndingBalancesByAccountAndPayDate(db, ownerId, "opening", { periods: options.cashFlowPeriods })
          : Promise.resolve(new Map<string, ReadonlyMap<string, number>>()),
      ]);
      const paydays = normalizeIsoDates(periodRows.map((period) => period.payDate));
      for (const account of byAccount.values()) {
        if (!account.useCashFlowPlannedTimeline) continue;
        const openings = cashFlowOpenings.get(account.id);
        if (!openings) continue;
        const snapshotsByDate = new Map(account.snapshots.map((snapshot) => [snapshot.asOf, snapshot]));
        for (const [payDate, openingMinor] of openings) {
          if (options.windowDates && !options.windowDates.includes(payDate)) continue;
          const existing = snapshotsByDate.get(payDate);
          if (existing) {
            if (existing.status === "planned" && existing.isGenerated) {
              existing.balanceMinor = openingMinor;
            }
            continue;
          }
          // Surface CF-driven planned openings even when no snapshot row exists yet.
          account.snapshots.push({
            id: `cf-projected:${account.id}:${payDate}`,
            accountId: account.id,
            asOf: payDate,
            balanceMinor: openingMinor,
            status: "planned",
            isGenerated: true,
            currency: account.currency,
            note: notesByKey.get(`${account.id}:${payDate}`)?.note ?? null,
          });
        }
        account.snapshots.sort((left, right) => left.asOf.localeCompare(right.asOf) || left.id.localeCompare(right.id));
      }
      for (const check of paydayCheckRows) {
        const account = byAccount.get(check.accountId);
        if (!account) continue;
        const checkSnapshot = {
          ...snapshotView({
            id: `payday-check:${check.id}`,
            accountId: check.accountId,
            asOf: check.payDate,
            balanceMinor: check.actualBalanceMinor,
            status: "actual" as const,
            isGenerated: false,
            currency: account.currency,
          }),
          note: notesByKey.get(`${check.accountId}:${check.payDate}`)?.note ?? null,
        };
        const existingIndex = account.snapshots.findIndex((snapshot) => snapshot.asOf === check.payDate);
        if (existingIndex >= 0) account.snapshots[existingIndex] = checkSnapshot;
        else account.snapshots.push(checkSnapshot);
        account.snapshots.sort((left, right) => left.asOf.localeCompare(right.asOf) || left.id.localeCompare(right.id));
      }
      const accountsForOwner = [...byAccount.values()].map((account) => ({
        ...account,
        contributionRules: contributionRules.get(account.id) ?? [],
        selectedSnapshot: null,
      }));
      const selectedPayday = options.selectedDate && paydays.includes(options.selectedDate)
        ? options.selectedDate
        : selectClosestPaydayOnOrBefore(paydays);
      const accountsWithSelection = accountsForOwner.map((account) => ({
        ...account,
        selectedSnapshot: account.snapshots.find((snapshot) => snapshot.asOf === selectedPayday) ?? null,
      }));
      return {
        accounts: accountsWithSelection,
        institutions: [...institutionsById.values()].sort((left, right) => left.name.localeCompare(right.name, "en-CA")),
        paydays,
        selectedPayday,
        selectedValues: Object.fromEntries(accountsWithSelection.map((account) => [account.id, account.selectedSnapshot])),
      };
    },

    async reorderAccounts(ownerId: string, section: AccountTimelineSectionKey, accountIds: readonly string[]): Promise<AccountReorderResult> {
      if (!accountIds.length || new Set(accountIds).size !== accountIds.length) throw new RangeError("Account order must contain unique account IDs.");
      return db.transaction(async (tx) => {
        const rows = await tx.select({
          id: accounts.id,
          name: accounts.name,
          kind: accounts.kind,
          customTypeLabel: accounts.customTypeLabel,
          isActive: accounts.isActive,
          timelineOrder: accounts.timelineOrder,
        }).from(accounts)
          .where(eq(accounts.ownerId, ownerId))
          .orderBy(asc(accounts.timelineOrder), asc(accounts.name), asc(accounts.id));
        const dedicatedOtherSections = accountTimelineDedicatedOtherSectionKeys(rows);
        const byId = new Map(rows.map((row) => [row.id, row]));
        const requested = accountIds.map((accountId) => {
          const account = byId.get(accountId);
          if (!account) throw new Error("Account not found.");
          if (accountTimelineSectionForAccount(account.kind, account.customTypeLabel, dedicatedOtherSections) !== section) {
            throw new Error("Accounts can only be reordered inside their current section.");
          }
          return account;
        });
        const sectionAccounts = rows.filter((account) => accountTimelineSectionForAccount(account.kind, account.customTypeLabel, dedicatedOtherSections) === section);
        const requestedIds = new Set(accountIds);
        const ordered = [...requested, ...sectionAccounts.filter((account) => !requestedIds.has(account.id))];
        for (let start = 0; start < ordered.length; start += OWNER_WRITE_CHUNK_SIZE) {
          const chunk = ordered.slice(start, start + OWNER_WRITE_CHUNK_SIZE);
          const valueRows = sql.join(
            chunk.map((account, offset) => sql`(${account.id}::uuid, ${start + offset}::integer)`),
            sql`, `,
          );
          const updated = await tx.execute(sql`
            update public.accounts as a
            set timeline_order = v.ord
            from (values ${valueRows}) as v(id, ord)
            where a.id = v.id
              and a.owner_id = ${ownerId}
            returning a.id
          `);
          if (updated.length !== chunk.length) {
            throw new Error(`Account reorder update affected ${updated.length} row(s) but expected ${chunk.length}.`);
          }
        }
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "account_order",
          entityId: null,
          metadata: { section, accountIds: ordered.map((account) => account.id) },
        });
        return { section, accountIds: ordered.map((account) => account.id) };
      });
    },

    async createAccount(ownerId: string, input: AccountCreateInput): Promise<AccountTimelineAccountView & { readonly isMainAccount: boolean }> {
      try {
        return await db.transaction(async (tx) => {
          const name = requireOwnerText(input.name, "Account name");
          const institution = await findOrCreateInstitution(tx, ownerId, input.institutionName, input.currency ?? "CAD");
          const [activeAccount] = await tx.select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)))
            .limit(1);
          const isMainAccount = !activeAccount;
          const existing = await tx.select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(and(eq(accounts.ownerId, ownerId), eq(accounts.institutionId, institution.id)));
          if (existing.some((account) => normalizedOwnerName(account.name) === normalizedOwnerName(name))) {
            throw new Error("An account with this name already exists at this institution.");
          }
          const [created] = await tx.insert(accounts).values({
            ownerId,
            institutionId: institution.id,
            name,
            kind: input.kind,
            customTypeLabel: normalizedCustomTypeLabel(input.kind, input.customTypeLabel),
            lastFour: normalizedLastFour(input.kind, input.lastFour),
            currency: input.currency ?? "CAD",
            isActive: true,
            includeInAvailableCash: isMainAccount,
            useCashFlowPlannedTimeline: isMainAccount,
          }).returning({ id: accounts.id });
          if (!created) throw new Error("Account insert returned no row.");
          let generatedSnapshots = 0;
          if (input.initialSnapshot) {
            await tx.insert(balanceSnapshots).values({
              ownerId,
              accountId: created.id,
              asOf: input.initialSnapshot.asOf,
              balanceMinor: input.initialSnapshot.balanceMinor,
              status: input.initialSnapshot.status,
              isGenerated: false,
              currency: input.currency ?? "CAD",
            });
            const projection = await recalculateAccountProjection(tx, ownerId, created.id, {
              fromDate: addIsoDays(input.initialSnapshot.asOf, 1),
              futureAfter: null,
            });
            generatedSnapshots = projection.snapshotsCreated;
          }
          await tx.insert(auditEvents).values({
            ownerId,
            actorUserId: ownerId,
            action: "created",
            entityType: "account",
            entityId: created.id,
            metadata: { hasInitialSnapshot: Boolean(input.initialSnapshot), generatedSnapshots },
          });
          const account = await getTimelineAccount(tx, ownerId, created.id, input.initialSnapshot?.asOf ?? null);
          return { ...account, isMainAccount };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("An account with this name already exists at this institution.");
        throw error;
      }
    },

    async recalculateAccountProjections(ownerId: string, accountId: string): Promise<AccountProjectionRecalculationResult> {
      return db.transaction(async (tx) => {
        const today = toTorontoDateIso();
        const counts = await recalculateAccountProjection(tx, ownerId, accountId, {
          fromDate: addIsoDays(today, 1),
          futureAfter: today,
        });
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "account_projection",
          entityId: accountId,
          metadata: { scope: "account", accountCount: 1, ...counts },
        });
        return { accountCount: 1, ...counts };
      });
    },

    async recalculateAllAccountProjections(ownerId: string): Promise<AccountProjectionRecalculationResult> {
      return db.transaction(async (tx) => {
        const ownerAccounts = await tx.select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.ownerId, ownerId))
          .orderBy(asc(accounts.name), asc(accounts.id));
        const today = toTorontoDateIso();
        const periodsPromise = loadCashFlowProjectionPeriods(tx, ownerId);
        const [cashFlowEndings, periods, contributionRules] = await Promise.all([
          cashFlowEndingBalancesByAccountAndPayDate(tx, ownerId, "ending", { periods: periodsPromise }),
          periodsPromise,
          loadContributionRules(tx, ownerId, ownerAccounts.map((account) => account.id), today),
        ]);
        const preloaded: AccountProjectionPreloadedData = { periods, contributionRules };
        let snapshotsCreated = 0;
        let snapshotsUpdated = 0;
        for (const account of ownerAccounts) {
          const counts = await recalculateAccountProjection(tx, ownerId, account.id, {
            fromDate: addIsoDays(today, 1),
            futureAfter: today,
          }, cashFlowEndings, preloaded);
          snapshotsCreated += counts.snapshotsCreated;
          snapshotsUpdated += counts.snapshotsUpdated;
        }
        const result = { accountCount: ownerAccounts.length, snapshotsCreated, snapshotsUpdated };
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "account_projection",
          entityId: null,
          metadata: { scope: "all", ...result },
        });
        return result;
      });
    },

    async updateAccount(ownerId: string, accountId: string, input: AccountUpdateInput): Promise<AccountTimelineAccountView> {
      try {
        return await db.transaction(async (tx) => {
          const name = requireOwnerText(input.name, "Account name");
          const institution = await findOrCreateInstitution(tx, ownerId, input.institutionName);
          const existing = await tx.select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(and(eq(accounts.ownerId, ownerId), eq(accounts.institutionId, institution.id), sql`${accounts.id} <> ${accountId}`));
          if (existing.some((account) => normalizedOwnerName(account.name) === normalizedOwnerName(name))) {
            throw new Error("An account with this name already exists at this institution.");
          }
          const [updated] = await tx.update(accounts)
            .set({
              name,
              institutionId: institution.id,
              kind: input.kind,
              customTypeLabel: normalizedCustomTypeLabel(input.kind, input.customTypeLabel),
              lastFour: normalizedLastFour(input.kind, input.lastFour),
            })
            .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId)))
            .returning({ id: accounts.id });
          if (!updated) throw new Error("Account not found.");
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "account", entityId: accountId, metadata: { operation: "metadata" } });
          return getTimelineAccount(tx, ownerId, accountId);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error("An account with this name already exists at this institution.");
        throw error;
      }
    },

    async updateAvailableCash(ownerId: string, accountId: string, includeInAvailableCash: boolean): Promise<AccountTimelineAccountView> {
      return db.transaction(async (tx) => {
        const [updated] = await tx.update(accounts)
          .set({ includeInAvailableCash })
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId)))
          .returning({ id: accounts.id });
        if (!updated) throw new Error("Account not found.");
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "account",
          entityId: accountId,
          metadata: { operation: "available_cash_inclusion", includeInAvailableCash },
        });
        return getTimelineAccount(tx, ownerId, accountId);
      });
    },

    async updateCashFlowPlannedTimeline(ownerId: string, accountId: string, useCashFlowPlannedTimeline: boolean): Promise<AccountTimelineAccountView> {
      return db.transaction(async (tx) => {
        const [updated] = await tx.update(accounts)
          .set({ useCashFlowPlannedTimeline })
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId)))
          .returning({ id: accounts.id });
        if (!updated) throw new Error("Account not found.");
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "updated",
          entityType: "account",
          entityId: accountId,
          metadata: { operation: "cash_flow_planned_timeline", useCashFlowPlannedTimeline },
        });
        // Rebuild generated planned cells so contribution rules or CF endings match the new source.
        const today = toTorontoDateIso();
        await recalculateAccountProjection(tx, ownerId, accountId, {
          fromDate: addIsoDays(today, 1),
          futureAfter: today,
        });
        return getTimelineAccount(tx, ownerId, accountId);
      });
    },
    async archiveAccount(ownerId: string, accountId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [updated] = await tx.update(accounts)
          .set({ isActive: false })
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)))
          .returning({ id: accounts.id });
        if (!updated) throw new Error("Account not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "account", entityId: accountId, metadata: { operation: "archive" } });
      });
    },

    async restoreAccount(ownerId: string, accountId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [updated] = await tx.update(accounts)
          .set({ isActive: true })
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId), eq(accounts.isActive, false)))
          .returning({ id: accounts.id });
        if (!updated) throw new Error("Account not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "account", entityId: accountId, metadata: { operation: "restore" } });
      });
    },

    /**
     * Permanently deletes an account when it has no blocking financial links.
     * Snapshots and contribution rules cascade; transfer/recurring endpoints and linked annual budgets block.
     */
    async deleteAccount(ownerId: string, accountId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [account] = await tx.select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId)))
          .limit(1);
        if (!account) throw new Error("Account not found.");

        const [transferLink] = await tx.select({ id: transfers.id })
          .from(transfers)
          .where(and(
            eq(transfers.ownerId, ownerId),
            or(eq(transfers.fromAccountId, accountId), eq(transfers.toAccountId, accountId)),
          ))
          .limit(1);
        if (transferLink) {
          throw new Error("Cannot delete this account while transfers still reference it. Remove or reassign those transfers first.");
        }

        const [recurringLink] = await tx.select({ id: recurringTransactions.id })
          .from(recurringTransactions)
          .where(and(
            eq(recurringTransactions.ownerId, ownerId),
            or(
              eq(recurringTransactions.accountId, accountId),
              eq(recurringTransactions.fromAccountId, accountId),
              eq(recurringTransactions.toAccountId, accountId),
            ),
          ))
          .limit(1);
        if (recurringLink) {
          throw new Error("Cannot delete this account while a recurring transaction version references it. Update or remove the related income, expense, or transfer series first.");
        }

        const [linkedBudget] = await tx.select({ id: annualBudgets.id })
          .from(annualBudgets)
          .where(and(eq(annualBudgets.ownerId, ownerId), eq(annualBudgets.linkedAccountId, accountId)))
          .limit(1);
        if (linkedBudget) {
          throw new Error("Cannot delete this account while an annual budget is linked to it. Relink or archive that budget first.");
        }

        const [deleted] = await tx.delete(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId)))
          .returning({ id: accounts.id });
        if (!deleted) throw new Error("Account not found.");

        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "deleted",
          entityType: "account",
          entityId: accountId,
          metadata: { operation: "delete", name: account.name },
        });
      });
    },

    async upsertBalanceSnapshot(ownerId: string, accountId: string, input: AccountMutationSnapshotInput): Promise<AccountTimelineSnapshotView> {
      return db.transaction(async (tx) => {
        const importedAnchorEdited = await assertAccountTimelineSnapshotEditable(tx, ownerId, accountId, input.asOf, {
          allowImportedAnchor: true,
          allowCurrentPaydayPlannedSnapshot: input.status === "planned",
        });
        await assertAccountTimelineStatusAllowed(tx, ownerId, input.asOf, input.status);
        const [account] = await tx.select({ id: accounts.id, currency: accounts.currency })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId)))
          .limit(1);
        if (!account) throw new Error("Account not found.");
        const [snapshot] = await tx.insert(balanceSnapshots).values({
          ownerId,
          accountId,
          asOf: input.asOf,
          balanceMinor: input.balanceMinor,
          status: input.status,
          currency: account.currency,
        }).onConflictDoUpdate({
          target: [balanceSnapshots.accountId, balanceSnapshots.asOf],
          set: { balanceMinor: input.balanceMinor, status: input.status, isGenerated: false, currency: account.currency },
        }).returning({
          id: balanceSnapshots.id,
          accountId: balanceSnapshots.accountId,
          asOf: balanceSnapshots.asOf,
          balanceMinor: balanceSnapshots.balanceMinor,
          status: balanceSnapshots.status,
          isGenerated: balanceSnapshots.isGenerated,
          currency: balanceSnapshots.currency,
        });
        if (!snapshot) throw new Error("Balance snapshot upsert returned no row.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "balance_snapshot", entityId: snapshot.id, metadata: { asOf: input.asOf, status: input.status, importedAnchorEdited } });
        const note = input.note === undefined ? undefined : await upsertAccountBalanceNote(tx, ownerId, accountId, input.asOf, input.note);
        if (input.note !== undefined) {
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: note ? "updated" : "deleted", entityType: "account_balance_note", entityId: note?.id ?? null, metadata: { operation: note ? "upsert" : "clear", accountId, asOf: input.asOf } });
        }
        await recalculateAccountProjection(tx, ownerId, accountId, { fromDate: input.asOf, futureAfter: toTorontoDateIso() });
        return { ...snapshotView(snapshot), ...(input.note !== undefined ? { note: note?.note ?? null } : {}) };
      });
    },

    async updateAccountBalanceNote(ownerId: string, input: AccountBalanceNoteMutationInput): Promise<AccountBalanceNoteView | null> {
      return db.transaction(async (tx) => {
        const [account] = await tx.select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, input.accountId)))
          .limit(1);
        if (!account) throw new Error("Account not found.");
        const [existing] = await tx.select({ id: accountBalanceNotes.id })
          .from(accountBalanceNotes)
          .where(and(eq(accountBalanceNotes.ownerId, ownerId), eq(accountBalanceNotes.accountId, input.accountId), eq(accountBalanceNotes.asOf, input.asOf)))
          .limit(1);
        const note = await upsertAccountBalanceNote(tx, ownerId, input.accountId, input.asOf, input.note);
        if (note || existing) {
          await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: note ? (existing ? "updated" : "created") : "deleted", entityType: "account_balance_note", entityId: note?.id ?? existing?.id ?? null, metadata: { operation: note ? "upsert" : "clear", accountId: input.accountId, asOf: input.asOf } });
        }
        return note;
      });
    },

    async deleteBalanceSnapshot(ownerId: string, accountId: string, asOf: string): Promise<void> {
      return db.transaction(async (tx) => {
        await assertAccountTimelineSnapshotEditable(tx, ownerId, accountId, asOf);
        const [account] = await tx.select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.ownerId, ownerId)))
          .limit(1);
        if (!account) throw new Error("Account not found.");
        const deleted = await tx.delete(balanceSnapshots)
          .where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.accountId, accountId), eq(balanceSnapshots.asOf, asOf)))
          .returning({ id: balanceSnapshots.id });
        if (deleted.length === 0) throw new Error("Balance snapshot not found.");
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "deleted", entityType: "balance_snapshot", entityId: deleted[0]!.id, metadata: { asOf } });
        await recalculateAccountProjection(tx, ownerId, accountId, { fromDate: asOf, futureAfter: toTorontoDateIso() });
      });
    },

    async confirmPeriod(ownerId: string, asOf: string): Promise<{ updatedCount: number }> {
      return db.transaction(async (tx) => {
        await assertAccountTimelineStatusAllowed(tx, ownerId, asOf, "actual");
        const updated = await tx.update(balanceSnapshots)
          .set({ status: "actual", isGenerated: false })
          .where(and(eq(balanceSnapshots.ownerId, ownerId), eq(balanceSnapshots.asOf, asOf), eq(balanceSnapshots.status, "planned")))
          .returning({ id: balanceSnapshots.id });
        await tx.insert(auditEvents).values({ ownerId, actorUserId: ownerId, action: "updated", entityType: "balance_period", entityId: null, metadata: { asOf, updatedCount: updated.length, operation: "confirm" } });
        return { updatedCount: updated.length };
      });
    },

    async saveContributionRule(
      ownerId: string,
      input: AccountContributionRuleInput,
      scope: ContributionRecalculationScope,
    ): Promise<AccountContributionRuleView> {
      assertContributionRuleInput(input);
      if (!( ["rule_only", "from_rule_start", "all_future"] as const).includes(scope)) throw new RangeError("Contribution recalculation scope is invalid.");
      return db.transaction(async (tx) => {
        const [account] = await tx.select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.ownerId, ownerId), eq(accounts.id, input.accountId)))
          .limit(1);
        if (!account) throw new Error("Account not found.");

        let previousAccountId: string | null = null;
        if (input.id) {
          const [existing] = await tx.select({ id: accountContributionRules.id, accountId: accountContributionRules.accountId })
            .from(accountContributionRules)
            .where(and(eq(accountContributionRules.ownerId, ownerId), eq(accountContributionRules.id, input.id)))
            .limit(1);
          if (!existing) throw new Error("Contribution rule not found.");
          previousAccountId = existing.accountId;
        }

        const values = {
          ownerId,
          accountId: input.accountId,
          amountMinor: input.amountMinor,
          frequency: input.frequency,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          isEnabled: input.isEnabled,
          updatedAt: new Date(),
        };
        let ruleId = input.id;
        if (ruleId) {
          const [updated] = await tx.update(accountContributionRules)
            .set(values)
            .where(and(eq(accountContributionRules.ownerId, ownerId), eq(accountContributionRules.id, ruleId)))
            .returning({ id: accountContributionRules.id });
          if (!updated) throw new Error("Contribution rule not found.");
        } else {
          const [created] = await tx.insert(accountContributionRules).values(values).returning({ id: accountContributionRules.id });
          if (!created) throw new Error("Contribution rule insert returned no row.");
          ruleId = created.id;
        }

        if (scope !== "rule_only") {
          const futureAfter = toTorontoDateIso();
          const fromDate = scope === "all_future" ? addIsoDays(futureAfter, 1) : input.startsOn;
          await recalculateAccountProjection(tx, ownerId, input.accountId, { fromDate, futureAfter });
          if (previousAccountId && previousAccountId !== input.accountId) {
            await recalculateAccountProjection(tx, ownerId, previousAccountId, { fromDate, futureAfter });
          }
        }

        const rules = (await loadContributionRules(tx, ownerId, [input.accountId])).get(input.accountId) ?? [];
        const saved = rules.find((rule) => rule.id === ruleId);
        if (!saved) throw new Error("Contribution rule could not be reloaded.");
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: input.id ? "updated" : "created",
          entityType: "account_contribution_rule",
          entityId: ruleId,
          metadata: { accountId: input.accountId, scope },
        });
        return accountContributionRuleViewFromRow(saved);
      });
    },

    async deleteContributionRule(ownerId: string, ruleId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [existing] = await tx.select({ accountId: accountContributionRules.accountId, startsOn: accountContributionRules.startsOn })
          .from(accountContributionRules)
          .where(and(eq(accountContributionRules.ownerId, ownerId), eq(accountContributionRules.id, ruleId)))
          .limit(1);
        if (!existing) throw new Error("Contribution rule not found.");
        await tx.delete(accountContributionRules)
          .where(and(eq(accountContributionRules.ownerId, ownerId), eq(accountContributionRules.id, ruleId)));
        await recalculateAccountProjection(tx, ownerId, existing.accountId, { fromDate: existing.startsOn, futureAfter: toTorontoDateIso() });
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "deleted",
          entityType: "account_contribution_rule",
          entityId: ruleId,
          metadata: { accountId: existing.accountId },
        });
      });
    },

    async updateContributionExceptions(
      ownerId: string,
      input: AccountContributionExceptionMutationInput,
    ): Promise<AccountContributionRuleView> {
      const occurrenceDates = [...new Set(input.occurrenceDates.filter((date) => date.trim()))].sort();
      if (occurrenceDates.length === 0) throw new RangeError("Select at least one occurrence date.");
      if (input.kind === "override") assertContributionAmount(input.amountMinor ?? 0);
      return db.transaction(async (tx) => {
        const [ruleRow] = await tx.select({
          id: accountContributionRules.id,
          accountId: accountContributionRules.accountId,
          amountMinor: accountContributionRules.amountMinor,
          frequency: accountContributionRules.frequency,
          startsOn: accountContributionRules.startsOn,
          endsOn: accountContributionRules.endsOn,
          isEnabled: accountContributionRules.isEnabled,
        }).from(accountContributionRules)
          .where(and(eq(accountContributionRules.ownerId, ownerId), eq(accountContributionRules.id, input.ruleId)))
          .limit(1);
        if (!ruleRow) throw new Error("Contribution rule not found.");
        const schedule = accountContributionRuleSchedule({ ...ruleRow, isEnabled: true });
        for (const occurrenceOn of occurrenceDates) {
          if (!isIsoDate(occurrenceOn) || !occurrencesBetween(schedule, occurrenceOn, occurrenceOn).includes(occurrenceOn)) {
            throw new RangeError(`${occurrenceOn} is not an occurrence date for this rule.`);
          }
        }
        if (input.kind === "restore") {
          await tx.delete(accountContributionExceptions)
            .where(and(eq(accountContributionExceptions.ownerId, ownerId), eq(accountContributionExceptions.ruleId, input.ruleId), inArray(accountContributionExceptions.occurrenceOn, occurrenceDates)));
        } else {
          const exceptionKind: ContributionExceptionKind = input.kind;
          await tx.insert(accountContributionExceptions).values(occurrenceDates.map((occurrenceOn) => ({
            ownerId,
            ruleId: input.ruleId,
            occurrenceOn,
            kind: exceptionKind,
            amountMinor: exceptionKind === "override" ? input.amountMinor ?? null : null,
            updatedAt: new Date(),
          }))).onConflictDoUpdate({
            target: [accountContributionExceptions.ruleId, accountContributionExceptions.occurrenceOn],
            set: {
              kind: exceptionKind,
              amountMinor: exceptionKind === "override" ? input.amountMinor ?? null : null,
              updatedAt: new Date(),
            },
          });
        }
        await recalculateAccountProjection(tx, ownerId, ruleRow.accountId, { fromDate: occurrenceDates[0]!, futureAfter: toTorontoDateIso() });
        const saved = ((await loadContributionRules(tx, ownerId, [ruleRow.accountId])).get(ruleRow.accountId) ?? []).find((rule) => rule.id === input.ruleId);
        if (!saved) throw new Error("Contribution rule could not be reloaded.");
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: input.kind === "restore" ? "updated" : "updated",
          entityType: "account_contribution_exception",
          entityId: input.ruleId,
          metadata: { occurrenceDates, kind: input.kind },
        });
        return accountContributionRuleViewFromRow(saved);
      });
    },

    async extendTimeline(ownerId: string, throughDate: string): Promise<TimelineExtensionResult> {
      if (!isIsoDate(throughDate)) throw new RangeError("Timeline end date must be a valid ISO date.");
      return db.transaction(async (tx) => {
        const [latest] = await tx.select({ endsOn: cashFlowPeriods.endsOn, payDate: cashFlowPeriods.payDate, currency: cashFlowPeriods.currency })
          .from(cashFlowPeriods)
          .where(eq(cashFlowPeriods.ownerId, ownerId))
          .orderBy(desc(cashFlowPeriods.endsOn), desc(cashFlowPeriods.id))
          .limit(1);
        if (!latest || latest.payDate >= throughDate) return { throughDate, periodsCreated: 0, snapshotsCreated: 0 };

        const periods: Array<{ ownerId: string; label: string; startsOn: string; endsOn: string; payDate: string; openingBalanceMinor: number; currency: (typeof cashFlowPeriods.$inferInsert)["currency"]; status: "planned" }> = [];
        let previousEnd = latest.endsOn;
        while (previousEnd < throughDate) {
          const endsOn = addIsoDays(previousEnd, 14);
          periods.push({
            ownerId,
            label: `Pay period ${endsOn}`,
            startsOn: addIsoDays(previousEnd, 1),
            endsOn,
            payDate: endsOn,
            openingBalanceMinor: 0,
            currency: latest.currency,
            status: "planned",
          });
          previousEnd = endsOn;
        }
        if (periods.length === 0) return { throughDate, periodsCreated: 0, snapshotsCreated: 0 };
        await tx.insert(cashFlowPeriods).values(periods);

        const ownerAccounts = await tx.select({ id: accounts.id, currency: accounts.currency })
          .from(accounts)
          .where(and(eq(accounts.ownerId, ownerId), eq(accounts.isActive, true)));
        const accountSnapshots = ownerAccounts.length === 0 ? [] : await tx.select({
          accountId: balanceSnapshots.accountId,
          asOf: balanceSnapshots.asOf,
          balanceMinor: balanceSnapshots.balanceMinor,
        }).from(balanceSnapshots)
          .where(and(eq(balanceSnapshots.ownerId, ownerId), inArray(balanceSnapshots.accountId, ownerAccounts.map((account) => account.id))))
          .orderBy(desc(balanceSnapshots.asOf), desc(balanceSnapshots.id));
        const latestByAccount = new Map<string, { asOf: string; balanceMinor: number }>();
        for (const snapshot of accountSnapshots) if (!latestByAccount.has(snapshot.accountId)) latestByAccount.set(snapshot.accountId, snapshot);

        const snapshotRows: (typeof balanceSnapshots.$inferInsert)[] = [];
        const accountsWithAnchor: typeof ownerAccounts = [];
        for (const account of ownerAccounts) {
          const previous = latestByAccount.get(account.id);
          if (!previous) continue;
          accountsWithAnchor.push(account);
          for (const period of periods) {
            snapshotRows.push({
              ownerId,
              accountId: account.id,
              asOf: period.payDate,
              balanceMinor: previous.balanceMinor,
              status: "planned",
              isGenerated: true,
              currency: account.currency,
            });
          }
        }
        let snapshotsCreated = 0;
        for (let start = 0; start < snapshotRows.length; start += OWNER_WRITE_CHUNK_SIZE) {
          const chunk = snapshotRows.slice(start, start + OWNER_WRITE_CHUNK_SIZE);
          const created = await tx.insert(balanceSnapshots).values(chunk)
            .onConflictDoNothing({ target: [balanceSnapshots.accountId, balanceSnapshots.asOf] })
            .returning({ id: balanceSnapshots.id });
          snapshotsCreated += created.length;
        }
        for (const account of accountsWithAnchor) {
          await recalculateAccountProjection(tx, ownerId, account.id, { fromDate: periods[0]!.payDate, futureAfter: null });
        }
        await tx.insert(auditEvents).values({
          ownerId,
          actorUserId: ownerId,
          action: "created",
          entityType: "account_timeline_extension",
          entityId: null,
          metadata: { throughDate, periodsCreated: periods.length, snapshotsCreated },
        });
        return { throughDate, periodsCreated: periods.length, snapshotsCreated };
      });
    },
  };
}
