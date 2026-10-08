import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const id = () => uuid("id").defaultRandom().primaryKey();
const owner = () => uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const currencyCodeEnum = pgEnum("currency_code", ["CAD", "USD", "EUR"]);
export const accountKindEnum = pgEnum("account_kind", ["checking", "savings", "credit", "loan", "investment", "cash", "crypto", "rrsp", "tfsa", "fhsa", "resp", "non_registered", "other", "rdsp"]);
export const transactionKindEnum = pgEnum("transaction_kind", ["income", "expense", "adjustment"]);
export const recordStatusEnum = pgEnum("record_status", ["planned", "actual"]);
export const recurringFrequencyEnum = pgEnum("recurring_frequency", ["weekly", "biweekly", "monthly", "quarterly", "annual"]);
export const recurringCashFlowKindEnum = pgEnum("recurring_cash_flow_kind", ["income", "expense", "transfer"]);
export const recurringSeriesStateEnum = pgEnum("recurring_series_state", ["active", "paused", "ended"]);
export const recurringOccurrenceExceptionKindEnum = pgEnum("recurring_occurrence_exception_kind", ["override", "skip"]);
export const recurringWeekdayAdjustmentEnum = pgEnum("recurring_weekday_adjustment", ["none", "next_weekday", "previous_weekday"]);
export const homeMortgageCompoundingEnum = pgEnum("home_mortgage_compounding", ["canadian_semi_annual", "annual", "monthly"]);
export const accountContributionExceptionKindEnum = pgEnum("account_contribution_exception_kind", ["skip", "override"]);
export const cashFlowPeriodStatusEnum = pgEnum("cash_flow_period_status", ["planned", "actual", "mixed", "closed"]);
export const scenarioStatusEnum = pgEnum("scenario_status", ["draft", "accepted", "archived"]);
export const salaryYearStatusEnum = pgEnum("salary_year_status", ["in_progress", "finalized"]);
export const investmentAccountKindEnum = pgEnum("investment_account_kind", ["registered", "non_registered", "retirement", "other"]);
// The public baseline is fresh-install only; legacy `fnb` rows belong to the
// separate private migration chain, not this schema.
export const investmentHoldingInstrumentTypeEnum = pgEnum("investment_holding_instrument_type", ["mutual_fund", "etf"]);
export const investmentHoldingTransactionKindEnum = pgEnum("investment_holding_transaction_kind", ["opening", "buy", "sell", "distribution", "fee"]);
export const investmentQuoteSourceEnum = pgEnum("investment_quote_source", ["manual", "market"]);
export const contributionLimitKindEnum = pgEnum("contribution_limit_kind", ["rrsp", "tfsa", "fhsa", "resp", "other"]);
export const liabilityKindEnum = pgEnum("liability_kind", ["mortgage", "loan", "credit", "other"]);
export const liabilityStatusEnum = pgEnum("liability_status", ["active", "paid_off", "archived"]);
export const goalStatusEnum = pgEnum("goal_status", ["active", "achieved", "archived"]);
export const importBatchStatusEnum = pgEnum("import_batch_status", ["dry_run", "accepted", "failed", "blocked"]);
export const sourceMappingStatusEnum = pgEnum("source_mapping_status", ["imported", "derived", "archival", "ambiguous", "blocked"]);
export const migrationIssueSeverityEnum = pgEnum("migration_issue_severity", ["info", "warning", "blocking"]);
export const auditActionEnum = pgEnum("audit_action", ["import_accepted", "created", "updated", "deleted"]);

export type DrizzleCurrencyCode = (typeof currencyCodeEnum.enumValues)[number];
export type DrizzleAccountKind = (typeof accountKindEnum.enumValues)[number];
export type DrizzleRecurringCashFlowKind = (typeof recurringCashFlowKindEnum.enumValues)[number];
export type DrizzleRecurringWeekdayAdjustment = (typeof recurringWeekdayAdjustmentEnum.enumValues)[number];

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  onboardingState: text("onboarding_state").notNull().default("active"),
  isDemo: boolean("is_demo").notNull().default(false),
  demoFixtureVersion: integer("demo_fixture_version"),
  createdAt: createdAt(),
}, (table) => ({
  emailFormat: check("users_email_nonempty_check", sql`length(trim(${table.email})) > 0`),
  displayNameFormat: check("users_display_name_format_check", sql`${table.displayName} IS NULL OR (${table.displayName} = btrim(${table.displayName}) AND char_length(${table.displayName}) BETWEEN 1 AND 80)`),
  onboardingState: check("users_onboarding_state_check", sql`${table.onboardingState} IN ('active', 'dismissed', 'completed')`),
  demoState: check("users_demo_state_check", sql`(${table.isDemo} = false AND ${table.demoFixtureVersion} IS NULL) OR (${table.isDemo} = true AND ${table.demoFixtureVersion} > 0)`),
}));

export const workspacePrimaryOwner = pgTable("workspace_primary_owner", {
  id: smallint("id").primaryKey().default(1),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (table) => ({
  singleton: check("workspace_primary_owner_singleton_check", sql`${table.id} = 1`),
}));

export const pageHelpSeen = pgTable("page_help_seen", {
  ownerId: owner(),
  pageId: text("page_id").notNull(),
  seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  primary: primaryKey({ columns: [table.ownerId, table.pageId], name: "page_help_seen_pkey" }),
  pageIdFormat: check("page_help_seen_page_id_format_check", sql`${table.pageId} ~ '^[a-z][a-z0-9-]{0,63}$'`),
}));

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
}, (table) => ({
  emailIndex: uniqueIndex("auth_users_email_idx").on(table.email),
  nameNonempty: check("auth_users_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  emailNonempty: check("auth_users_email_nonempty_check", sql`length(trim(${table.email})) > 0`),
}));

export type CalculationWorkbookSnapshot = Record<string, unknown>;

export const calculationWorkbooks = pgTable("calculation_workbooks", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  snapshot: jsonb("snapshot").$type<CalculationWorkbookSnapshot>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("calculation_workbooks_owner_idx").on(table.ownerId),
  ownerName: uniqueIndex("calculation_workbooks_owner_name_idx").on(table.ownerId, table.name),
  nameFormat: check("calculation_workbooks_name_format_check", sql`(${table.name} = btrim(${table.name}) AND char_length(${table.name}) BETWEEN 1 AND 80)`),
  snapshotObject: check("calculation_workbooks_snapshot_object_check", sql`jsonb_typeof(${table.snapshot}) = 'object' AND pg_column_size(${table.snapshot}) <= 5000000`),
}));

export const authTwoFactors = pgTable("auth_two_factors", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(true),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
}, (table) => ({
  secretIndex: index("auth_two_factors_secret_idx").on(table.secret),
  userIndex: index("auth_two_factors_user_idx").on(table.userId),
}));

export const authPasskeys = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull(),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  aaguid: text("aaguid"),
}, (table) => ({
  userIndex: index("passkey_user_idx").on(table.userId),
  credentialIndex: index("passkey_credential_id_idx").on(table.credentialID),
  userForeignKey: foreignKey({
    columns: [table.userId],
    foreignColumns: [authUsers.id],
    name: "passkey_user_id_fkey",
  }).onDelete("cascade"),
}));

export const ownerNotifications = pgTable("owner_notifications", {
  id: id(),
  ownerId: uuid("owner_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  read: boolean("read").notNull().default(false),
  createdAt: createdAt(),
}, (table) => ({
  ownerCreated: index("owner_notifications_owner_created_idx").on(table.ownerId, table.createdAt),
  ownerUnread: index("owner_notifications_owner_unread_idx").on(table.ownerId, table.createdAt).where(sql`${table.read} = false`),
  ownerForeignKey: foreignKey({
    columns: [table.ownerId],
    foreignColumns: [users.id],
    name: "owner_notifications_owner_id_fkey",
  }).onDelete("cascade"),
  typeFormat: check("owner_notifications_type_check", sql`${table.type} IN ('new_session', 'recovery_code_used', 'passkey_registered', 'passkey_revoked', 'password_changed', 'mfa_changed')`),
  payloadObject: check("owner_notifications_payload_object_check", sql`jsonb_typeof(${table.payload}) = 'object' AND pg_column_size(${table.payload}) <= 8192`),
}));

export const authUserWorkspaces = pgTable("auth_user_workspaces", {
  authUserId: text("auth_user_id").notNull().primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
  athenaUserId: uuid("athena_user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (table) => ({
  athenaUserIndex: index("auth_user_workspaces_athena_user_idx").on(table.athenaUserId),
}));

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
}, (table) => ({
  tokenIndex: uniqueIndex("auth_sessions_token_idx").on(table.token),
  userIndex: index("auth_sessions_user_idx").on(table.userId),
  expiresIndex: index("auth_sessions_expires_idx").on(table.expiresAt),
}));

export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  issuerAccountIndex: uniqueIndex("auth_accounts_issuer_accountId_uidx").on(table.issuer, table.accountId),
  userIndex: index("auth_accounts_user_idx").on(table.userId),
}));

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  identifierIndex: index("auth_verifications_identifier_idx").on(table.identifier),
  expiresIndex: index("auth_verifications_expires_idx").on(table.expiresAt),
}));

export const authInvitations = pgTable("auth_invitations", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (table) => ({
  tokenHashIndex: uniqueIndex("auth_invitations_token_hash_idx").on(table.tokenHash),
  emailIndex: index("auth_invitations_email_idx").on(table.email),
  expiresIndex: index("auth_invitations_expires_idx").on(table.expiresAt),
}));

export const authRateLimits = pgTable("auth_rate_limits", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  key: text("key").notNull(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}, (table) => ({
  keyIndex: uniqueIndex("auth_rate_limits_key_idx").on(table.key),
  lastRequestIndex: index("auth_rate_limits_last_request_idx").on(table.lastRequest),
  countNonnegative: check("auth_rate_limits_count_nonnegative_check", sql`${table.count} >= 0`),
  lastRequestNonnegative: check("auth_rate_limits_last_request_nonnegative_check", sql`${table.lastRequest} >= 0`),
}));

export const institutions = pgTable("institutions", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
}, (table) => ({
  ownerName: uniqueIndex("institutions_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("institutions_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
}));

export const accountGroups = pgTable("account_groups", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  createdAt: createdAt(),
}, (table) => ({
  ownerName: uniqueIndex("account_groups_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("account_groups_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
}));

export const accounts = pgTable("accounts", {
  id: id(),
  ownerId: owner(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "restrict" }),
  groupId: uuid("group_id").references(() => accountGroups.id, { onDelete: "set null" }),
  timelineOrder: integer("timeline_order").notNull().default(0),
  name: text("name").notNull(),
  kind: accountKindEnum("kind").notNull(),
  customTypeLabel: text("custom_type_label"),
  lastFour: text("last_four"),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  isActive: boolean("is_active").notNull().default(true),
  includeInAvailableCash: boolean("include_in_available_cash").notNull().default(false),
  isVisibleInCashFlow: boolean("is_visible_in_cash_flow").notNull().default(true),
  useCashFlowPlannedTimeline: boolean("use_cash_flow_planned_timeline").notNull().default(false),
  createdAt: createdAt(),
}, (table) => ({
  owner: index("accounts_owner_idx").on(table.ownerId),
  ownerIdId: uniqueIndex("accounts_owner_id_id_idx").on(table.ownerId, table.id),
  ownerTimelineOrder: index("accounts_owner_timeline_order_idx").on(table.ownerId, table.timelineOrder, table.id),
  ownerAvailableCash: index("accounts_owner_available_cash_idx").on(table.ownerId, table.includeInAvailableCash),
  ownerCashFlowVisibility: index("accounts_owner_cash_flow_visibility_idx").on(table.ownerId, table.isVisibleInCashFlow),
  ownerCashFlowPlannedTimeline: index("accounts_owner_cf_planned_timeline_idx").on(table.ownerId, table.useCashFlowPlannedTimeline),
  ownerInstitutionName: uniqueIndex("accounts_owner_institution_name_idx").on(table.ownerId, table.institutionId, table.name),
  nameNonempty: check("accounts_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  timelineOrderNonnegative: check("accounts_timeline_order_nonnegative_check", sql`${table.timelineOrder} >= 0`),
  customTypeLabelNonempty: check("accounts_custom_type_label_nonempty_check", sql`${table.customTypeLabel} IS NULL OR length(trim(${table.customTypeLabel})) > 0`),
  customTypeLabelKind: check("accounts_custom_type_label_kind_check", sql`${table.kind} = 'other' OR ${table.customTypeLabel} IS NULL`),
  lastFourFormat: check("accounts_last_four_format_check", sql`${table.lastFour} IS NULL OR (${table.kind} = 'rdsp' AND ${table.lastFour} ~ '^[A-Za-z0-9]{4}$') OR (${table.kind} <> 'rdsp' AND ${table.lastFour} ~ '^[0-9]{4}$')`),
}));

export const envelopes = pgTable("envelopes", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  targetMinor: bigint("target_minor", { mode: "number" }).notNull().default(0),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
}, (table) => ({
  ownerName: uniqueIndex("envelopes_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("envelopes_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  targetNonnegative: check("envelopes_target_nonnegative_check", sql`${table.targetMinor} >= 0`),
}));

export const balanceSnapshots = pgTable("balance_snapshots", {
  id: id(),
  ownerId: owner(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  asOf: date("as_of").notNull(),
  balanceMinor: bigint("balance_minor", { mode: "number" }).notNull(),
  status: recordStatusEnum("status").notNull().default("planned"),
  isGenerated: boolean("is_generated").notNull().default(false),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
}, (table) => ({
  accountDate: uniqueIndex("balance_snapshots_account_date_idx").on(table.accountId, table.asOf),
  owner: index("balance_snapshots_owner_idx").on(table.ownerId),
  ownerDate: index("balance_snapshots_owner_date_idx").on(table.ownerId, table.asOf),
}));

export const accountContributionRules = pgTable("account_contribution_rules", {
  id: id(),
  ownerId: owner(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("account_contribution_rules_owner_idx").on(table.ownerId),
  account: index("account_contribution_rules_account_idx").on(table.accountId),
  ownerIdId: uniqueIndex("account_contribution_rules_owner_id_id_idx").on(table.ownerId, table.id),
  amountPositive: check("account_contribution_rules_amount_positive_check", sql`${table.amountMinor} > 0`),
  dateOrder: check("account_contribution_rules_date_order_check", sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`),
  supportedFrequency: check("account_contribution_rules_frequency_check", sql`${table.frequency} <> 'quarterly'`),
}));

export const accountContributionExceptions = pgTable("account_contribution_exceptions", {
  id: id(),
  ownerId: owner(),
  ruleId: uuid("rule_id").notNull().references(() => accountContributionRules.id, { onDelete: "cascade" }),
  occurrenceOn: date("occurrence_on").notNull(),
  kind: accountContributionExceptionKindEnum("kind").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("account_contribution_exceptions_owner_idx").on(table.ownerId),
  rule: index("account_contribution_exceptions_rule_idx").on(table.ruleId),
  ruleOccurrence: uniqueIndex("account_contribution_exceptions_rule_occurrence_idx").on(table.ruleId, table.occurrenceOn),
  amountValid: check("account_contribution_exceptions_amount_check", sql`(${table.kind} = 'skip' AND ${table.amountMinor} IS NULL) OR (${table.kind} = 'override' AND ${table.amountMinor} > 0)`),
}));

export const cashFlowPeriods = pgTable("cash_flow_periods", {
  id: id(),
  ownerId: owner(),
  label: text("label").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  payDate: date("pay_date").notNull(),
  openingBalanceMinor: bigint("opening_balance_minor", { mode: "number" }).notNull().default(0),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  status: cashFlowPeriodStatusEnum("status").notNull().default("planned"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("cash_flow_periods_owner_idx").on(table.ownerId),
  ownerStart: uniqueIndex("cash_flow_periods_owner_start_idx").on(table.ownerId, table.startsOn),
  ownerPaydate: index("cash_flow_periods_owner_paydate_idx").on(table.ownerId, table.payDate, table.id),
  labelNonempty: check("cash_flow_periods_label_nonempty_check", sql`length(trim(${table.label})) > 0`),
  dateOrder: check("cash_flow_periods_date_order_check", sql`${table.endsOn} >= ${table.startsOn}`),
}));

export const cashFlowPaydayChecks = pgTable("cash_flow_payday_checks", {
  id: id(),
  ownerId: owner(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  payDate: date("pay_date").notNull(),
  projectedBalanceMinor: bigint("projected_balance_minor", { mode: "number" }).notNull(),
  actualBalanceMinor: bigint("actual_balance_minor", { mode: "number" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerAccountPayday: uniqueIndex("cash_flow_payday_checks_owner_account_payday_idx").on(table.ownerId, table.accountId, table.payDate),
}));

export const accountBalanceNotes = pgTable("account_balance_notes", {
  id: id(),
  ownerId: owner(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  asOf: date("as_of").notNull(),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerAccountPayday: uniqueIndex("account_balance_notes_owner_account_payday_idx").on(table.ownerId, table.accountId, table.asOf),
  account: index("account_balance_notes_account_idx").on(table.accountId),
  noteLength: check("account_balance_notes_note_length_check", sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`),
}));

export const recurringCashFlowSeries = pgTable("recurring_cash_flow_series", {
  id: id(),
  ownerId: owner(),
  kind: recurringCashFlowKindEnum("kind").notNull(),
  state: recurringSeriesStateEnum("state").notNull().default("active"),
  endedOn: date("ended_on"),
  /** When set, this series is the Cash Flow counterpart of the Home monthly/bi-weekly household total. */
  homeHouseholdFrequency: text("home_household_frequency"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerIdId: uniqueIndex("recurring_cash_flow_series_owner_id_id_idx").on(table.ownerId, table.id),
  ownerState: index("recurring_cash_flow_series_owner_state_idx").on(table.ownerId, table.state, table.id),
  ownerHomeHouseholdFrequency: uniqueIndex("recurring_cash_flow_series_owner_home_household_frequency_idx")
    .on(table.ownerId, table.homeHouseholdFrequency)
    .where(sql`${table.homeHouseholdFrequency} IS NOT NULL`),
  stateEnd: check("recurring_cash_flow_series_state_end_check", sql`(${table.state} = 'ended' AND ${table.endedOn} IS NOT NULL) OR (${table.state} <> 'ended' AND ${table.endedOn} IS NULL)`),
  kind: check("recurring_cash_flow_series_kind_check", sql`${table.kind} IN ('income', 'expense', 'transfer')`),
  homeHouseholdFrequency: check(
    "recurring_cash_flow_series_home_household_frequency_check",
    sql`${table.homeHouseholdFrequency} IS NULL OR ${table.homeHouseholdFrequency} IN ('biweekly', 'monthly')`,
  ),
}));

export const transactions = pgTable("transactions", {
  id: id(),
  ownerId: owner(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  periodId: uuid("period_id").references(() => cashFlowPeriods.id, { onDelete: "set null" }),
  envelopeId: uuid("envelope_id").references(() => envelopes.id, { onDelete: "set null" }),
  recurringTransactionId: uuid("recurring_transaction_id").references(() => recurringTransactions.id, { onDelete: "set null" }),
  recurringSeriesId: uuid("recurring_series_id").references(() => recurringCashFlowSeries.id, { onDelete: "set null" }),
  recurringOccurrenceId: uuid("recurring_occurrence_id"),
  scheduledOccurrenceOn: date("scheduled_occurrence_on"),
  isGenerated: boolean("is_generated").notNull().default(false),
  transactionDate: date("transaction_date").notNull(),
  kind: transactionKindEnum("kind").notNull(),
  status: recordStatusEnum("status").notNull().default("planned"),
  isExcluded: boolean("is_excluded").notNull().default(false),
  description: text("description").notNull(),
  category: text("category"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerDate: index("transactions_owner_date_idx").on(table.ownerId, table.transactionDate),
  periodDate: index("transactions_period_date_idx").on(table.periodId, table.transactionDate),
  accountDate: index("transactions_account_date_idx").on(table.accountId, table.transactionDate),
  ownerRecurringSeries: index("transactions_owner_recurring_series_idx").on(table.ownerId, table.recurringSeriesId, table.transactionDate),
  recurringOccurrenceId: uniqueIndex("transactions_recurring_occurrence_id_idx").on(table.recurringOccurrenceId).where(sql`${table.recurringOccurrenceId} IS NOT NULL`),
  recurringScheduledOccurrence: uniqueIndex("transactions_recurring_scheduled_occurrence_idx").on(table.recurringSeriesId, table.scheduledOccurrenceOn).where(sql`${table.isGenerated} = true AND ${table.recurringSeriesId} IS NOT NULL AND ${table.scheduledOccurrenceOn} IS NOT NULL`),
  descriptionNonempty: check("transactions_description_nonempty_check", sql`length(trim(${table.description})) > 0`),
  amountNonnegative: check("transactions_amount_nonnegative_check", sql`${table.amountMinor} >= 0`),
  generatedIdentity: check("transactions_generated_identity_check", sql`${table.isGenerated} = false OR (${table.recurringTransactionId} IS NOT NULL AND ${table.recurringSeriesId} IS NOT NULL AND ${table.recurringOccurrenceId} IS NOT NULL AND ${table.scheduledOccurrenceOn} IS NOT NULL)`),
}));

export const transfers = pgTable("transfers", {
  id: id(),
  ownerId: owner(),
  periodId: uuid("period_id").references(() => cashFlowPeriods.id, { onDelete: "set null" }),
  fromAccountId: uuid("from_account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  toAccountId: uuid("to_account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  recurringTransactionId: uuid("recurring_transaction_id").references(() => recurringTransactions.id, { onDelete: "set null" }),
  recurringSeriesId: uuid("recurring_series_id").references(() => recurringCashFlowSeries.id, { onDelete: "set null" }),
  recurringOccurrenceId: uuid("recurring_occurrence_id"),
  scheduledOccurrenceOn: date("scheduled_occurrence_on"),
  isGenerated: boolean("is_generated").notNull().default(false),
  transferDate: date("transfer_date").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  status: recordStatusEnum("status").notNull().default("planned"),
  description: text("description").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerDate: index("transfers_owner_date_idx").on(table.ownerId, table.transferDate),
  ownerPeriodDate: index("transfers_owner_period_date_idx").on(table.ownerId, table.periodId, table.transferDate),
  ownerRecurringSeries: index("transfers_owner_recurring_series_idx").on(table.ownerId, table.recurringSeriesId, table.transferDate),
  fromAccountDate: index("transfers_from_account_date_idx").on(table.fromAccountId, table.transferDate),
  toAccountDate: index("transfers_to_account_date_idx").on(table.toAccountId, table.transferDate),
  recurringOccurrenceId: uniqueIndex("transfers_recurring_occurrence_id_idx").on(table.recurringOccurrenceId).where(sql`${table.recurringOccurrenceId} IS NOT NULL`),
  recurringScheduledOccurrence: uniqueIndex("transfers_recurring_scheduled_occurrence_idx").on(table.recurringSeriesId, table.scheduledOccurrenceOn).where(sql`${table.isGenerated} = true AND ${table.recurringSeriesId} IS NOT NULL AND ${table.scheduledOccurrenceOn} IS NOT NULL`),
  descriptionNonempty: check("transfers_description_nonempty_check", sql`length(trim(${table.description})) > 0`),
  amountPositive: check("transfers_amount_positive_check", sql`${table.amountMinor} > 0`),
  distinctAccounts: check("transfers_distinct_accounts_check", sql`${table.fromAccountId} <> ${table.toAccountId}`),
  generatedIdentity: check("transfers_generated_identity_check", sql`${table.isGenerated} = false OR (${table.recurringTransactionId} IS NOT NULL AND ${table.recurringSeriesId} IS NOT NULL AND ${table.recurringOccurrenceId} IS NOT NULL AND ${table.scheduledOccurrenceOn} IS NOT NULL)`),
}));

export const recurringTransactions = pgTable("recurring_transactions", {
  id: id(),
  ownerId: owner(),
  seriesId: uuid("series_id").notNull().references(() => recurringCashFlowSeries.id, { onDelete: "cascade" }),
  supersedesVersionId: uuid("supersedes_version_id").references((): AnyPgColumn => recurringTransactions.id, { onDelete: "set null" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  fromAccountId: uuid("from_account_id").references(() => accounts.id, { onDelete: "restrict" }),
  toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "restrict" }),
  envelopeId: uuid("envelope_id").references(() => envelopes.id, { onDelete: "set null" }),
  kind: recurringCashFlowKindEnum("kind").notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  weekdayAdjustment: recurringWeekdayAdjustmentEnum("weekday_adjustment").notNull().default("none"),
  description: text("description").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  versionNote: text("version_note"),
  countsAsExpense: boolean("counts_as_expense").notNull().default(false),
  nextOccurrenceOn: date("next_occurrence_on").notNull(),
  status: recordStatusEnum("status").notNull().default("planned"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerNextOccurrence: index("recurring_transactions_owner_next_occurrence_idx").on(table.ownerId, table.nextOccurrenceOn),
  ownerSeries: index("recurring_transactions_owner_series_idx").on(table.ownerId, table.seriesId, table.effectiveFrom),
  seriesEffectiveStart: uniqueIndex("recurring_transactions_series_effective_start_idx").on(table.seriesId, table.effectiveFrom),
  supersedesVersion: index("recurring_transactions_supersedes_version_idx").on(table.supersedesVersionId),
  account: index("recurring_transactions_account_idx").on(table.accountId),
  fromAccount: index("recurring_transactions_from_account_idx").on(table.fromAccountId),
  toAccount: index("recurring_transactions_to_account_idx").on(table.toAccountId),
  descriptionNonempty: check("recurring_transactions_description_nonempty_check", sql`length(trim(${table.description})) > 0`),
  amountPositive: check("recurring_transactions_amount_positive_check", sql`${table.amountMinor} > 0`),
  dateOrder: check("recurring_transactions_date_order_check", sql`${table.endsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`),
  effectiveDateOrder: check("recurring_transactions_effective_date_order_check", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
  supersedesSelf: check("recurring_transactions_supersedes_self_check", sql`${table.supersedesVersionId} IS NULL OR ${table.supersedesVersionId} <> ${table.id}`),
  supportedKind: check("recurring_transactions_kind_check", sql`${table.kind} IN ('income', 'expense', 'transfer')`),
  transferEndpoints: check("recurring_transactions_transfer_endpoint_check", sql`(${table.kind} = 'transfer' AND ${table.accountId} IS NULL AND ${table.fromAccountId} IS NOT NULL AND ${table.toAccountId} IS NOT NULL AND ${table.fromAccountId} <> ${table.toAccountId}) OR (${table.kind} <> 'transfer' AND ${table.fromAccountId} IS NULL AND ${table.toAccountId} IS NULL)`),
  countsAsExpenseKind: check("recurring_transactions_counts_as_expense_kind_check", sql`${table.countsAsExpense} = false OR ${table.kind} = 'transfer'`),
}));

export const recurringCashFlowOverrideGroups = pgTable("recurring_cash_flow_override_groups", {
  id: id(),
  ownerId: owner(),
  seriesId: uuid("series_id").notNull().references(() => recurringCashFlowSeries.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").notNull().references(() => recurringTransactions.id, { onDelete: "cascade" }),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerSeries: index("recurring_cash_flow_override_groups_owner_series_idx").on(table.ownerId, table.seriesId, table.isActive, table.id),
}));

export const recurringCashFlowOccurrenceExceptions = pgTable("recurring_cash_flow_occurrence_exceptions", {
  id: id(),
  ownerId: owner(),
  seriesId: uuid("series_id").notNull().references(() => recurringCashFlowSeries.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").notNull().references(() => recurringTransactions.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
  transferId: uuid("transfer_id").references(() => transfers.id, { onDelete: "cascade" }),
  scheduledOccurrenceOn: date("scheduled_occurrence_on").notNull(),
  overrideGroupId: uuid("override_group_id").references(() => recurringCashFlowOverrideGroups.id, { onDelete: "set null" }),
  kind: recurringOccurrenceExceptionKindEnum("kind").notNull(),
  dateOverride: date("date_override"),
  amountOverrideMinor: bigint("amount_override_minor", { mode: "number" }),
  accountOverrideId: uuid("account_override_id").references(() => accounts.id, { onDelete: "set null" }),
  fromAccountOverrideId: uuid("from_account_override_id").references(() => accounts.id, { onDelete: "set null" }),
  toAccountOverrideId: uuid("to_account_override_id").references(() => accounts.id, { onDelete: "set null" }),
  statusOverride: recordStatusEnum("status_override"),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerSeries: index("recurring_cash_flow_occurrence_exceptions_owner_series_idx").on(table.ownerId, table.seriesId, table.scheduledOccurrenceOn),
  ownerTransaction: index("rcfoe_owner_transaction_idx").on(table.ownerId, table.transactionId).where(sql`${table.transactionId} IS NOT NULL`),
  ownerTransfer: index("rcfoe_owner_transfer_idx").on(table.ownerId, table.transferId).where(sql`${table.transferId} IS NOT NULL`),
  ownerOverrideGroup: index("rcfoe_owner_override_group_idx").on(table.ownerId, table.overrideGroupId).where(sql`${table.overrideGroupId} IS NOT NULL`),
  activeOccurrence: uniqueIndex("recurring_cash_flow_occurrence_exceptions_active_occurrence_idx").on(table.seriesId, table.scheduledOccurrenceOn).where(sql`${table.isActive} = true`),
  values: check("recurring_cash_flow_occurrence_exceptions_value_check", sql`(${table.kind} = 'skip' AND ${table.dateOverride} IS NULL AND ${table.amountOverrideMinor} IS NULL AND ${table.accountOverrideId} IS NULL AND ${table.fromAccountOverrideId} IS NULL AND ${table.toAccountOverrideId} IS NULL AND ${table.statusOverride} IS NULL) OR (${table.kind} = 'override' AND (${table.dateOverride} IS NOT NULL OR ${table.amountOverrideMinor} IS NOT NULL OR ${table.accountOverrideId} IS NOT NULL OR ${table.fromAccountOverrideId} IS NOT NULL OR ${table.toAccountOverrideId} IS NOT NULL OR ${table.statusOverride} IS NOT NULL))`),
  target: check("recurring_cash_flow_occurrence_exceptions_target_check", sql`${table.transactionId} IS NULL OR ${table.transferId} IS NULL`),
  transferEndpoints: check("recurring_cash_flow_occurrence_exceptions_transfer_endpoint_check", sql`(${table.fromAccountOverrideId} IS NULL) = (${table.toAccountOverrideId} IS NULL) OR (${table.fromAccountOverrideId} IS NOT NULL AND ${table.toAccountOverrideId} IS NOT NULL)`),
  amount: check("recurring_cash_flow_occurrence_exceptions_amount_check", sql`${table.amountOverrideMinor} IS NULL OR ${table.amountOverrideMinor} > 0`),
  status: check("recurring_cash_flow_occurrence_exceptions_status_check", sql`${table.statusOverride} IS NULL OR ${table.statusOverride} = 'planned'`),
}));

export const annualBudgets = pgTable("annual_budgets", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  linkedAccountId: uuid("linked_account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerOrder: index("annual_budgets_owner_order_idx").on(table.ownerId, table.displayOrder, table.id),
  ownerName: uniqueIndex("annual_budgets_owner_name_active_idx").on(table.ownerId, table.name).where(sql`${table.isActive} = true`),
  ownerAccount: uniqueIndex("annual_budgets_owner_account_active_idx").on(table.ownerId, table.linkedAccountId).where(sql`${table.isActive} = true`),
  nameNonempty: check("annual_budgets_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  displayOrderNonnegative: check("annual_budgets_display_order_nonnegative_check", sql`${table.displayOrder} >= 0`),
}));

export const annualExpenses = pgTable("annual_expenses", {
  id: id(),
  ownerId: owner(),
  budgetId: uuid("budget_id").notNull().references(() => annualBudgets.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  envelopeId: uuid("envelope_id").references(() => envelopes.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  fundedMinor: bigint("funded_minor", { mode: "number" }).notNull().default(0),
  dueMonth: smallint("due_month"),
  dueDay: smallint("due_day"),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("annual_expenses_owner_idx").on(table.ownerId),
  budget: index("annual_expenses_budget_idx").on(table.budgetId),
  ownerName: index("annual_expenses_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("annual_expenses_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  amountNonnegative: check("annual_expenses_amount_nonnegative_check", sql`${table.amountMinor} >= 0`),
  fundedNonnegative: check("annual_expenses_funded_nonnegative_check", sql`${table.fundedMinor} >= 0`),
  dueMonthValid: check("annual_expenses_due_month_check", sql`${table.dueMonth} IS NULL OR (${table.dueMonth} BETWEEN 1 AND 12)`),
  dueDayValid: check("annual_expenses_due_day_check", sql`${table.dueDay} IS NULL OR (${table.dueDay} BETWEEN 1 AND 31)`),
}));

export const annualExpenseValues = pgTable("annual_expense_values", {
  id: id(),
  ownerId: owner(),
  annualExpenseId: uuid("annual_expense_id").notNull().references(() => annualExpenses.id, { onDelete: "cascade" }),
  budgetId: uuid("budget_id").notNull().references(() => annualBudgets.id, { onDelete: "restrict" }),
  taxYear: integer("tax_year").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  amountOverrideMinor: bigint("amount_override_minor", { mode: "number" }),
  dueMonthOverride: smallint("due_month_override"),
  dueDayOverride: smallint("due_day_override"),
  note: text("note"),
  fundedMinor: bigint("funded_minor", { mode: "number" }).notNull().default(0),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerYear: index("annual_expense_values_owner_year_idx").on(table.ownerId, table.taxYear),
  budgetYear: index("annual_expense_values_budget_year_idx").on(table.budgetId, table.taxYear),
  expenseYear: uniqueIndex("annual_expense_values_expense_year_idx").on(table.annualExpenseId, table.taxYear),
  yearValid: check("annual_expense_values_year_check", sql`${table.taxYear} BETWEEN 1900 AND 2200`),
  amountNonnegative: check("annual_expense_values_amount_nonnegative_check", sql`${table.amountMinor} >= 0`),
  amountOverrideNonnegative: check("annual_expense_values_amount_override_nonnegative_check", sql`${table.amountOverrideMinor} IS NULL OR ${table.amountOverrideMinor} >= 0`),
  dueMonthOverrideValid: check("annual_expense_values_due_month_override_check", sql`${table.dueMonthOverride} IS NULL OR (${table.dueMonthOverride} BETWEEN 1 AND 12)`),
  dueDayOverrideValid: check("annual_expense_values_due_day_override_check", sql`${table.dueDayOverride} IS NULL OR (${table.dueDayOverride} BETWEEN 1 AND 31)`),
  fundedNonnegative: check("annual_expense_values_funded_nonnegative_check", sql`${table.fundedMinor} >= 0`),
}));

export const annualExpensePayments = pgTable("annual_expense_payments", {
  id: id(),
  ownerId: owner(),
  annualExpenseValueId: uuid("annual_expense_value_id").notNull().references(() => annualExpenseValues.id, { onDelete: "cascade" }),
  paymentOn: date("payment_on").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  occurrenceDate: index("annual_expense_payments_occurrence_date_idx").on(table.annualExpenseValueId, table.paymentOn, table.id),
  ownerDate: index("annual_expense_payments_owner_date_idx").on(table.ownerId, table.paymentOn),
  amountPositive: check("annual_expense_payments_amount_positive_check", sql`${table.amountMinor} > 0`),
}));

export const householdExpenses = pgTable("household_expenses", {
  id: id(),
  ownerId: owner(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  category: text("category"),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  annualAmountMinor: bigint("annual_amount_minor", { mode: "number" }).notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerName: uniqueIndex("household_expenses_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("household_expenses_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  amountNonnegative: check("household_expenses_amount_nonnegative_check", sql`${table.amountMinor} >= 0`),
  annualAmountNonnegative: check("household_expenses_annual_amount_nonnegative_check", sql`${table.annualAmountMinor} >= 0`),
  dateOrder: check("household_expenses_date_order_check", sql`${table.endsOn} IS NULL OR ${table.startsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`),
}));

export const annualMaintenanceItems = pgTable("annual_maintenance_items", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("annual_maintenance_items_owner_idx").on(table.ownerId),
  ownerName: uniqueIndex("annual_maintenance_items_owner_name_idx").on(table.ownerId, table.name).where(sql`${table.isActive} = true`),
  nameNonempty: check("annual_maintenance_items_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  amountNonnegative: check("annual_maintenance_items_amount_nonnegative_check", sql`${table.amountMinor} >= 0`),
  supportedFrequency: check("annual_maintenance_items_frequency_check", sql`${table.frequency} <> 'quarterly'`),
}));

export const homes = pgTable("homes", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull().default("Home"),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: uniqueIndex("homes_owner_idx").on(table.ownerId),
  nameNonempty: check("homes_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
}));

export const homeValueSnapshots = pgTable("home_value_snapshots", {
  id: id(),
  ownerId: owner(),
  homeId: uuid("home_id").notNull().references(() => homes.id, { onDelete: "cascade" }),
  asOf: date("as_of").notNull(),
  marketValueMinor: bigint("market_value_minor", { mode: "number" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("home_value_snapshots_owner_idx").on(table.ownerId),
  homeDate: uniqueIndex("home_value_snapshots_home_date_idx").on(table.homeId, table.asOf),
  marketValueNonnegative: check("home_value_snapshots_market_value_nonnegative_check", sql`${table.marketValueMinor} >= 0`),
}));

export const homeMortgageTerms = pgTable("home_mortgage_terms", {
  id: id(),
  ownerId: owner(),
  homeId: uuid("home_id").notNull().references(() => homes.id, { onDelete: "cascade" }),
  effectiveOn: date("effective_on").notNull(),
  annualRateBps: integer("annual_rate_bps").notNull(),
  compoundingConvention: homeMortgageCompoundingEnum("compounding_convention").notNull(),
  paymentExpenseId: uuid("payment_expense_id").notNull().references(() => householdExpenses.id, { onDelete: "restrict" }),
  paymentMinor: bigint("payment_minor", { mode: "number" }).notNull(),
  nextPaymentOn: date("next_payment_on").notNull(),
  renewalOn: date("renewal_on").notNull(),
  payoffOn: date("payoff_on").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("home_mortgage_terms_owner_idx").on(table.ownerId),
  homeEffective: uniqueIndex("home_mortgage_terms_home_effective_idx").on(table.homeId, table.effectiveOn),
  rateValid: check("home_mortgage_terms_rate_check", sql`${table.annualRateBps} BETWEEN 0 AND 10000`),
  paymentPositive: check("home_mortgage_terms_payment_positive_check", sql`${table.paymentMinor} > 0`),
  dateOrder: check("home_mortgage_terms_date_order_check", sql`${table.nextPaymentOn} >= ${table.effectiveOn} AND ${table.renewalOn} > ${table.effectiveOn} AND ${table.payoffOn} > ${table.effectiveOn}`),
}));

export const homeMortgageAnchors = pgTable("home_mortgage_anchors", {
  id: id(),
  ownerId: owner(),
  homeId: uuid("home_id").notNull().references(() => homes.id, { onDelete: "cascade" }),
  asOf: date("as_of").notNull(),
  principalMinor: bigint("principal_minor", { mode: "number" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  owner: index("home_mortgage_anchors_owner_idx").on(table.ownerId),
  homeDate: uniqueIndex("home_mortgage_anchors_home_date_idx").on(table.homeId, table.asOf),
  principalNonnegative: check("home_mortgage_anchors_principal_nonnegative_check", sql`${table.principalMinor} >= 0`),
}));

export const liabilities = pgTable("liabilities", {
  id: id(),
  ownerId: owner(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  lender: text("lender"),
  kind: liabilityKindEnum("kind").notNull(),
  status: liabilityStatusEnum("status").notNull().default("active"),
  originalBalanceMinor: bigint("original_balance_minor", { mode: "number" }),
  currentBalanceMinor: bigint("current_balance_minor", { mode: "number" }).notNull(),
  interestRateBps: integer("interest_rate_bps"),
  minimumPaymentMinor: bigint("minimum_payment_minor", { mode: "number" }).notNull().default(0),
  paymentFrequency: recurringFrequencyEnum("payment_frequency"),
  asOf: date("as_of").notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerName: uniqueIndex("liabilities_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("liabilities_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  originalBalanceNonnegative: check("liabilities_original_balance_nonnegative_check", sql`${table.originalBalanceMinor} IS NULL OR ${table.originalBalanceMinor} >= 0`),
  currentBalanceNonnegative: check("liabilities_current_balance_nonnegative_check", sql`${table.currentBalanceMinor} >= 0`),
  minimumPaymentNonnegative: check("liabilities_minimum_payment_nonnegative_check", sql`${table.minimumPaymentMinor} >= 0`),
  interestRateValid: check("liabilities_interest_rate_check", sql`${table.interestRateBps} IS NULL OR ${table.interestRateBps} >= 0`),
}));

export const salaryScenarios = pgTable("salary_scenarios", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  effectiveOn: date("effective_on").notNull(),
  annualGrossMinor: bigint("annual_gross_minor", { mode: "number" }).notNull(),
  annualNetMinor: bigint("annual_net_minor", { mode: "number" }),
  perPayMinor: bigint("per_pay_minor", { mode: "number" }),
  payPeriodsPerYear: smallint("pay_periods_per_year").notNull().default(26),
  status: scenarioStatusEnum("status").notNull().default("draft"),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerEffective: index("salary_scenarios_owner_effective_idx").on(table.ownerId, table.effectiveOn),
  ownerNameDate: uniqueIndex("salary_scenarios_owner_name_date_idx").on(table.ownerId, table.name, table.effectiveOn),
  nameNonempty: check("salary_scenarios_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  grossNonnegative: check("salary_scenarios_gross_nonnegative_check", sql`${table.annualGrossMinor} >= 0`),
  netNonnegative: check("salary_scenarios_net_nonnegative_check", sql`${table.annualNetMinor} IS NULL OR ${table.annualNetMinor} >= 0`),
  perPayNonnegative: check("salary_scenarios_per_pay_nonnegative_check", sql`${table.perPayMinor} IS NULL OR ${table.perPayMinor} >= 0`),
  payPeriodsValid: check("salary_scenarios_pay_periods_check", sql`${table.payPeriodsPerYear} BETWEEN 1 AND 366`),
}));

export const salaryYears = pgTable("salary_years", {
  id: id(),
  ownerId: owner(),
  taxYear: smallint("tax_year").notNull(),
  annualBaseMinor: bigint("annual_base_minor", { mode: "number" }),
  status: salaryYearStatusEnum("status").notNull().default("in_progress"),
  finalFederalMinor: bigint("final_federal_minor", { mode: "number" }),
  payPeriodsPerYearOverride: smallint("pay_periods_per_year_override"),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerTaxYear: uniqueIndex("salary_years_owner_tax_year_idx").on(table.ownerId, table.taxYear),
  ownerIdId: uniqueIndex("salary_years_owner_id_id_idx").on(table.ownerId, table.id),
  taxYearValid: check("salary_years_tax_year_check", sql`${table.taxYear} BETWEEN 1900 AND 2200`),
  baseNonnegative: check("salary_years_base_nonnegative_check", sql`${table.annualBaseMinor} IS NULL OR ${table.annualBaseMinor} >= 0`),
  finalNonnegative: check("salary_years_final_nonnegative_check", sql`${table.finalFederalMinor} IS NULL OR ${table.finalFederalMinor} >= 0`),
  payPeriodsValid: check("salary_years_pay_periods_check", sql`${table.payPeriodsPerYearOverride} IS NULL OR ${table.payPeriodsPerYearOverride} BETWEEN 1 AND 366`),
  statusFinalPair: check("salary_years_status_final_check", sql`(${table.status} = 'finalized' AND ${table.finalFederalMinor} IS NOT NULL) OR (${table.status} = 'in_progress' AND ${table.finalFederalMinor} IS NULL)`),
}));

export const salarySnapshots = pgTable("salary_snapshots", {
  id: id(),
  ownerId: owner(),
  salaryYearId: uuid("salary_year_id").notNull(),
  snapshotOn: date("snapshot_on").notNull(),
  federalCumulativeMinor: bigint("federal_cumulative_minor", { mode: "number" }).notNull(),
  provincialCumulativeMinor: bigint("provincial_cumulative_minor", { mode: "number" }).notNull(),
  completedPayNumber: smallint("completed_pay_number").notNull(),
  completedPayNumberOverride: smallint("completed_pay_number_override"),
  rrqContributionYtdMinor: bigint("rrq_contribution_ytd_minor", { mode: "number" }),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerYearDate: uniqueIndex("salary_snapshots_owner_year_date_idx").on(table.ownerId, table.salaryYearId, table.snapshotOn),
  federalNonnegative: check("salary_snapshots_federal_nonnegative_check", sql`${table.federalCumulativeMinor} >= 0`),
  provincialNonnegative: check("salary_snapshots_provincial_nonnegative_check", sql`${table.provincialCumulativeMinor} >= 0`),
  completedPayValid: check("salary_snapshots_completed_pay_check", sql`${table.completedPayNumber} BETWEEN 1 AND 366`),
  completedPayOverrideValid: check("salary_snapshots_completed_pay_override_check", sql`${table.completedPayNumberOverride} IS NULL OR ${table.completedPayNumberOverride} BETWEEN 1 AND 366`),
  rrqContributionNonnegative: check("salary_snapshots_rrq_contribution_ytd_nonnegative_check", sql`${table.rrqContributionYtdMinor} IS NULL OR ${table.rrqContributionYtdMinor} >= 0`),
  ownerYearForeignKey: foreignKey({
    columns: [table.ownerId, table.salaryYearId],
    foreignColumns: [salaryYears.ownerId, salaryYears.id],
    name: "salary_snapshots_owner_year_fk",
  }),
}));

export const salaryYearsRelations = relations(salaryYears, ({ many }) => ({
  snapshots: many(salarySnapshots),
}));

export const salarySnapshotsRelations = relations(salarySnapshots, ({ one }) => ({
  salaryYear: one(salaryYears, {
    fields: [salarySnapshots.ownerId, salarySnapshots.salaryYearId],
    references: [salaryYears.ownerId, salaryYears.id],
  }),
}));

export const rrqYearLimits = pgTable("rrq_year_limits", {
  taxYear: smallint("tax_year").primaryKey(),
  firstMaximumMinor: bigint("first_maximum_minor", { mode: "number" }).notNull(),
  additionalMaximumMinor: bigint("additional_maximum_minor", { mode: "number" }).notNull(),
  ympeMinor: bigint("ympe_minor", { mode: "number" }).notNull(),
  yampeMinor: bigint("yampe_minor", { mode: "number" }).notNull(),
  firstRateBps: bigint("first_rate_bps", { mode: "number" }).notNull(),
  additionalRateBps: bigint("additional_rate_bps", { mode: "number" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  taxYearValid: check("rrq_year_limits_tax_year_check", sql`${table.taxYear} BETWEEN 1900 AND 2200`),
  firstMaximumNonnegative: check("rrq_year_limits_first_maximum_nonnegative_check", sql`${table.firstMaximumMinor} >= 0`),
  additionalMaximumNonnegative: check("rrq_year_limits_additional_maximum_nonnegative_check", sql`${table.additionalMaximumMinor} >= 0`),
  ympePositive: check("rrq_year_limits_ympe_positive_check", sql`${table.ympeMinor} > 0`),
  yampePositive: check("rrq_year_limits_yampe_positive_check", sql`${table.yampeMinor} > 0`),
  yampeNotBelowYmpe: check("rrq_year_limits_yampe_not_below_ympe_check", sql`${table.yampeMinor} >= ${table.ympeMinor}`),
  firstRatePositive: check("rrq_year_limits_first_rate_positive_check", sql`${table.firstRateBps} > 0`),
  additionalRatePositive: check("rrq_year_limits_additional_rate_positive_check", sql`${table.additionalRateBps} > 0`),
}));

export const rrqYearLimitOverrides = pgTable("rrq_year_limit_overrides", {
  id: id(),
  ownerId: owner(),
  taxYear: smallint("tax_year").notNull(),
  firstMaximumMinor: bigint("first_maximum_minor", { mode: "number" }).notNull(),
  additionalMaximumMinor: bigint("additional_maximum_minor", { mode: "number" }).notNull(),
  ympeMinor: bigint("ympe_minor", { mode: "number" }).notNull(),
  yampeMinor: bigint("yampe_minor", { mode: "number" }).notNull(),
  firstRateBps: bigint("first_rate_bps", { mode: "number" }).notNull(),
  additionalRateBps: bigint("additional_rate_bps", { mode: "number" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerTaxYear: uniqueIndex("rrq_year_limit_overrides_owner_tax_year_idx").on(table.ownerId, table.taxYear),
  taxYearValid: check("rrq_year_limit_overrides_tax_year_check", sql`${table.taxYear} BETWEEN 1900 AND 2200`),
  firstMaximumNonnegative: check("rrq_year_limit_overrides_first_maximum_nonnegative_check", sql`${table.firstMaximumMinor} >= 0`),
  additionalMaximumNonnegative: check("rrq_year_limit_overrides_additional_maximum_nonnegative_check", sql`${table.additionalMaximumMinor} >= 0`),
  ympePositive: check("rrq_year_limit_overrides_ympe_positive_check", sql`${table.ympeMinor} > 0`),
  yampePositive: check("rrq_year_limit_overrides_yampe_positive_check", sql`${table.yampeMinor} > 0`),
  yampeNotBelowYmpe: check("rrq_year_limit_overrides_yampe_not_below_ympe_check", sql`${table.yampeMinor} >= ${table.ympeMinor}`),
  firstRatePositive: check("rrq_year_limit_overrides_first_rate_positive_check", sql`${table.firstRateBps} > 0`),
  additionalRatePositive: check("rrq_year_limit_overrides_additional_rate_positive_check", sql`${table.additionalRateBps} > 0`),
}));

export const sharedProjects = pgTable("shared_projects", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  projectYear: smallint("project_year").notNull(),
  ownerParticipates: boolean("owner_participates").notNull().default(false),
  note: text("note"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerYear: index("shared_projects_owner_year_idx").on(table.ownerId, table.projectYear, table.id),
  ownerArchive: index("shared_projects_owner_archive_idx").on(table.ownerId, table.archivedAt, table.id),
  ownerIdId: uniqueIndex("shared_projects_owner_id_id_idx").on(table.ownerId, table.id),
  nameNonempty: check("shared_projects_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  yearValid: check("shared_projects_year_check", sql`${table.projectYear} BETWEEN 1900 AND 2200`),
  noteLength: check("shared_projects_note_length_check", sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`),
}));

export const sharedProjectExpenses = pgTable("shared_project_expenses", {
  id: id(),
  ownerId: owner(),
  projectId: uuid("project_id").notNull(),
  description: text("description").notNull(),
  expenseOn: date("expense_on"),
  quantity: integer("quantity").notNull().default(1),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerProjectDate: index("shared_project_expenses_owner_project_date_idx").on(table.ownerId, table.projectId, table.expenseOn, table.createdAt, table.id),
  ownerIdId: uniqueIndex("shared_project_expenses_owner_id_id_idx").on(table.ownerId, table.id),
  projectOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.projectId],
    foreignColumns: [sharedProjects.ownerId, sharedProjects.id],
    name: "shared_project_expenses_owner_project_fk",
  }).onDelete("cascade"),
  descriptionNonempty: check("shared_project_expenses_description_nonempty_check", sql`length(trim(${table.description})) > 0`),
  quantityPositive: check("shared_project_expenses_quantity_positive_check", sql`${table.quantity} > 0`),
  amountPositive: check("shared_project_expenses_amount_positive_check", sql`${table.amountMinor} > 0`),
  noteLength: check("shared_project_expenses_note_length_check", sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`),
}));

export const sharedProjectParticipants = pgTable("shared_project_participants", {
  id: id(),
  ownerId: owner(),
  projectId: uuid("project_id").notNull(),
  name: text("name").notNull(),
  paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerProjectCreated: index("shared_project_participants_owner_project_created_idx").on(table.ownerId, table.projectId, table.createdAt, table.id),
  ownerIdId: uniqueIndex("shared_project_participants_owner_id_id_idx").on(table.ownerId, table.id),
  projectOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.projectId],
    foreignColumns: [sharedProjects.ownerId, sharedProjects.id],
    name: "shared_project_participants_owner_project_fk",
  }).onDelete("cascade"),
  nameNonempty: check("shared_project_participants_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  paidNonnegative: check("shared_project_participants_paid_nonnegative_check", sql`${table.paidMinor} >= 0`),
}));

export const sharedProjectsRelations = relations(sharedProjects, ({ many }) => ({
  expenses: many(sharedProjectExpenses),
  participants: many(sharedProjectParticipants),
}));

export const sharedProjectExpensesRelations = relations(sharedProjectExpenses, ({ one }) => ({
  project: one(sharedProjects, {
    fields: [sharedProjectExpenses.ownerId, sharedProjectExpenses.projectId],
    references: [sharedProjects.ownerId, sharedProjects.id],
  }),
}));

export const sharedProjectParticipantsRelations = relations(sharedProjectParticipants, ({ one }) => ({
  project: one(sharedProjects, {
    fields: [sharedProjectParticipants.ownerId, sharedProjectParticipants.projectId],
    references: [sharedProjects.ownerId, sharedProjects.id],
  }),
}));

export const investmentAccounts = pgTable("investment_accounts", {
  id: id(),
  ownerId: owner(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "set null" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  kind: investmentAccountKindEnum("kind").notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerName: uniqueIndex("investment_accounts_owner_name_idx").on(table.ownerId, table.name),
  ownerIdId: uniqueIndex("investment_accounts_owner_id_id_idx").on(table.ownerId, table.id),
  nameNonempty: check("investment_accounts_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
}));

export const investmentSnapshots = pgTable("investment_snapshots", {
  id: id(),
  ownerId: owner(),
  investmentAccountId: uuid("investment_account_id").notNull().references(() => investmentAccounts.id, { onDelete: "cascade" }),
  asOf: date("as_of").notNull(),
  balanceMinor: bigint("balance_minor", { mode: "number" }).notNull(),
  contributionMinor: bigint("contribution_minor", { mode: "number" }).notNull().default(0),
  withdrawalMinor: bigint("withdrawal_minor", { mode: "number" }).notNull().default(0),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
}, (table) => ({
  accountDate: uniqueIndex("investment_snapshots_account_date_idx").on(table.investmentAccountId, table.asOf),
  ownerDate: index("investment_snapshots_owner_date_idx").on(table.ownerId, table.asOf),
  balanceNonnegative: check("investment_snapshots_balance_nonnegative_check", sql`${table.balanceMinor} >= 0`),
  contributionNonnegative: check("investment_snapshots_contribution_nonnegative_check", sql`${table.contributionMinor} >= 0`),
  withdrawalNonnegative: check("investment_snapshots_withdrawal_nonnegative_check", sql`${table.withdrawalMinor} >= 0`),
}));

export const investmentScenarios = pgTable("investment_scenarios", {
  id: id(),
  ownerId: owner(),
  investmentAccountId: uuid("investment_account_id").references(() => investmentAccounts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  startsOn: date("starts_on").notNull(),
  initialValueMinor: bigint("initial_value_minor", { mode: "number" }).notNull(),
  periodicContributionMinor: bigint("periodic_contribution_minor", { mode: "number" }).notNull().default(0),
  contributionFrequency: recurringFrequencyEnum("contribution_frequency").notNull().default("monthly"),
  annualReturnBps: integer("annual_return_bps").notNull(),
  compoundingPeriodsPerYear: smallint("compounding_periods_per_year").notNull().default(12),
  horizonYears: smallint("horizon_years").notNull(),
  status: scenarioStatusEnum("status").notNull().default("draft"),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerName: uniqueIndex("investment_scenarios_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("investment_scenarios_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  initialValueNonnegative: check("investment_scenarios_initial_value_nonnegative_check", sql`${table.initialValueMinor} >= 0`),
  contributionNonnegative: check("investment_scenarios_contribution_nonnegative_check", sql`${table.periodicContributionMinor} >= 0`),
  compoundingPeriodsValid: check("investment_scenarios_compounding_periods_check", sql`${table.compoundingPeriodsPerYear} BETWEEN 1 AND 366`),
  horizonValid: check("investment_scenarios_horizon_years_check", sql`${table.horizonYears} BETWEEN 1 AND 200`),
}));

export const investmentHoldings = pgTable("investment_holdings", {
  id: id(),
  ownerId: uuid("owner_id").notNull(),
  accountId: uuid("account_id").notNull(),
  instrumentType: investmentHoldingInstrumentTypeEnum("instrument_type").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  account: index("investment_holdings_account_idx").on(table.ownerId, table.accountId),
  ownerIdId: uniqueIndex("investment_holdings_owner_id_id_idx").on(table.ownerId, table.id),
  ownerForeignKey: foreignKey({
    columns: [table.ownerId],
    foreignColumns: [users.id],
    name: "investment_holdings_owner_id_fkey",
  }).onDelete("cascade"),
  accountOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.accountId],
    foreignColumns: [accounts.ownerId, accounts.id],
    name: "investment_holdings_owner_account_fk",
  }).onDelete("cascade"),
  symbolFormat: check("investment_holdings_symbol_format_check", sql`${table.symbol} = btrim(${table.symbol}) AND char_length(${table.symbol}) BETWEEN 1 AND 24`),
  nameNonempty: check("investment_holdings_name_nonempty_check", sql`length(trim(${table.name})) > 0 AND char_length(${table.name}) <= 120`),
  currencySupported: check("investment_holdings_currency_check", sql`${table.currency} IN ('CAD', 'USD')`),
}));

export const investmentHoldingTransactions = pgTable("investment_holding_transactions", {
  id: id(),
  ownerId: uuid("owner_id").notNull(),
  holdingId: uuid("holding_id").notNull(),
  occurredOn: date("occurred_on").notNull(),
  kind: investmentHoldingTransactionKindEnum("kind").notNull(),
  unitsMicros: bigint("units_micros", { mode: "number" }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  feeMinor: bigint("fee_minor", { mode: "number" }).notNull().default(0),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  holding: index("investment_holding_transactions_holding_idx").on(table.ownerId, table.holdingId, table.occurredOn),
  ownerIdId: uniqueIndex("investment_holding_transactions_owner_id_id_idx").on(table.ownerId, table.id),
  ownerForeignKey: foreignKey({
    columns: [table.ownerId],
    foreignColumns: [users.id],
    name: "investment_holding_transactions_owner_id_fkey",
  }).onDelete("cascade"),
  holdingOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.holdingId],
    foreignColumns: [investmentHoldings.ownerId, investmentHoldings.id],
    name: "investment_holding_transactions_owner_holding_fk",
  }).onDelete("cascade"),
  unitsNonnegative: check("investment_holding_transactions_units_nonnegative_check", sql`${table.unitsMicros} >= 0`),
  amountNonnegative: check("investment_holding_transactions_amount_nonnegative_check", sql`${table.amountMinor} >= 0`),
  feeNonnegative: check("investment_holding_transactions_fee_nonnegative_check", sql`${table.feeMinor} >= 0`),
  kindShape: check("investment_holding_transactions_kind_shape_check", sql`(
    (${table.kind} IN ('opening', 'buy', 'sell') AND ${table.unitsMicros} > 0)
    OR (${table.kind} = 'distribution' AND ${table.unitsMicros} = 0 AND ${table.amountMinor} > 0)
    OR (${table.kind} = 'fee' AND ${table.unitsMicros} = 0 AND ${table.amountMinor} > 0 AND ${table.feeMinor} = 0)
  )`),
  noteLength: check("investment_holding_transactions_note_length_check", sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`),
}));

export const investmentHoldingPrices = pgTable("investment_holding_prices", {
  id: id(),
  ownerId: uuid("owner_id").notNull(),
  holdingId: uuid("holding_id").notNull(),
  effectiveOn: date("effective_on").notNull(),
  priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
  source: investmentQuoteSourceEnum("source").notNull(),
  provider: text("provider"),
  quotedAt: timestamp("quoted_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  holding: index("investment_holding_prices_holding_idx").on(table.ownerId, table.holdingId, table.effectiveOn),
  ownerHoldingDateSource: uniqueIndex("investment_holding_prices_owner_holding_date_source_idx").on(table.ownerId, table.holdingId, table.effectiveOn, table.source),
  ownerIdId: uniqueIndex("investment_holding_prices_owner_id_id_idx").on(table.ownerId, table.id),
  ownerForeignKey: foreignKey({
    columns: [table.ownerId],
    foreignColumns: [users.id],
    name: "investment_holding_prices_owner_id_fkey",
  }).onDelete("cascade"),
  holdingOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.holdingId],
    foreignColumns: [investmentHoldings.ownerId, investmentHoldings.id],
    name: "investment_holding_prices_owner_holding_fk",
  }).onDelete("cascade"),
  priceNonnegative: check("investment_holding_prices_price_nonnegative_check", sql`${table.priceMinor} >= 0`),
  providerLength: check("investment_holding_prices_provider_length_check", sql`${table.provider} IS NULL OR char_length(${table.provider}) BETWEEN 1 AND 80`),
}));

export const investmentFxRates = pgTable("investment_fx_rates", {
  id: id(),
  ownerId: uuid("owner_id").notNull(),
  baseCurrency: currencyCodeEnum("base_currency").notNull().default("USD"),
  quoteCurrency: currencyCodeEnum("quote_currency").notNull().default("CAD"),
  effectiveOn: date("effective_on").notNull(),
  ratePpm: bigint("rate_ppm", { mode: "number" }).notNull(),
  source: investmentQuoteSourceEnum("source").notNull(),
  provider: text("provider"),
  quotedAt: timestamp("quoted_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  effective: index("investment_fx_rates_owner_effective_idx").on(table.ownerId, table.effectiveOn),
  ownerPairDateSource: uniqueIndex("investment_fx_rates_owner_pair_date_source_idx").on(table.ownerId, table.baseCurrency, table.quoteCurrency, table.effectiveOn, table.source),
  ownerIdId: uniqueIndex("investment_fx_rates_owner_id_id_idx").on(table.ownerId, table.id),
  ownerForeignKey: foreignKey({
    columns: [table.ownerId],
    foreignColumns: [users.id],
    name: "investment_fx_rates_owner_id_fkey",
  }).onDelete("cascade"),
  pairSupported: check("investment_fx_rates_pair_check", sql`${table.baseCurrency} = 'USD' AND ${table.quoteCurrency} = 'CAD'`),
  ratePositive: check("investment_fx_rates_rate_positive_check", sql`${table.ratePpm} > 0`),
  providerLength: check("investment_fx_rates_provider_length_check", sql`${table.provider} IS NULL OR char_length(${table.provider}) BETWEEN 1 AND 80`),
}));

export const investmentProjectionProjects = pgTable("investment_projection_projects", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  notes: text("notes"),
  mode: text("mode").notNull().default("portfolio"),
  manualStartingAmountMinor: bigint("manual_starting_amount_minor", { mode: "number" }),
  horizonYears: smallint("horizon_years").notNull().default(30),
  compoundingPeriodsPerYear: smallint("compounding_periods_per_year").notNull().default(12),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerName: uniqueIndex("investment_projection_projects_owner_name_idx").on(table.ownerId, table.name),
  ownerIdId: uniqueIndex("investment_projection_projects_owner_id_id_idx").on(table.ownerId, table.id),
  nameNonempty: check("investment_projection_projects_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  notesLength: check("investment_projection_projects_notes_length_check", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 500`),
  modeValid: check("investment_projection_projects_mode_check", sql`${table.mode} IN ('calculator', 'portfolio')`),
  manualAmountValid: check("investment_projection_projects_manual_amount_check", sql`${table.manualStartingAmountMinor} IS NULL OR ${table.manualStartingAmountMinor} >= 0`),
  modeAmountPair: check(
    "investment_projection_projects_mode_amount_check",
    sql`(${table.mode} = 'calculator' AND ${table.manualStartingAmountMinor} IS NOT NULL) OR (${table.mode} = 'portfolio' AND ${table.manualStartingAmountMinor} IS NULL)`,
  ),
  horizonValid: check("investment_projection_projects_horizon_years_check", sql`${table.horizonYears} BETWEEN 1 AND 35`),
  compoundingPeriodsValid: check("investment_projection_projects_compounding_periods_check", sql`${table.compoundingPeriodsPerYear} = 12`),
}));

export const investmentProjectionProjectAccounts = pgTable("investment_projection_project_accounts", {
  id: id(),
  ownerId: owner(),
  projectId: uuid("project_id").notNull(),
  investmentAccountId: uuid("investment_account_id").notNull().references(() => investmentAccounts.id, { onDelete: "cascade" }),
  displayOrder: smallint("display_order").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  project: index("investment_projection_project_accounts_project_idx").on(table.ownerId, table.projectId),
  ownerProjectAccount: uniqueIndex("investment_projection_project_accounts_owner_project_acct_idx").on(table.ownerId, table.projectId, table.investmentAccountId),
  ownerProjectOrder: uniqueIndex("investment_projection_project_accounts_owner_project_order_idx").on(table.ownerId, table.projectId, table.displayOrder),
  ownerProjectId: uniqueIndex("investment_projection_project_accounts_owner_project_id_idx").on(table.ownerId, table.projectId, table.id),
  ownerIdId: uniqueIndex("investment_projection_project_accounts_owner_id_id_idx").on(table.ownerId, table.id),
  projectOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.projectId],
    foreignColumns: [investmentProjectionProjects.ownerId, investmentProjectionProjects.id],
    name: "investment_projection_project_accounts_project_owner_fk",
  }).onDelete("cascade"),
  ownerAccountForeignKey: foreignKey({
    columns: [table.ownerId, table.investmentAccountId],
    foreignColumns: [investmentAccounts.ownerId, investmentAccounts.id],
    name: "investment_projection_project_accounts_owner_account_fk",
  }).onDelete("cascade"),
  displayOrderValid: check("investment_projection_project_accounts_display_order_check", sql`${table.displayOrder} BETWEEN 0 AND 3`),
}));

export const investmentProjectionProjectRates = pgTable("investment_projection_project_rates", {
  id: id(),
  ownerId: owner(),
  projectId: uuid("project_id").notNull(),
  rateBps: integer("rate_bps").notNull(),
  displayOrder: smallint("display_order").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  project: index("investment_projection_project_rates_project_idx").on(table.ownerId, table.projectId),
  ownerProjectRate: uniqueIndex("investment_projection_project_rates_owner_project_rate_idx").on(table.ownerId, table.projectId, table.rateBps),
  ownerProjectOrder: uniqueIndex("investment_projection_project_rates_owner_project_order_idx").on(table.ownerId, table.projectId, table.displayOrder),
  ownerIdId: uniqueIndex("investment_projection_project_rates_owner_id_id_idx").on(table.ownerId, table.id),
  projectOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.projectId],
    foreignColumns: [investmentProjectionProjects.ownerId, investmentProjectionProjects.id],
    name: "investment_projection_project_rates_project_owner_fk",
  }).onDelete("cascade"),
  rateValid: check("investment_projection_project_rates_rate_check", sql`${table.rateBps} BETWEEN -10000 AND 10000`),
  displayOrderValid: check("investment_projection_project_rates_display_order_check", sql`${table.displayOrder} BETWEEN 0 AND 3`),
}));

export const investmentProjectionProjectAccountSchedules = pgTable("investment_projection_project_account_schedules", {
  id: id(),
  ownerId: owner(),
  projectId: uuid("project_id").notNull(),
  projectAccountId: uuid("project_account_id").notNull(),
  frequency: text("frequency").notNull().default("monthly"),
  baseContributionMinor: bigint("base_contribution_minor", { mode: "number" }).notNull().default(0),
  annualIncreaseBps: integer("annual_increase_bps").notNull().default(0),
  annualIncreaseMode: text("annual_increase_mode").notNull().default("percentage"),
  annualIncreaseMinor: bigint("annual_increase_minor", { mode: "number" }).notNull().default(0),
  contributionSource: text("contribution_source").notNull().default("cash_flow"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerProjectAccount: uniqueIndex("inv_proj_sched_owner_project_acct_idx").on(table.ownerId, table.projectId, table.projectAccountId),
  ownerIdId: uniqueIndex("inv_proj_sched_owner_id_id_idx").on(table.ownerId, table.id),
  projectOwnerForeignKey: foreignKey({
    columns: [table.ownerId, table.projectId],
    foreignColumns: [investmentProjectionProjects.ownerId, investmentProjectionProjects.id],
    name: "inv_proj_sched_project_fk",
  }).onDelete("cascade"),
  projectAccountForeignKey: foreignKey({
    columns: [table.ownerId, table.projectId, table.projectAccountId],
    foreignColumns: [investmentProjectionProjectAccounts.ownerId, investmentProjectionProjectAccounts.projectId, investmentProjectionProjectAccounts.id],
    name: "inv_proj_sched_account_fk",
  }).onDelete("cascade"),
  frequencyValid: check("inv_proj_sched_frequency_chk", sql`${table.frequency} IN ('monthly', 'biweekly')`),
  contributionValid: check("inv_proj_sched_contribution_chk", sql`${table.baseContributionMinor} >= 0`),
  increaseValid: check("inv_proj_sched_increase_chk", sql`${table.annualIncreaseBps} BETWEEN 0 AND 10000`),
  increaseModeValid: check("inv_proj_sched_mode_chk", sql`${table.annualIncreaseMode} IN ('percentage', 'fixed_amount')`),
  fixedIncreaseValid: check("inv_proj_sched_fixed_increase_chk", sql`${table.annualIncreaseMinor} >= 0`),
  increaseFieldsValid: check("inv_proj_sched_mode_fields_chk", sql`(${table.annualIncreaseMode} = 'percentage' AND ${table.annualIncreaseMinor} = 0) OR (${table.annualIncreaseMode} = 'fixed_amount' AND ${table.annualIncreaseBps} = 0)`),
  contributionSourceValid: check("inv_proj_sched_source_chk", sql`${table.contributionSource} IN ('cash_flow', 'manual')`),
}));

export const investmentProjectionProjectAccountScheduleOverrides = pgTable("investment_projection_project_account_schedule_overrides", {
  id: id(),
  ownerId: owner(),
  scheduleId: uuid("schedule_id").notNull(),
  calendarYear: integer("calendar_year").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerScheduleYear: uniqueIndex("inv_proj_override_owner_schedule_year_idx").on(table.ownerId, table.scheduleId, table.calendarYear),
  ownerIdId: uniqueIndex("inv_proj_override_owner_id_id_idx").on(table.ownerId, table.id),
  scheduleForeignKey: foreignKey({
    columns: [table.ownerId, table.scheduleId],
    foreignColumns: [investmentProjectionProjectAccountSchedules.ownerId, investmentProjectionProjectAccountSchedules.id],
    name: "inv_proj_override_schedule_fk",
  }).onDelete("cascade"),
  yearValid: check("inv_proj_override_year_chk", sql`${table.calendarYear} BETWEEN 1900 AND 2200`),
  amountValid: check("inv_proj_override_amount_chk", sql`${table.amountMinor} >= 0`),
}));

export const investmentProjectionProjectsRelations = relations(investmentProjectionProjects, ({ many }) => ({
  accounts: many(investmentProjectionProjectAccounts),
  rates: many(investmentProjectionProjectRates),
  schedules: many(investmentProjectionProjectAccountSchedules),
}));

export const investmentProjectionProjectAccountsRelations = relations(investmentProjectionProjectAccounts, ({ one, many }) => ({
  project: one(investmentProjectionProjects, {
    fields: [investmentProjectionProjectAccounts.ownerId, investmentProjectionProjectAccounts.projectId],
    references: [investmentProjectionProjects.ownerId, investmentProjectionProjects.id],
  }),
  investmentAccount: one(investmentAccounts, {
    fields: [investmentProjectionProjectAccounts.ownerId, investmentProjectionProjectAccounts.investmentAccountId],
    references: [investmentAccounts.ownerId, investmentAccounts.id],
  }),
  schedules: many(investmentProjectionProjectAccountSchedules),
}));

export const investmentProjectionProjectRatesRelations = relations(investmentProjectionProjectRates, ({ one }) => ({
  project: one(investmentProjectionProjects, {
    fields: [investmentProjectionProjectRates.ownerId, investmentProjectionProjectRates.projectId],
    references: [investmentProjectionProjects.ownerId, investmentProjectionProjects.id],
  }),
}));

export const investmentProjectionProjectAccountSchedulesRelations = relations(investmentProjectionProjectAccountSchedules, ({ one, many }) => ({
  project: one(investmentProjectionProjects, {
    fields: [investmentProjectionProjectAccountSchedules.ownerId, investmentProjectionProjectAccountSchedules.projectId],
    references: [investmentProjectionProjects.ownerId, investmentProjectionProjects.id],
  }),
  projectAccount: one(investmentProjectionProjectAccounts, {
    fields: [investmentProjectionProjectAccountSchedules.ownerId, investmentProjectionProjectAccountSchedules.projectId, investmentProjectionProjectAccountSchedules.projectAccountId],
    references: [investmentProjectionProjectAccounts.ownerId, investmentProjectionProjectAccounts.projectId, investmentProjectionProjectAccounts.id],
  }),
  overrides: many(investmentProjectionProjectAccountScheduleOverrides),
}));

export const investmentProjectionProjectAccountScheduleOverridesRelations = relations(investmentProjectionProjectAccountScheduleOverrides, ({ one }) => ({
  schedule: one(investmentProjectionProjectAccountSchedules, {
    fields: [investmentProjectionProjectAccountScheduleOverrides.ownerId, investmentProjectionProjectAccountScheduleOverrides.scheduleId],
    references: [investmentProjectionProjectAccountSchedules.ownerId, investmentProjectionProjectAccountSchedules.id],
  }),
}));

export const contributionLimits = pgTable("contribution_limits", {
  id: id(),
  ownerId: owner(),
  investmentAccountId: uuid("investment_account_id").references(() => investmentAccounts.id, { onDelete: "set null" }),
  kind: contributionLimitKindEnum("kind").notNull(),
  taxYear: integer("tax_year").notNull(),
  limitMinor: bigint("limit_minor", { mode: "number" }).notNull(),
  usedMinor: bigint("used_minor", { mode: "number" }).notNull().default(0),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerYear: index("contribution_limits_owner_year_idx").on(table.ownerId, table.taxYear),
  ownerAccountKindYear: uniqueIndex("contribution_limits_owner_account_kind_year_idx").on(table.ownerId, table.investmentAccountId, table.kind, table.taxYear),
  yearValid: check("contribution_limits_year_check", sql`${table.taxYear} BETWEEN 1900 AND 2200`),
  limitNonnegative: check("contribution_limits_limit_nonnegative_check", sql`${table.limitMinor} >= 0`),
  usedNonnegative: check("contribution_limits_used_nonnegative_check", sql`${table.usedMinor} >= 0`),
}));

export const financialGoals = pgTable("financial_goals", {
  id: id(),
  ownerId: owner(),
  name: text("name").notNull(),
  targetMinor: bigint("target_minor", { mode: "number" }).notNull(),
  currentMinor: bigint("current_minor", { mode: "number" }).notNull().default(0),
  targetDate: date("target_date"),
  priority: smallint("priority").notNull().default(0),
  status: goalStatusEnum("status").notNull().default("active"),
  currency: currencyCodeEnum("currency").notNull().default("CAD"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerIdId: uniqueIndex("financial_goals_owner_id_id_idx").on(table.ownerId, table.id),
  ownerName: uniqueIndex("financial_goals_owner_name_idx").on(table.ownerId, table.name),
  nameNonempty: check("financial_goals_name_nonempty_check", sql`length(trim(${table.name})) > 0`),
  targetNonnegative: check("financial_goals_target_nonnegative_check", sql`${table.targetMinor} >= 0`),
  currentNonnegative: check("financial_goals_current_nonnegative_check", sql`${table.currentMinor} >= 0`),
  priorityNonnegative: check("financial_goals_priority_nonnegative_check", sql`${table.priority} >= 0`),
}));
export const financialGoalPlans = pgTable("financial_goal_plans", {
  id: id(),
  ownerId: uuid("owner_id").notNull(),
  goalId: uuid("goal_id").notNull(),
  contributionRuleId: uuid("contribution_rule_id"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  cashFlowSeriesId: uuid("cash_flow_series_id"),
}, (table) => ({
  owner: index("financial_goal_plans_owner_idx").on(table.ownerId),
  ownerGoal: uniqueIndex("financial_goal_plans_owner_goal_idx").on(table.ownerId, table.goalId),
  ownerRule: uniqueIndex("financial_goal_plans_owner_rule_idx").on(table.ownerId, table.contributionRuleId),
  ownerSeries: uniqueIndex("financial_goal_plans_owner_series_idx")
    .on(table.ownerId, table.cashFlowSeriesId)
    .where(sql`${table.cashFlowSeriesId} IS NOT NULL`),
  ownerGoalFk: foreignKey({
    columns: [table.ownerId, table.goalId],
    foreignColumns: [financialGoals.ownerId, financialGoals.id],
    name: "financial_goal_plans_owner_goal_fk",
  }).onDelete("cascade"),
  ownerRuleFk: foreignKey({
    columns: [table.ownerId, table.contributionRuleId],
    foreignColumns: [accountContributionRules.ownerId, accountContributionRules.id],
    name: "financial_goal_plans_owner_rule_fk",
  }).onDelete("cascade"),
  ownerSeriesFk: foreignKey({
    columns: [table.ownerId, table.cashFlowSeriesId],
    foreignColumns: [recurringCashFlowSeries.ownerId, recurringCashFlowSeries.id],
    name: "financial_goal_plans_owner_series_fk",
  }).onDelete("cascade"),
}));

export const financialGoalPlansRelations = relations(financialGoalPlans, ({ one }) => ({
  goal: one(financialGoals, {
    fields: [financialGoalPlans.ownerId, financialGoalPlans.goalId],
    references: [financialGoals.ownerId, financialGoals.id],
  }),
  contributionRule: one(accountContributionRules, {
    fields: [financialGoalPlans.ownerId, financialGoalPlans.contributionRuleId],
    references: [accountContributionRules.ownerId, accountContributionRules.id],
  }),
  cashFlowSeries: one(recurringCashFlowSeries, {
    fields: [financialGoalPlans.ownerId, financialGoalPlans.cashFlowSeriesId],
    references: [recurringCashFlowSeries.ownerId, recurringCashFlowSeries.id],
  }),
}));

export const importBatches = pgTable("import_batches", {
  id: id(),
  ownerId: owner(),
  sourceFile: text("source_file").notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  schemaVersion: text("schema_version").notNull(),
  status: importBatchStatusEnum("status").notNull(),
  sourceSheetCount: integer("source_sheet_count").notNull(),
  sourceCellCount: integer("source_cell_count").notNull(),
  sourceFormulaCount: integer("source_formula_count").notNull(),
  reconciliationSummary: jsonb("reconciliation_summary").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => ({
  ownerStatus: index("import_batches_owner_status_idx").on(table.ownerId, table.status),
  ownerStarted: index("import_batches_owner_started_idx").on(table.ownerId, table.startedAt),
  acceptedFingerprint: uniqueIndex("import_batches_accepted_fingerprint_idx").on(table.sourceFingerprint).where(sql`${table.status} = 'accepted'`),
  sourceFileNonempty: check("import_batches_source_file_nonempty_check", sql`length(trim(${table.sourceFile})) > 0`),
  fingerprintFormat: check("import_batches_source_fingerprint_check", sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`),
  schemaVersionNonempty: check("import_batches_schema_version_nonempty_check", sql`length(trim(${table.schemaVersion})) > 0`),
  sourceCountsNonnegative: check("import_batches_source_counts_nonnegative_check", sql`${table.sourceSheetCount} >= 0 AND ${table.sourceCellCount} >= 0 AND ${table.sourceFormulaCount} >= 0`),
  completionOrder: check("import_batches_completion_order_check", sql`(${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.startedAt}) AND (${table.acceptedAt} IS NULL OR ${table.acceptedAt} >= ${table.startedAt})`),
  acceptedNeedsTimestamp: check("import_batches_accepted_timestamp_check", sql`${table.status} <> 'accepted' OR ${table.acceptedAt} IS NOT NULL`),
}));

export const sourceReferences = pgTable("source_references", {
  id: id(),
  ownerId: owner(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  recordType: text("record_type").notNull(),
  recordId: uuid("record_id").notNull(),
  sheetName: text("sheet_name").notNull(),
  sourceAddress: text("source_address").notNull(),
  mappingStatus: sourceMappingStatusEnum("mapping_status").notNull(),
  createdAt: createdAt(),
}, (table) => ({
  owner: index("source_references_owner_idx").on(table.ownerId),
  importBatch: index("source_references_import_batch_idx").on(table.importBatchId),
  record: index("source_references_record_idx").on(table.recordType, table.recordId),
  uniqueSourceRecord: uniqueIndex("source_references_batch_source_record_idx").on(table.importBatchId, table.recordType, table.recordId, table.sheetName, table.sourceAddress),
  recordTypeNonempty: check("source_references_record_type_nonempty_check", sql`length(trim(${table.recordType})) > 0`),
  sheetNameNonempty: check("source_references_sheet_name_nonempty_check", sql`length(trim(${table.sheetName})) > 0`),
  sourceAddressNonempty: check("source_references_source_address_nonempty_check", sql`length(trim(${table.sourceAddress})) > 0`),
}));

export const migrationIssues = pgTable("migration_issues", {
  id: id(),
  ownerId: owner(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  severity: migrationIssueSeverityEnum("severity").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  sheetName: text("sheet_name"),
  sourceAddress: text("source_address"),
  recordType: text("record_type"),
  recordId: uuid("record_id"),
  createdAt: createdAt(),
}, (table) => ({
  ownerSeverity: index("migration_issues_owner_severity_idx").on(table.ownerId, table.severity),
  importBatch: index("migration_issues_import_batch_idx").on(table.importBatchId),
  codeNonempty: check("migration_issues_code_nonempty_check", sql`length(trim(${table.code})) > 0`),
  messageNonempty: check("migration_issues_message_nonempty_check", sql`length(trim(${table.message})) > 0`),
  sourcePair: check("migration_issues_source_pair_check", sql`(${table.sourceAddress} IS NULL OR ${table.sheetName} IS NOT NULL) AND (${table.recordId} IS NULL OR ${table.recordType} IS NOT NULL)`),
}));

export const auditEvents = pgTable("audit_events", {
  id: id(),
  ownerId: owner(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  action: auditActionEnum("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (table) => ({
  ownerCreated: index("audit_events_owner_created_idx").on(table.ownerId, table.createdAt),
  ownerBatch: index("audit_events_owner_batch_idx").on(table.ownerId, table.importBatchId),
  entity: index("audit_events_entity_idx").on(table.entityType, table.entityId),
  entityTypeNonempty: check("audit_events_entity_type_nonempty_check", sql`length(trim(${table.entityType})) > 0`),
}));

export const initialSchemaTables = [
  users,
  institutions,
  accountGroups,
  accounts,
  envelopes,
  balanceSnapshots,
  accountContributionRules,
  accountContributionExceptions,
  cashFlowPeriods,
  recurringCashFlowSeries,
  transactions,
  transfers,
  recurringTransactions,
  recurringCashFlowOverrideGroups,
  recurringCashFlowOccurrenceExceptions,
  annualBudgets,
  annualExpenses,
  annualExpenseValues,
  annualExpensePayments,
  householdExpenses,
  annualMaintenanceItems,
  homes,
  homeValueSnapshots,
  homeMortgageTerms,
  homeMortgageAnchors,
  liabilities,
  salaryScenarios,
  salaryYears,
  salarySnapshots,
  sharedProjects,
  sharedProjectExpenses,
  sharedProjectParticipants,
  investmentAccounts,
  investmentSnapshots,
  investmentScenarios,
  investmentHoldings,
  investmentHoldingTransactions,
  investmentHoldingPrices,
  investmentFxRates,
  contributionLimits,
  financialGoals,
  financialGoalPlans,
  importBatches,
  sourceReferences,
  migrationIssues,
  auditEvents,
] as const;
