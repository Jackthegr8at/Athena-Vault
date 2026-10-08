-- Current schema-only baseline.
--
-- This file describes the current application schema and security boundary. It
-- intentionally contains no workbook snapshots, personal, or other application
-- data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."account_contribution_exception_kind" AS ENUM('skip', 'override');--> statement-breakpoint
CREATE TYPE "public"."account_kind" AS ENUM('checking', 'savings', 'credit', 'loan', 'investment', 'cash', 'crypto', 'rrsp', 'tfsa', 'fhsa', 'resp', 'non_registered', 'other', 'rdsp');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('import_accepted', 'created', 'updated', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."cash_flow_period_status" AS ENUM('planned', 'actual', 'mixed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."contribution_limit_kind" AS ENUM('rrsp', 'tfsa', 'fhsa', 'resp', 'other');--> statement-breakpoint
CREATE TYPE "public"."currency_code" AS ENUM('CAD', 'USD', 'EUR');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."home_mortgage_compounding" AS ENUM('canadian_semi_annual', 'annual', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('dry_run', 'accepted', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."investment_account_kind" AS ENUM('registered', 'non_registered', 'retirement', 'other');--> statement-breakpoint
CREATE TYPE "public"."investment_holding_instrument_type" AS ENUM('mutual_fund', 'etf');--> statement-breakpoint
CREATE TYPE "public"."investment_holding_transaction_kind" AS ENUM('opening', 'buy', 'sell', 'distribution', 'fee');--> statement-breakpoint
CREATE TYPE "public"."investment_quote_source" AS ENUM('manual', 'market');--> statement-breakpoint
CREATE TYPE "public"."liability_kind" AS ENUM('mortgage', 'loan', 'credit', 'other');--> statement-breakpoint
CREATE TYPE "public"."liability_status" AS ENUM('active', 'paid_off', 'archived');--> statement-breakpoint
CREATE TYPE "public"."migration_issue_severity" AS ENUM('info', 'warning', 'blocking');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('planned', 'actual');--> statement-breakpoint
CREATE TYPE "public"."recurring_cash_flow_kind" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."recurring_occurrence_exception_kind" AS ENUM('override', 'skip');--> statement-breakpoint
CREATE TYPE "public"."recurring_series_state" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."recurring_weekday_adjustment" AS ENUM('none', 'next_weekday', 'previous_weekday');--> statement-breakpoint
CREATE TYPE "public"."salary_year_status" AS ENUM('in_progress', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."scenario_status" AS ENUM('draft', 'accepted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."source_mapping_status" AS ENUM('imported', 'derived', 'archival', 'ambiguous', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('income', 'expense', 'adjustment');--> statement-breakpoint
CREATE TABLE "account_balance_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_balance_notes_note_length_check" CHECK ("account_balance_notes"."note" IS NULL OR char_length("account_balance_notes"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "account_contribution_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"occurrence_on" date NOT NULL,
	"kind" "account_contribution_exception_kind" NOT NULL,
	"amount_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_contribution_exceptions_amount_check" CHECK (("account_contribution_exceptions"."kind" = 'skip' AND "account_contribution_exceptions"."amount_minor" IS NULL) OR ("account_contribution_exceptions"."kind" = 'override' AND "account_contribution_exceptions"."amount_minor" > 0))
);
--> statement-breakpoint
CREATE TABLE "account_contribution_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_contribution_rules_amount_positive_check" CHECK ("account_contribution_rules"."amount_minor" > 0),
	CONSTRAINT "account_contribution_rules_date_order_check" CHECK ("account_contribution_rules"."ends_on" IS NULL OR "account_contribution_rules"."ends_on" >= "account_contribution_rules"."starts_on"),
	CONSTRAINT "account_contribution_rules_frequency_check" CHECK ("account_contribution_rules"."frequency" <> 'quarterly')
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_name_nonempty_check" CHECK (length(trim("account_groups"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"group_id" uuid,
	"timeline_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"custom_type_label" text,
	"last_four" text,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"include_in_available_cash" boolean DEFAULT false NOT NULL,
	"is_visible_in_cash_flow" boolean DEFAULT true NOT NULL,
	"use_cash_flow_planned_timeline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_nonempty_check" CHECK (length(trim("accounts"."name")) > 0),
	CONSTRAINT "accounts_timeline_order_nonnegative_check" CHECK ("accounts"."timeline_order" >= 0),
	CONSTRAINT "accounts_custom_type_label_nonempty_check" CHECK ("accounts"."custom_type_label" IS NULL OR length(trim("accounts"."custom_type_label")) > 0),
	CONSTRAINT "accounts_custom_type_label_kind_check" CHECK ("accounts"."kind" = 'other' OR "accounts"."custom_type_label" IS NULL),
	CONSTRAINT "accounts_last_four_format_check" CHECK ("accounts"."last_four" IS NULL OR ("accounts"."kind" = 'rdsp' AND "accounts"."last_four" ~ '^[A-Za-z0-9]{4}$') OR ("accounts"."kind" <> 'rdsp' AND "accounts"."last_four" ~ '^[0-9]{4}$'))
);
--> statement-breakpoint
CREATE TABLE "annual_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"linked_account_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_budgets_name_nonempty_check" CHECK (length(trim("annual_budgets"."name")) > 0),
	CONSTRAINT "annual_budgets_display_order_nonnegative_check" CHECK ("annual_budgets"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "annual_expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"annual_expense_value_id" uuid NOT NULL,
	"payment_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_expense_payments_amount_positive_check" CHECK ("annual_expense_payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "annual_expense_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"annual_expense_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"amount_override_minor" bigint,
	"due_month_override" smallint,
	"due_day_override" smallint,
	"note" text,
	"funded_minor" bigint DEFAULT 0 NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_expense_values_year_check" CHECK ("annual_expense_values"."tax_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "annual_expense_values_amount_nonnegative_check" CHECK ("annual_expense_values"."amount_minor" >= 0),
	CONSTRAINT "annual_expense_values_amount_override_nonnegative_check" CHECK ("annual_expense_values"."amount_override_minor" IS NULL OR "annual_expense_values"."amount_override_minor" >= 0),
	CONSTRAINT "annual_expense_values_due_month_override_check" CHECK ("annual_expense_values"."due_month_override" IS NULL OR ("annual_expense_values"."due_month_override" BETWEEN 1 AND 12)),
	CONSTRAINT "annual_expense_values_due_day_override_check" CHECK ("annual_expense_values"."due_day_override" IS NULL OR ("annual_expense_values"."due_day_override" BETWEEN 1 AND 31)),
	CONSTRAINT "annual_expense_values_funded_nonnegative_check" CHECK ("annual_expense_values"."funded_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "annual_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"account_id" uuid,
	"envelope_id" uuid,
	"name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"funded_minor" bigint DEFAULT 0 NOT NULL,
	"due_month" smallint,
	"due_day" smallint,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_expenses_name_nonempty_check" CHECK (length(trim("annual_expenses"."name")) > 0),
	CONSTRAINT "annual_expenses_amount_nonnegative_check" CHECK ("annual_expenses"."amount_minor" >= 0),
	CONSTRAINT "annual_expenses_funded_nonnegative_check" CHECK ("annual_expenses"."funded_minor" >= 0),
	CONSTRAINT "annual_expenses_due_month_check" CHECK ("annual_expenses"."due_month" IS NULL OR ("annual_expenses"."due_month" BETWEEN 1 AND 12)),
	CONSTRAINT "annual_expenses_due_day_check" CHECK ("annual_expenses"."due_day" IS NULL OR ("annual_expenses"."due_day" BETWEEN 1 AND 31))
);
--> statement-breakpoint
CREATE TABLE "annual_maintenance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annual_maintenance_items_name_nonempty_check" CHECK (length(trim("annual_maintenance_items"."name")) > 0),
	CONSTRAINT "annual_maintenance_items_amount_nonnegative_check" CHECK ("annual_maintenance_items"."amount_minor" >= 0),
	CONSTRAINT "annual_maintenance_items_frequency_check" CHECK ("annual_maintenance_items"."frequency" <> 'quarterly')
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"import_batch_id" uuid,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_entity_type_nonempty_check" CHECK (length(trim("audit_events"."entity_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_count_nonnegative_check" CHECK ("auth_rate_limits"."count" >= 0),
	CONSTRAINT "auth_rate_limits_last_request_nonnegative_check" CHECK ("auth_rate_limits"."last_request" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_user_workspaces" (
	"auth_user_id" text PRIMARY KEY NOT NULL,
	"athena_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_workspaces_athena_user_id_unique" UNIQUE("athena_user_id")
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"password_changed_at" timestamp with time zone,
	CONSTRAINT "auth_users_name_nonempty_check" CHECK (length(trim("auth_users"."name")) > 0),
	CONSTRAINT "auth_users_email_nonempty_check" CHECK (length(trim("auth_users"."email")) > 0)
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"balance_minor" bigint NOT NULL,
	"status" "record_status" DEFAULT 'planned' NOT NULL,
	"is_generated" boolean DEFAULT false NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_flow_payday_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"pay_date" date NOT NULL,
	"projected_balance_minor" bigint NOT NULL,
	"actual_balance_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_flow_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"pay_date" date NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"status" "cash_flow_period_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_flow_periods_label_nonempty_check" CHECK (length(trim("cash_flow_periods"."label")) > 0),
	CONSTRAINT "cash_flow_periods_date_order_check" CHECK ("cash_flow_periods"."ends_on" >= "cash_flow_periods"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "contribution_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"investment_account_id" uuid,
	"kind" "contribution_limit_kind" NOT NULL,
	"tax_year" integer NOT NULL,
	"limit_minor" bigint NOT NULL,
	"used_minor" bigint DEFAULT 0 NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_limits_year_check" CHECK ("contribution_limits"."tax_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "contribution_limits_limit_nonnegative_check" CHECK ("contribution_limits"."limit_minor" >= 0),
	CONSTRAINT "contribution_limits_used_nonnegative_check" CHECK ("contribution_limits"."used_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_minor" bigint DEFAULT 0 NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envelopes_name_nonempty_check" CHECK (length(trim("envelopes"."name")) > 0),
	CONSTRAINT "envelopes_target_nonnegative_check" CHECK ("envelopes"."target_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "financial_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_minor" bigint NOT NULL,
	"current_minor" bigint DEFAULT 0 NOT NULL,
	"target_date" date,
	"priority" smallint DEFAULT 0 NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_goals_name_nonempty_check" CHECK (length(trim("financial_goals"."name")) > 0),
	CONSTRAINT "financial_goals_target_nonnegative_check" CHECK ("financial_goals"."target_minor" >= 0),
	CONSTRAINT "financial_goals_current_nonnegative_check" CHECK ("financial_goals"."current_minor" >= 0),
	CONSTRAINT "financial_goals_priority_nonnegative_check" CHECK ("financial_goals"."priority" >= 0)
);
--> statement-breakpoint
CREATE TABLE "home_mortgage_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"home_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"principal_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_mortgage_anchors_principal_nonnegative_check" CHECK ("home_mortgage_anchors"."principal_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "home_mortgage_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"home_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"annual_rate_bps" integer NOT NULL,
	"compounding_convention" "home_mortgage_compounding" NOT NULL,
	"payment_expense_id" uuid NOT NULL,
	"payment_minor" bigint NOT NULL,
	"next_payment_on" date NOT NULL,
	"renewal_on" date NOT NULL,
	"payoff_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_mortgage_terms_rate_check" CHECK ("home_mortgage_terms"."annual_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "home_mortgage_terms_payment_positive_check" CHECK ("home_mortgage_terms"."payment_minor" > 0),
	CONSTRAINT "home_mortgage_terms_date_order_check" CHECK ("home_mortgage_terms"."next_payment_on" >= "home_mortgage_terms"."effective_on" AND "home_mortgage_terms"."renewal_on" > "home_mortgage_terms"."effective_on" AND "home_mortgage_terms"."payoff_on" > "home_mortgage_terms"."effective_on")
);
--> statement-breakpoint
CREATE TABLE "home_value_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"home_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"market_value_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_value_snapshots_market_value_nonnegative_check" CHECK ("home_value_snapshots"."market_value_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "homes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text DEFAULT 'Home' NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homes_name_nonempty_check" CHECK (length(trim("homes"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "household_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"category" text,
	"frequency" "recurring_frequency" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"annual_amount_minor" bigint NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_expenses_name_nonempty_check" CHECK (length(trim("household_expenses"."name")) > 0),
	CONSTRAINT "household_expenses_amount_nonnegative_check" CHECK ("household_expenses"."amount_minor" >= 0),
	CONSTRAINT "household_expenses_annual_amount_nonnegative_check" CHECK ("household_expenses"."annual_amount_minor" >= 0),
	CONSTRAINT "household_expenses_date_order_check" CHECK ("household_expenses"."ends_on" IS NULL OR "household_expenses"."starts_on" IS NULL OR "household_expenses"."ends_on" >= "household_expenses"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_file" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"schema_version" text NOT NULL,
	"status" "import_batch_status" NOT NULL,
	"source_sheet_count" integer NOT NULL,
	"source_cell_count" integer NOT NULL,
	"source_formula_count" integer NOT NULL,
	"reconciliation_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_source_file_nonempty_check" CHECK (length(trim("import_batches"."source_file")) > 0),
	CONSTRAINT "import_batches_source_fingerprint_check" CHECK ("import_batches"."source_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batches_schema_version_nonempty_check" CHECK (length(trim("import_batches"."schema_version")) > 0),
	CONSTRAINT "import_batches_source_counts_nonnegative_check" CHECK ("import_batches"."source_sheet_count" >= 0 AND "import_batches"."source_cell_count" >= 0 AND "import_batches"."source_formula_count" >= 0),
	CONSTRAINT "import_batches_completion_order_check" CHECK (("import_batches"."completed_at" IS NULL OR "import_batches"."completed_at" >= "import_batches"."started_at") AND ("import_batches"."accepted_at" IS NULL OR "import_batches"."accepted_at" >= "import_batches"."started_at")),
	CONSTRAINT "import_batches_accepted_timestamp_check" CHECK ("import_batches"."status" <> 'accepted' OR "import_batches"."accepted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_name_nonempty_check" CHECK (length(trim("institutions"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "investment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"institution_id" uuid,
	"account_id" uuid,
	"name" text NOT NULL,
	"kind" "investment_account_kind" NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_accounts_name_nonempty_check" CHECK (length(trim("investment_accounts"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "investment_projection_project_account_schedule_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"calendar_year" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_proj_override_year_chk" CHECK ("investment_projection_project_account_schedule_overrides"."calendar_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "inv_proj_override_amount_chk" CHECK ("investment_projection_project_account_schedule_overrides"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "investment_projection_project_account_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_account_id" uuid NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"base_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"annual_increase_bps" integer DEFAULT 0 NOT NULL,
	"annual_increase_mode" text DEFAULT 'percentage' NOT NULL,
	"annual_increase_minor" bigint DEFAULT 0 NOT NULL,
	"contribution_source" text DEFAULT 'cash_flow' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_proj_sched_frequency_chk" CHECK ("investment_projection_project_account_schedules"."frequency" IN ('monthly', 'biweekly')),
	CONSTRAINT "inv_proj_sched_contribution_chk" CHECK ("investment_projection_project_account_schedules"."base_contribution_minor" >= 0),
	CONSTRAINT "inv_proj_sched_increase_chk" CHECK ("investment_projection_project_account_schedules"."annual_increase_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "inv_proj_sched_mode_chk" CHECK ("investment_projection_project_account_schedules"."annual_increase_mode" IN ('percentage', 'fixed_amount')),
	CONSTRAINT "inv_proj_sched_fixed_increase_chk" CHECK ("investment_projection_project_account_schedules"."annual_increase_minor" >= 0),
	CONSTRAINT "inv_proj_sched_mode_fields_chk" CHECK (("investment_projection_project_account_schedules"."annual_increase_mode" = 'percentage' AND "investment_projection_project_account_schedules"."annual_increase_minor" = 0) OR ("investment_projection_project_account_schedules"."annual_increase_mode" = 'fixed_amount' AND "investment_projection_project_account_schedules"."annual_increase_bps" = 0)),
	CONSTRAINT "inv_proj_sched_source_chk" CHECK ("investment_projection_project_account_schedules"."contribution_source" IN ('cash_flow', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "investment_projection_project_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"display_order" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_projection_project_accounts_display_order_check" CHECK ("investment_projection_project_accounts"."display_order" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "investment_projection_project_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"rate_bps" integer NOT NULL,
	"display_order" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_projection_project_rates_rate_check" CHECK ("investment_projection_project_rates"."rate_bps" BETWEEN -10000 AND 10000),
	CONSTRAINT "investment_projection_project_rates_display_order_check" CHECK ("investment_projection_project_rates"."display_order" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "investment_projection_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"mode" text DEFAULT 'portfolio' NOT NULL,
	"manual_starting_amount_minor" bigint,
	"horizon_years" smallint DEFAULT 30 NOT NULL,
	"compounding_periods_per_year" smallint DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_projection_projects_name_nonempty_check" CHECK (length(trim("investment_projection_projects"."name")) > 0),
	CONSTRAINT "investment_projection_projects_notes_length_check" CHECK ("investment_projection_projects"."notes" IS NULL OR char_length("investment_projection_projects"."notes") <= 500),
	CONSTRAINT "investment_projection_projects_mode_check" CHECK ("investment_projection_projects"."mode" IN ('calculator', 'portfolio')),
	CONSTRAINT "investment_projection_projects_manual_amount_check" CHECK ("investment_projection_projects"."manual_starting_amount_minor" IS NULL OR "investment_projection_projects"."manual_starting_amount_minor" >= 0),
	CONSTRAINT "investment_projection_projects_mode_amount_check" CHECK (("investment_projection_projects"."mode" = 'calculator' AND "investment_projection_projects"."manual_starting_amount_minor" IS NOT NULL) OR ("investment_projection_projects"."mode" = 'portfolio' AND "investment_projection_projects"."manual_starting_amount_minor" IS NULL)),
	CONSTRAINT "investment_projection_projects_horizon_years_check" CHECK ("investment_projection_projects"."horizon_years" BETWEEN 1 AND 35),
	CONSTRAINT "investment_projection_projects_compounding_periods_check" CHECK ("investment_projection_projects"."compounding_periods_per_year" = 12)
);
--> statement-breakpoint
CREATE TABLE "investment_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"investment_account_id" uuid,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"initial_value_minor" bigint NOT NULL,
	"periodic_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"contribution_frequency" "recurring_frequency" DEFAULT 'monthly' NOT NULL,
	"annual_return_bps" integer NOT NULL,
	"compounding_periods_per_year" smallint DEFAULT 12 NOT NULL,
	"horizon_years" smallint NOT NULL,
	"status" "scenario_status" DEFAULT 'draft' NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_scenarios_name_nonempty_check" CHECK (length(trim("investment_scenarios"."name")) > 0),
	CONSTRAINT "investment_scenarios_initial_value_nonnegative_check" CHECK ("investment_scenarios"."initial_value_minor" >= 0),
	CONSTRAINT "investment_scenarios_contribution_nonnegative_check" CHECK ("investment_scenarios"."periodic_contribution_minor" >= 0),
	CONSTRAINT "investment_scenarios_compounding_periods_check" CHECK ("investment_scenarios"."compounding_periods_per_year" BETWEEN 1 AND 366),
	CONSTRAINT "investment_scenarios_horizon_years_check" CHECK ("investment_scenarios"."horizon_years" BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "investment_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"balance_minor" bigint NOT NULL,
	"contribution_minor" bigint DEFAULT 0 NOT NULL,
	"withdrawal_minor" bigint DEFAULT 0 NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_snapshots_balance_nonnegative_check" CHECK ("investment_snapshots"."balance_minor" >= 0),
	CONSTRAINT "investment_snapshots_contribution_nonnegative_check" CHECK ("investment_snapshots"."contribution_minor" >= 0),
	CONSTRAINT "investment_snapshots_withdrawal_nonnegative_check" CHECK ("investment_snapshots"."withdrawal_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"lender" text,
	"kind" "liability_kind" NOT NULL,
	"status" "liability_status" DEFAULT 'active' NOT NULL,
	"original_balance_minor" bigint,
	"current_balance_minor" bigint NOT NULL,
	"interest_rate_bps" integer,
	"minimum_payment_minor" bigint DEFAULT 0 NOT NULL,
	"payment_frequency" "recurring_frequency",
	"as_of" date NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liabilities_name_nonempty_check" CHECK (length(trim("liabilities"."name")) > 0),
	CONSTRAINT "liabilities_original_balance_nonnegative_check" CHECK ("liabilities"."original_balance_minor" IS NULL OR "liabilities"."original_balance_minor" >= 0),
	CONSTRAINT "liabilities_current_balance_nonnegative_check" CHECK ("liabilities"."current_balance_minor" >= 0),
	CONSTRAINT "liabilities_minimum_payment_nonnegative_check" CHECK ("liabilities"."minimum_payment_minor" >= 0),
	CONSTRAINT "liabilities_interest_rate_check" CHECK ("liabilities"."interest_rate_bps" IS NULL OR "liabilities"."interest_rate_bps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "migration_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"severity" "migration_issue_severity" NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"sheet_name" text,
	"source_address" text,
	"record_type" text,
	"record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_issues_code_nonempty_check" CHECK (length(trim("migration_issues"."code")) > 0),
	CONSTRAINT "migration_issues_message_nonempty_check" CHECK (length(trim("migration_issues"."message")) > 0),
	CONSTRAINT "migration_issues_source_pair_check" CHECK (("migration_issues"."source_address" IS NULL OR "migration_issues"."sheet_name" IS NOT NULL) AND ("migration_issues"."record_id" IS NULL OR "migration_issues"."record_type" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "recurring_cash_flow_occurrence_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"transaction_id" uuid,
	"transfer_id" uuid,
	"scheduled_occurrence_on" date NOT NULL,
	"override_group_id" uuid,
	"kind" "recurring_occurrence_exception_kind" NOT NULL,
	"date_override" date,
	"amount_override_minor" bigint,
	"account_override_id" uuid,
	"from_account_override_id" uuid,
	"to_account_override_id" uuid,
	"status_override" "record_status",
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_cash_flow_occurrence_exceptions_value_check" CHECK (("recurring_cash_flow_occurrence_exceptions"."kind" = 'skip' AND "recurring_cash_flow_occurrence_exceptions"."date_override" IS NULL AND "recurring_cash_flow_occurrence_exceptions"."amount_override_minor" IS NULL AND "recurring_cash_flow_occurrence_exceptions"."account_override_id" IS NULL AND "recurring_cash_flow_occurrence_exceptions"."from_account_override_id" IS NULL AND "recurring_cash_flow_occurrence_exceptions"."to_account_override_id" IS NULL AND "recurring_cash_flow_occurrence_exceptions"."status_override" IS NULL) OR ("recurring_cash_flow_occurrence_exceptions"."kind" = 'override' AND ("recurring_cash_flow_occurrence_exceptions"."date_override" IS NOT NULL OR "recurring_cash_flow_occurrence_exceptions"."amount_override_minor" IS NOT NULL OR "recurring_cash_flow_occurrence_exceptions"."account_override_id" IS NOT NULL OR "recurring_cash_flow_occurrence_exceptions"."from_account_override_id" IS NOT NULL OR "recurring_cash_flow_occurrence_exceptions"."to_account_override_id" IS NOT NULL OR "recurring_cash_flow_occurrence_exceptions"."status_override" IS NOT NULL))),
	CONSTRAINT "recurring_cash_flow_occurrence_exceptions_target_check" CHECK ("recurring_cash_flow_occurrence_exceptions"."transaction_id" IS NULL OR "recurring_cash_flow_occurrence_exceptions"."transfer_id" IS NULL),
	CONSTRAINT "recurring_cash_flow_occurrence_exceptions_transfer_endpoint_check" CHECK (("recurring_cash_flow_occurrence_exceptions"."from_account_override_id" IS NULL) = ("recurring_cash_flow_occurrence_exceptions"."to_account_override_id" IS NULL) OR ("recurring_cash_flow_occurrence_exceptions"."from_account_override_id" IS NOT NULL AND "recurring_cash_flow_occurrence_exceptions"."to_account_override_id" IS NOT NULL)),
	CONSTRAINT "recurring_cash_flow_occurrence_exceptions_amount_check" CHECK ("recurring_cash_flow_occurrence_exceptions"."amount_override_minor" IS NULL OR "recurring_cash_flow_occurrence_exceptions"."amount_override_minor" > 0),
	CONSTRAINT "recurring_cash_flow_occurrence_exceptions_status_check" CHECK ("recurring_cash_flow_occurrence_exceptions"."status_override" IS NULL OR "recurring_cash_flow_occurrence_exceptions"."status_override" = 'planned')
);
--> statement-breakpoint
CREATE TABLE "recurring_cash_flow_override_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_cash_flow_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "recurring_cash_flow_kind" NOT NULL,
	"state" "recurring_series_state" DEFAULT 'active' NOT NULL,
	"ended_on" date,
	"home_household_frequency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_cash_flow_series_state_end_check" CHECK (("recurring_cash_flow_series"."state" = 'ended' AND "recurring_cash_flow_series"."ended_on" IS NOT NULL) OR ("recurring_cash_flow_series"."state" <> 'ended' AND "recurring_cash_flow_series"."ended_on" IS NULL)),
	CONSTRAINT "recurring_cash_flow_series_kind_check" CHECK ("recurring_cash_flow_series"."kind" IN ('income', 'expense', 'transfer')),
	CONSTRAINT "recurring_cash_flow_series_home_household_frequency_check" CHECK ("recurring_cash_flow_series"."home_household_frequency" IS NULL OR "recurring_cash_flow_series"."home_household_frequency" IN ('biweekly', 'monthly'))
);
--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"supersedes_version_id" uuid,
	"account_id" uuid,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"envelope_id" uuid,
	"kind" "recurring_cash_flow_kind" NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"weekday_adjustment" "recurring_weekday_adjustment" DEFAULT 'none' NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"version_note" text,
	"counts_as_expense" boolean DEFAULT false NOT NULL,
	"next_occurrence_on" date NOT NULL,
	"status" "record_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_transactions_description_nonempty_check" CHECK (length(trim("recurring_transactions"."description")) > 0),
	CONSTRAINT "recurring_transactions_amount_positive_check" CHECK ("recurring_transactions"."amount_minor" > 0),
	CONSTRAINT "recurring_transactions_date_order_check" CHECK ("recurring_transactions"."ends_on" IS NULL OR "recurring_transactions"."ends_on" >= "recurring_transactions"."starts_on"),
	CONSTRAINT "recurring_transactions_effective_date_order_check" CHECK ("recurring_transactions"."effective_to" IS NULL OR "recurring_transactions"."effective_to" >= "recurring_transactions"."effective_from"),
	CONSTRAINT "recurring_transactions_supersedes_self_check" CHECK ("recurring_transactions"."supersedes_version_id" IS NULL OR "recurring_transactions"."supersedes_version_id" <> "recurring_transactions"."id"),
	CONSTRAINT "recurring_transactions_kind_check" CHECK ("recurring_transactions"."kind" IN ('income', 'expense', 'transfer')),
	CONSTRAINT "recurring_transactions_transfer_endpoint_check" CHECK (("recurring_transactions"."kind" = 'transfer' AND "recurring_transactions"."account_id" IS NULL AND "recurring_transactions"."from_account_id" IS NOT NULL AND "recurring_transactions"."to_account_id" IS NOT NULL AND "recurring_transactions"."from_account_id" <> "recurring_transactions"."to_account_id") OR ("recurring_transactions"."kind" <> 'transfer' AND "recurring_transactions"."from_account_id" IS NULL AND "recurring_transactions"."to_account_id" IS NULL)),
	CONSTRAINT "recurring_transactions_counts_as_expense_kind_check" CHECK ("recurring_transactions"."counts_as_expense" = false OR "recurring_transactions"."kind" = 'transfer')
);
--> statement-breakpoint
CREATE TABLE "rrq_year_limit_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"tax_year" smallint NOT NULL,
	"first_maximum_minor" bigint NOT NULL,
	"additional_maximum_minor" bigint NOT NULL,
	"ympe_minor" bigint NOT NULL,
	"yampe_minor" bigint NOT NULL,
	"first_rate_bps" bigint NOT NULL,
	"additional_rate_bps" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rrq_year_limit_overrides_tax_year_check" CHECK ("rrq_year_limit_overrides"."tax_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "rrq_year_limit_overrides_first_maximum_nonnegative_check" CHECK ("rrq_year_limit_overrides"."first_maximum_minor" >= 0),
	CONSTRAINT "rrq_year_limit_overrides_additional_maximum_nonnegative_check" CHECK ("rrq_year_limit_overrides"."additional_maximum_minor" >= 0),
	CONSTRAINT "rrq_year_limit_overrides_ympe_positive_check" CHECK ("rrq_year_limit_overrides"."ympe_minor" > 0),
	CONSTRAINT "rrq_year_limit_overrides_yampe_positive_check" CHECK ("rrq_year_limit_overrides"."yampe_minor" > 0),
	CONSTRAINT "rrq_year_limit_overrides_yampe_not_below_ympe_check" CHECK ("rrq_year_limit_overrides"."yampe_minor" >= "rrq_year_limit_overrides"."ympe_minor"),
	CONSTRAINT "rrq_year_limit_overrides_first_rate_positive_check" CHECK ("rrq_year_limit_overrides"."first_rate_bps" > 0),
	CONSTRAINT "rrq_year_limit_overrides_additional_rate_positive_check" CHECK ("rrq_year_limit_overrides"."additional_rate_bps" > 0)
);
--> statement-breakpoint
CREATE TABLE "rrq_year_limits" (
	"tax_year" smallint PRIMARY KEY NOT NULL,
	"first_maximum_minor" bigint NOT NULL,
	"additional_maximum_minor" bigint NOT NULL,
	"ympe_minor" bigint NOT NULL,
	"yampe_minor" bigint NOT NULL,
	"first_rate_bps" bigint NOT NULL,
	"additional_rate_bps" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rrq_year_limits_tax_year_check" CHECK ("rrq_year_limits"."tax_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "rrq_year_limits_first_maximum_nonnegative_check" CHECK ("rrq_year_limits"."first_maximum_minor" >= 0),
	CONSTRAINT "rrq_year_limits_additional_maximum_nonnegative_check" CHECK ("rrq_year_limits"."additional_maximum_minor" >= 0),
	CONSTRAINT "rrq_year_limits_ympe_positive_check" CHECK ("rrq_year_limits"."ympe_minor" > 0),
	CONSTRAINT "rrq_year_limits_yampe_positive_check" CHECK ("rrq_year_limits"."yampe_minor" > 0),
	CONSTRAINT "rrq_year_limits_yampe_not_below_ympe_check" CHECK ("rrq_year_limits"."yampe_minor" >= "rrq_year_limits"."ympe_minor"),
	CONSTRAINT "rrq_year_limits_first_rate_positive_check" CHECK ("rrq_year_limits"."first_rate_bps" > 0),
	CONSTRAINT "rrq_year_limits_additional_rate_positive_check" CHECK ("rrq_year_limits"."additional_rate_bps" > 0)
);
--> statement-breakpoint
INSERT INTO public.rrq_year_limits (
	tax_year,
	first_maximum_minor,
	additional_maximum_minor,
	ympe_minor,
	yampe_minor,
	first_rate_bps,
	additional_rate_bps
)
VALUES (2026, 447930, 41600, 7460000, 8500000, 630, 400)
ON CONFLICT (tax_year) DO NOTHING;
--> statement-breakpoint
CREATE TABLE "salary_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"effective_on" date NOT NULL,
	"annual_gross_minor" bigint NOT NULL,
	"annual_net_minor" bigint,
	"per_pay_minor" bigint,
	"pay_periods_per_year" smallint DEFAULT 26 NOT NULL,
	"status" "scenario_status" DEFAULT 'draft' NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_scenarios_name_nonempty_check" CHECK (length(trim("salary_scenarios"."name")) > 0),
	CONSTRAINT "salary_scenarios_gross_nonnegative_check" CHECK ("salary_scenarios"."annual_gross_minor" >= 0),
	CONSTRAINT "salary_scenarios_net_nonnegative_check" CHECK ("salary_scenarios"."annual_net_minor" IS NULL OR "salary_scenarios"."annual_net_minor" >= 0),
	CONSTRAINT "salary_scenarios_per_pay_nonnegative_check" CHECK ("salary_scenarios"."per_pay_minor" IS NULL OR "salary_scenarios"."per_pay_minor" >= 0),
	CONSTRAINT "salary_scenarios_pay_periods_check" CHECK ("salary_scenarios"."pay_periods_per_year" BETWEEN 1 AND 366)
);
--> statement-breakpoint
CREATE TABLE "salary_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"salary_year_id" uuid NOT NULL,
	"snapshot_on" date NOT NULL,
	"federal_cumulative_minor" bigint NOT NULL,
	"provincial_cumulative_minor" bigint NOT NULL,
	"completed_pay_number" smallint NOT NULL,
	"completed_pay_number_override" smallint,
	"rrq_contribution_ytd_minor" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_snapshots_federal_nonnegative_check" CHECK ("salary_snapshots"."federal_cumulative_minor" >= 0),
	CONSTRAINT "salary_snapshots_provincial_nonnegative_check" CHECK ("salary_snapshots"."provincial_cumulative_minor" >= 0),
	CONSTRAINT "salary_snapshots_completed_pay_check" CHECK ("salary_snapshots"."completed_pay_number" BETWEEN 1 AND 366),
	CONSTRAINT "salary_snapshots_completed_pay_override_check" CHECK ("salary_snapshots"."completed_pay_number_override" IS NULL OR "salary_snapshots"."completed_pay_number_override" BETWEEN 1 AND 366),
	CONSTRAINT "salary_snapshots_rrq_contribution_ytd_nonnegative_check" CHECK ("salary_snapshots"."rrq_contribution_ytd_minor" IS NULL OR "salary_snapshots"."rrq_contribution_ytd_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salary_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"tax_year" smallint NOT NULL,
	"annual_base_minor" bigint,
	"status" "salary_year_status" DEFAULT 'in_progress' NOT NULL,
	"final_federal_minor" bigint,
	"pay_periods_per_year_override" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_years_tax_year_check" CHECK ("salary_years"."tax_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "salary_years_base_nonnegative_check" CHECK ("salary_years"."annual_base_minor" IS NULL OR "salary_years"."annual_base_minor" >= 0),
	CONSTRAINT "salary_years_final_nonnegative_check" CHECK ("salary_years"."final_federal_minor" IS NULL OR "salary_years"."final_federal_minor" >= 0),
	CONSTRAINT "salary_years_pay_periods_check" CHECK ("salary_years"."pay_periods_per_year_override" IS NULL OR "salary_years"."pay_periods_per_year_override" BETWEEN 1 AND 366),
	CONSTRAINT "salary_years_status_final_check" CHECK (("salary_years"."status" = 'finalized' AND "salary_years"."final_federal_minor" IS NOT NULL) OR ("salary_years"."status" = 'in_progress' AND "salary_years"."final_federal_minor" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "shared_project_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"description" text NOT NULL,
	"expense_on" date,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_minor" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_project_expenses_description_nonempty_check" CHECK (length(trim("shared_project_expenses"."description")) > 0),
	CONSTRAINT "shared_project_expenses_quantity_positive_check" CHECK ("shared_project_expenses"."quantity" > 0),
	CONSTRAINT "shared_project_expenses_amount_positive_check" CHECK ("shared_project_expenses"."amount_minor" > 0),
	CONSTRAINT "shared_project_expenses_note_length_check" CHECK ("shared_project_expenses"."note" IS NULL OR char_length("shared_project_expenses"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "shared_project_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_project_participants_name_nonempty_check" CHECK (length(trim("shared_project_participants"."name")) > 0),
	CONSTRAINT "shared_project_participants_paid_nonnegative_check" CHECK ("shared_project_participants"."paid_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shared_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"project_year" smallint NOT NULL,
	"owner_participates" boolean DEFAULT false NOT NULL,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_projects_name_nonempty_check" CHECK (length(trim("shared_projects"."name")) > 0),
	CONSTRAINT "shared_projects_year_check" CHECK ("shared_projects"."project_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "shared_projects_note_length_check" CHECK ("shared_projects"."note" IS NULL OR char_length("shared_projects"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "source_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"sheet_name" text NOT NULL,
	"source_address" text NOT NULL,
	"mapping_status" "source_mapping_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_references_record_type_nonempty_check" CHECK (length(trim("source_references"."record_type")) > 0),
	CONSTRAINT "source_references_sheet_name_nonempty_check" CHECK (length(trim("source_references"."sheet_name")) > 0),
	CONSTRAINT "source_references_source_address_nonempty_check" CHECK (length(trim("source_references"."source_address")) > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid,
	"period_id" uuid,
	"envelope_id" uuid,
	"recurring_transaction_id" uuid,
	"recurring_series_id" uuid,
	"recurring_occurrence_id" uuid,
	"scheduled_occurrence_on" date,
	"is_generated" boolean DEFAULT false NOT NULL,
	"transaction_date" date NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"status" "record_status" DEFAULT 'planned' NOT NULL,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"amount_minor" bigint NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_description_nonempty_check" CHECK (length(trim("transactions"."description")) > 0),
	CONSTRAINT "transactions_amount_nonnegative_check" CHECK ("transactions"."amount_minor" >= 0),
	CONSTRAINT "transactions_generated_identity_check" CHECK ("transactions"."is_generated" = false OR ("transactions"."recurring_transaction_id" IS NOT NULL AND "transactions"."recurring_series_id" IS NOT NULL AND "transactions"."recurring_occurrence_id" IS NOT NULL AND "transactions"."scheduled_occurrence_on" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"period_id" uuid,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"recurring_transaction_id" uuid,
	"recurring_series_id" uuid,
	"recurring_occurrence_id" uuid,
	"scheduled_occurrence_on" date,
	"is_generated" boolean DEFAULT false NOT NULL,
	"transfer_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency_code" DEFAULT 'CAD' NOT NULL,
	"status" "record_status" DEFAULT 'planned' NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_description_nonempty_check" CHECK (length(trim("transfers"."description")) > 0),
	CONSTRAINT "transfers_amount_positive_check" CHECK ("transfers"."amount_minor" > 0),
	CONSTRAINT "transfers_distinct_accounts_check" CHECK ("transfers"."from_account_id" <> "transfers"."to_account_id"),
	CONSTRAINT "transfers_generated_identity_check" CHECK ("transfers"."is_generated" = false OR ("transfers"."recurring_transaction_id" IS NOT NULL AND "transfers"."recurring_series_id" IS NOT NULL AND "transfers"."recurring_occurrence_id" IS NOT NULL AND "transfers"."scheduled_occurrence_on" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"onboarding_state" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"demo_fixture_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_nonempty_check" CHECK (length(trim("users"."email")) > 0),
	CONSTRAINT "users_display_name_format_check" CHECK ("users"."display_name" IS NULL OR ("users"."display_name" = btrim("users"."display_name") AND char_length("users"."display_name") BETWEEN 1 AND 80)),
	CONSTRAINT "users_onboarding_state_check" CHECK ("users"."onboarding_state" IN ('active', 'dismissed', 'completed')),
	CONSTRAINT "users_demo_state_check" CHECK (("users"."is_demo" = false AND "users"."demo_fixture_version" IS NULL) OR ("users"."is_demo" = true AND "users"."demo_fixture_version" > 0))
);
--> statement-breakpoint
CREATE TABLE "auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "calculation_workbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calculation_workbooks_name_format_check" CHECK (("calculation_workbooks"."name" = btrim("calculation_workbooks"."name") AND char_length("calculation_workbooks"."name") BETWEEN 1 AND 80)),
	CONSTRAINT "calculation_workbooks_snapshot_object_check" CHECK (jsonb_typeof("calculation_workbooks"."snapshot") = 'object' AND pg_column_size("calculation_workbooks"."snapshot") <= 5000000)
);--> statement-breakpoint
CREATE TABLE "page_help_seen" (
	"owner_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_help_seen_pkey" PRIMARY KEY("owner_id","page_id"),
	CONSTRAINT "page_help_seen_page_id_format_check" CHECK ("page_help_seen"."page_id" ~ '^[a-z][a-z0-9-]{0,63}$')
);--> statement-breakpoint
CREATE TABLE "workspace_primary_owner" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"owner_id" uuid NOT NULL,
	CONSTRAINT "workspace_primary_owner_singleton_check" CHECK ("workspace_primary_owner"."id" = 1)
);--> statement-breakpoint
CREATE TABLE public.passkey (
  id text PRIMARY KEY,
  name text,
  public_key text NOT NULL,
  user_id text NOT NULL,
  credential_id text NOT NULL,
  counter integer NOT NULL,
  device_type text NOT NULL,
  backed_up boolean NOT NULL,
  transports text,
  created_at timestamptz NOT NULL DEFAULT now(),
  aaguid text
);--> statement-breakpoint
CREATE TABLE public.owner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_notifications_type_check CHECK (type IN ('new_session', 'recovery_code_used', 'passkey_registered', 'passkey_revoked', 'password_changed', 'mfa_changed')),
  CONSTRAINT owner_notifications_payload_object_check CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 8192)
);--> statement-breakpoint
CREATE TABLE public.investment_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid NOT NULL,
  instrument_type public.investment_holding_instrument_type NOT NULL,
  symbol text NOT NULL,
  name text NOT NULL,
  currency public.currency_code NOT NULL DEFAULT 'CAD',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_holdings_symbol_format_check CHECK (symbol = btrim(symbol) AND char_length(symbol) BETWEEN 1 AND 24),
  CONSTRAINT investment_holdings_name_nonempty_check CHECK (length(trim(name)) > 0 AND char_length(name) <= 120),
  CONSTRAINT investment_holdings_currency_check CHECK (currency IN ('CAD', 'USD'))
);--> statement-breakpoint
CREATE TABLE public.investment_holding_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  holding_id uuid NOT NULL,
  occurred_on date NOT NULL,
  kind public.investment_holding_transaction_kind NOT NULL,
  units_micros bigint NOT NULL,
  amount_minor bigint NOT NULL,
  fee_minor bigint NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_holding_transactions_units_nonnegative_check CHECK (units_micros >= 0),
  CONSTRAINT investment_holding_transactions_amount_nonnegative_check CHECK (amount_minor >= 0),
  CONSTRAINT investment_holding_transactions_fee_nonnegative_check CHECK (fee_minor >= 0),
  CONSTRAINT investment_holding_transactions_kind_shape_check CHECK (
    (kind IN ('opening', 'buy', 'sell') AND units_micros > 0)
    OR (kind = 'distribution' AND units_micros = 0 AND amount_minor > 0)
    OR (kind = 'fee' AND units_micros = 0 AND amount_minor > 0 AND fee_minor = 0)
  ),
  CONSTRAINT investment_holding_transactions_note_length_check CHECK (note IS NULL OR char_length(note) <= 500)
);--> statement-breakpoint
CREATE TABLE public.investment_holding_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  holding_id uuid NOT NULL,
  effective_on date NOT NULL,
  price_minor bigint NOT NULL,
  source public.investment_quote_source NOT NULL,
  provider text,
  quoted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_holding_prices_price_nonnegative_check CHECK (price_minor >= 0),
  CONSTRAINT investment_holding_prices_provider_length_check CHECK (provider IS NULL OR char_length(provider) BETWEEN 1 AND 80)
);--> statement-breakpoint
CREATE TABLE public.investment_fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  base_currency public.currency_code NOT NULL DEFAULT 'USD',
  quote_currency public.currency_code NOT NULL DEFAULT 'CAD',
  effective_on date NOT NULL,
  rate_ppm bigint NOT NULL,
  source public.investment_quote_source NOT NULL,
  provider text,
  quoted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_fx_rates_pair_check CHECK (base_currency = 'USD' AND quote_currency = 'CAD'),
  CONSTRAINT investment_fx_rates_rate_positive_check CHECK (rate_ppm > 0),
  CONSTRAINT investment_fx_rates_provider_length_check CHECK (provider IS NULL OR char_length(provider) BETWEEN 1 AND 80)
);--> statement-breakpoint
CREATE TABLE public.financial_goal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  contribution_rule_id uuid,
  is_enabled boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  cash_flow_series_id uuid
);--> statement-breakpoint
-- Composite foreign keys below require their referenced unique indexes to
-- exist before PostgreSQL validates the constraints.
CREATE UNIQUE INDEX "investment_accounts_owner_id_id_idx" ON "investment_accounts" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_proj_sched_owner_id_id_idx" ON "investment_projection_project_account_schedules" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_project_accounts_owner_project_id_idx" ON "investment_projection_project_accounts" USING btree ("owner_id","project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_projects_owner_id_id_idx" ON "investment_projection_projects" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_years_owner_id_id_idx" ON "salary_years" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_projects_owner_id_id_idx" ON "shared_projects" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX accounts_owner_id_id_idx ON public.accounts (owner_id, id);--> statement-breakpoint
CREATE UNIQUE INDEX financial_goals_owner_id_id_idx ON public.financial_goals (owner_id, id);--> statement-breakpoint
CREATE UNIQUE INDEX account_contribution_rules_owner_id_id_idx ON public.account_contribution_rules (owner_id, id);--> statement-breakpoint
CREATE UNIQUE INDEX recurring_cash_flow_series_owner_id_id_idx ON public.recurring_cash_flow_series (owner_id, id);--> statement-breakpoint
CREATE UNIQUE INDEX investment_holdings_owner_id_id_idx ON public.investment_holdings (owner_id, id);--> statement-breakpoint
ALTER TABLE "account_balance_notes" ADD CONSTRAINT "account_balance_notes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balance_notes" ADD CONSTRAINT "account_balance_notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_contribution_exceptions" ADD CONSTRAINT "account_contribution_exceptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_contribution_exceptions" ADD CONSTRAINT "account_contribution_exceptions_rule_id_account_contribution_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."account_contribution_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_contribution_rules" ADD CONSTRAINT "account_contribution_rules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_contribution_rules" ADD CONSTRAINT "account_contribution_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_budgets" ADD CONSTRAINT "annual_budgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_budgets" ADD CONSTRAINT "annual_budgets_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expense_payments" ADD CONSTRAINT "annual_expense_payments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expense_payments" ADD CONSTRAINT "annual_expense_payments_annual_expense_value_id_annual_expense_values_id_fk" FOREIGN KEY ("annual_expense_value_id") REFERENCES "public"."annual_expense_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expense_values" ADD CONSTRAINT "annual_expense_values_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expense_values" ADD CONSTRAINT "annual_expense_values_annual_expense_id_annual_expenses_id_fk" FOREIGN KEY ("annual_expense_id") REFERENCES "public"."annual_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expense_values" ADD CONSTRAINT "annual_expense_values_budget_id_annual_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."annual_budgets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expenses" ADD CONSTRAINT "annual_expenses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expenses" ADD CONSTRAINT "annual_expenses_budget_id_annual_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."annual_budgets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expenses" ADD CONSTRAINT "annual_expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_expenses" ADD CONSTRAINT "annual_expenses_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_maintenance_items" ADD CONSTRAINT "annual_maintenance_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_user_workspaces" ADD CONSTRAINT "auth_user_workspaces_auth_user_id_auth_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_user_workspaces" ADD CONSTRAINT "auth_user_workspaces_athena_user_id_users_id_fk" FOREIGN KEY ("athena_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_payday_checks" ADD CONSTRAINT "cash_flow_payday_checks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_payday_checks" ADD CONSTRAINT "cash_flow_payday_checks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_periods" ADD CONSTRAINT "cash_flow_periods_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_limits" ADD CONSTRAINT "contribution_limits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_limits" ADD CONSTRAINT "contribution_limits_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_mortgage_anchors" ADD CONSTRAINT "home_mortgage_anchors_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_mortgage_anchors" ADD CONSTRAINT "home_mortgage_anchors_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_mortgage_terms" ADD CONSTRAINT "home_mortgage_terms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_mortgage_terms" ADD CONSTRAINT "home_mortgage_terms_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_mortgage_terms" ADD CONSTRAINT "home_mortgage_terms_payment_expense_id_household_expenses_id_fk" FOREIGN KEY ("payment_expense_id") REFERENCES "public"."household_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_value_snapshots" ADD CONSTRAINT "home_value_snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_value_snapshots" ADD CONSTRAINT "home_value_snapshots_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homes" ADD CONSTRAINT "homes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_expenses" ADD CONSTRAINT "household_expenses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_expenses" ADD CONSTRAINT "household_expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_account_schedule_overrides" ADD CONSTRAINT "investment_projection_project_account_schedule_overrides_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_account_schedule_overrides" ADD CONSTRAINT "inv_proj_override_schedule_fk" FOREIGN KEY ("owner_id","schedule_id") REFERENCES "public"."investment_projection_project_account_schedules"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_account_schedules" ADD CONSTRAINT "investment_projection_project_account_schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_account_schedules" ADD CONSTRAINT "inv_proj_sched_project_fk" FOREIGN KEY ("owner_id","project_id") REFERENCES "public"."investment_projection_projects"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_account_schedules" ADD CONSTRAINT "inv_proj_sched_account_fk" FOREIGN KEY ("owner_id","project_id","project_account_id") REFERENCES "public"."investment_projection_project_accounts"("owner_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_accounts" ADD CONSTRAINT "investment_projection_project_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_accounts" ADD CONSTRAINT "investment_projection_project_accounts_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_accounts" ADD CONSTRAINT "investment_projection_project_accounts_project_owner_fk" FOREIGN KEY ("owner_id","project_id") REFERENCES "public"."investment_projection_projects"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_accounts" ADD CONSTRAINT "investment_projection_project_accounts_owner_account_fk" FOREIGN KEY ("owner_id","investment_account_id") REFERENCES "public"."investment_accounts"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_rates" ADD CONSTRAINT "investment_projection_project_rates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_project_rates" ADD CONSTRAINT "investment_projection_project_rates_project_owner_fk" FOREIGN KEY ("owner_id","project_id") REFERENCES "public"."investment_projection_projects"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_projection_projects" ADD CONSTRAINT "investment_projection_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_scenarios" ADD CONSTRAINT "investment_scenarios_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_scenarios" ADD CONSTRAINT "investment_scenarios_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_snapshots" ADD CONSTRAINT "investment_snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_snapshots" ADD CONSTRAINT "investment_snapshots_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_issues" ADD CONSTRAINT "migration_issues_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_issues" ADD CONSTRAINT "migration_issues_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_series_id_recurring_cash_flow_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_cash_flow_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_version_id_recurring_transactions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_override_group_id_recurring_cash_flow_override_groups_id_fk" FOREIGN KEY ("override_group_id") REFERENCES "public"."recurring_cash_flow_override_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_account_override_id_accounts_id_fk" FOREIGN KEY ("account_override_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_from_account_override_id_accounts_id_fk" FOREIGN KEY ("from_account_override_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_occurrence_exceptions" ADD CONSTRAINT "recurring_cash_flow_occurrence_exceptions_to_account_override_id_accounts_id_fk" FOREIGN KEY ("to_account_override_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_override_groups" ADD CONSTRAINT "recurring_cash_flow_override_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_override_groups" ADD CONSTRAINT "recurring_cash_flow_override_groups_series_id_recurring_cash_flow_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_cash_flow_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_override_groups" ADD CONSTRAINT "recurring_cash_flow_override_groups_version_id_recurring_transactions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cash_flow_series" ADD CONSTRAINT "recurring_cash_flow_series_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_series_id_recurring_cash_flow_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_cash_flow_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_supersedes_version_id_recurring_transactions_id_fk" FOREIGN KEY ("supersedes_version_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rrq_year_limit_overrides" ADD CONSTRAINT "rrq_year_limit_overrides_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_scenarios" ADD CONSTRAINT "salary_scenarios_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_snapshots" ADD CONSTRAINT "salary_snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_snapshots" ADD CONSTRAINT "salary_snapshots_owner_year_fk" FOREIGN KEY ("owner_id","salary_year_id") REFERENCES "public"."salary_years"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_years" ADD CONSTRAINT "salary_years_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_project_expenses" ADD CONSTRAINT "shared_project_expenses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_project_expenses" ADD CONSTRAINT "shared_project_expenses_owner_project_fk" FOREIGN KEY ("owner_id","project_id") REFERENCES "public"."shared_projects"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_project_participants" ADD CONSTRAINT "shared_project_participants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_project_participants" ADD CONSTRAINT "shared_project_participants_owner_project_fk" FOREIGN KEY ("owner_id","project_id") REFERENCES "public"."shared_projects"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_projects" ADD CONSTRAINT "shared_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_period_id_cash_flow_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."cash_flow_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_series_id_recurring_cash_flow_series_id_fk" FOREIGN KEY ("recurring_series_id") REFERENCES "public"."recurring_cash_flow_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_period_id_cash_flow_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."cash_flow_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_recurring_series_id_recurring_cash_flow_series_id_fk" FOREIGN KEY ("recurring_series_id") REFERENCES "public"."recurring_cash_flow_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculation_workbooks" ADD CONSTRAINT "calculation_workbooks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_help_seen" ADD CONSTRAINT "page_help_seen_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_primary_owner" ADD CONSTRAINT "workspace_primary_owner_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.passkey ADD CONSTRAINT passkey_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.investment_holdings ADD CONSTRAINT investment_holdings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.investment_holdings ADD CONSTRAINT investment_holdings_owner_account_fk FOREIGN KEY (owner_id, account_id) REFERENCES public.accounts(owner_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.investment_holding_transactions ADD CONSTRAINT investment_holding_transactions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.investment_holding_transactions ADD CONSTRAINT investment_holding_transactions_owner_holding_fk FOREIGN KEY (owner_id, holding_id) REFERENCES public.investment_holdings(owner_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.investment_holding_prices ADD CONSTRAINT investment_holding_prices_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.investment_holding_prices ADD CONSTRAINT investment_holding_prices_owner_holding_fk FOREIGN KEY (owner_id, holding_id) REFERENCES public.investment_holdings(owner_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.investment_fx_rates ADD CONSTRAINT investment_fx_rates_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.financial_goal_plans ADD CONSTRAINT financial_goal_plans_owner_goal_fk FOREIGN KEY (owner_id, goal_id) REFERENCES public.financial_goals(owner_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.financial_goal_plans ADD CONSTRAINT financial_goal_plans_owner_rule_fk FOREIGN KEY (owner_id, contribution_rule_id) REFERENCES public.account_contribution_rules(owner_id, id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.financial_goal_plans ADD CONSTRAINT financial_goal_plans_owner_series_fk FOREIGN KEY (owner_id, cash_flow_series_id) REFERENCES public.recurring_cash_flow_series(owner_id, id) ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "account_balance_notes_owner_account_payday_idx" ON "account_balance_notes" USING btree ("owner_id","account_id","as_of");--> statement-breakpoint
CREATE INDEX "account_balance_notes_account_idx" ON "account_balance_notes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_contribution_exceptions_owner_idx" ON "account_contribution_exceptions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "account_contribution_exceptions_rule_idx" ON "account_contribution_exceptions" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_contribution_exceptions_rule_occurrence_idx" ON "account_contribution_exceptions" USING btree ("rule_id","occurrence_on");--> statement-breakpoint
CREATE INDEX "account_contribution_rules_owner_idx" ON "account_contribution_rules" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "account_contribution_rules_account_idx" ON "account_contribution_rules" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_owner_name_idx" ON "account_groups" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "accounts_owner_timeline_order_idx" ON "accounts" USING btree ("owner_id","timeline_order","id");--> statement-breakpoint
CREATE INDEX "accounts_owner_available_cash_idx" ON "accounts" USING btree ("owner_id","include_in_available_cash");--> statement-breakpoint
CREATE INDEX "accounts_owner_cash_flow_visibility_idx" ON "accounts" USING btree ("owner_id","is_visible_in_cash_flow");--> statement-breakpoint
CREATE INDEX "accounts_owner_cf_planned_timeline_idx" ON "accounts" USING btree ("owner_id","use_cash_flow_planned_timeline");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_owner_institution_name_idx" ON "accounts" USING btree ("owner_id","institution_id","name");--> statement-breakpoint
CREATE INDEX "annual_budgets_owner_order_idx" ON "annual_budgets" USING btree ("owner_id","display_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_budgets_owner_name_active_idx" ON "annual_budgets" USING btree ("owner_id","name") WHERE "annual_budgets"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "annual_budgets_owner_account_active_idx" ON "annual_budgets" USING btree ("owner_id","linked_account_id") WHERE "annual_budgets"."is_active" = true;--> statement-breakpoint
CREATE INDEX "annual_expense_payments_occurrence_date_idx" ON "annual_expense_payments" USING btree ("annual_expense_value_id","payment_on","id");--> statement-breakpoint
CREATE INDEX "annual_expense_payments_owner_date_idx" ON "annual_expense_payments" USING btree ("owner_id","payment_on");--> statement-breakpoint
CREATE INDEX "annual_expense_values_owner_year_idx" ON "annual_expense_values" USING btree ("owner_id","tax_year");--> statement-breakpoint
CREATE INDEX "annual_expense_values_budget_year_idx" ON "annual_expense_values" USING btree ("budget_id","tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_expense_values_expense_year_idx" ON "annual_expense_values" USING btree ("annual_expense_id","tax_year");--> statement-breakpoint
CREATE INDEX "annual_expenses_owner_idx" ON "annual_expenses" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "annual_expenses_budget_idx" ON "annual_expenses" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "annual_expenses_owner_name_idx" ON "annual_expenses" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "annual_maintenance_items_owner_idx" ON "annual_maintenance_items" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_maintenance_items_owner_name_idx" ON "annual_maintenance_items" USING btree ("owner_id","name") WHERE "annual_maintenance_items"."is_active" = true;--> statement-breakpoint
CREATE INDEX "audit_events_owner_created_idx" ON "audit_events" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_issuer_accountId_uidx" ON "auth_accounts" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_invitations_token_hash_idx" ON "auth_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_invitations_email_idx" ON "auth_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_invitations_expires_idx" ON "auth_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_key_idx" ON "auth_rate_limits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "auth_rate_limits_last_request_idx" ON "auth_rate_limits" USING btree ("last_request");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_idx" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_user_workspaces_athena_user_idx" ON "auth_user_workspaces" USING btree ("athena_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_idx" ON "auth_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_two_factors_secret_idx" ON "auth_two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "auth_two_factors_user_idx" ON "auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calculation_workbooks_owner_idx" ON "calculation_workbooks" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calculation_workbooks_owner_name_idx" ON "calculation_workbooks" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_verifications_expires_idx" ON "auth_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_snapshots_account_date_idx" ON "balance_snapshots" USING btree ("account_id","as_of");--> statement-breakpoint
CREATE INDEX "balance_snapshots_owner_idx" ON "balance_snapshots" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "balance_snapshots_owner_date_idx" ON "balance_snapshots" USING btree ("owner_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_payday_checks_owner_account_payday_idx" ON "cash_flow_payday_checks" USING btree ("owner_id","account_id","pay_date");--> statement-breakpoint
CREATE INDEX "cash_flow_periods_owner_idx" ON "cash_flow_periods" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_flow_periods_owner_start_idx" ON "cash_flow_periods" USING btree ("owner_id","starts_on");--> statement-breakpoint
CREATE INDEX "contribution_limits_owner_year_idx" ON "contribution_limits" USING btree ("owner_id","tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_limits_owner_account_kind_year_idx" ON "contribution_limits" USING btree ("owner_id","investment_account_id","kind","tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "envelopes_owner_name_idx" ON "envelopes" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_goals_owner_name_idx" ON "financial_goals" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "home_mortgage_anchors_owner_idx" ON "home_mortgage_anchors" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "home_mortgage_anchors_home_date_idx" ON "home_mortgage_anchors" USING btree ("home_id","as_of");--> statement-breakpoint
CREATE INDEX "home_mortgage_terms_owner_idx" ON "home_mortgage_terms" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "home_mortgage_terms_home_effective_idx" ON "home_mortgage_terms" USING btree ("home_id","effective_on");--> statement-breakpoint
CREATE INDEX "home_value_snapshots_owner_idx" ON "home_value_snapshots" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "home_value_snapshots_home_date_idx" ON "home_value_snapshots" USING btree ("home_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "homes_owner_idx" ON "homes" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_expenses_owner_name_idx" ON "household_expenses" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "import_batches_owner_status_idx" ON "import_batches" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "import_batches_owner_started_idx" ON "import_batches" USING btree ("owner_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_accepted_fingerprint_idx" ON "import_batches" USING btree ("source_fingerprint") WHERE "import_batches"."status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_owner_name_idx" ON "institutions" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_accounts_owner_name_idx" ON "investment_accounts" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_proj_override_owner_schedule_year_idx" ON "investment_projection_project_account_schedule_overrides" USING btree ("owner_id","schedule_id","calendar_year");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_proj_override_owner_id_id_idx" ON "investment_projection_project_account_schedule_overrides" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_proj_sched_owner_project_acct_idx" ON "investment_projection_project_account_schedules" USING btree ("owner_id","project_id","project_account_id");--> statement-breakpoint
CREATE INDEX "investment_projection_project_accounts_project_idx" ON "investment_projection_project_accounts" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_project_accounts_owner_project_acct_idx" ON "investment_projection_project_accounts" USING btree ("owner_id","project_id","investment_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_project_accounts_owner_project_order_idx" ON "investment_projection_project_accounts" USING btree ("owner_id","project_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_project_accounts_owner_id_id_idx" ON "investment_projection_project_accounts" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "investment_projection_project_rates_project_idx" ON "investment_projection_project_rates" USING btree ("owner_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_project_rates_owner_project_rate_idx" ON "investment_projection_project_rates" USING btree ("owner_id","project_id","rate_bps");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_project_rates_owner_project_order_idx" ON "investment_projection_project_rates" USING btree ("owner_id","project_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_project_rates_owner_id_id_idx" ON "investment_projection_project_rates" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_projection_projects_owner_name_idx" ON "investment_projection_projects" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_scenarios_owner_name_idx" ON "investment_scenarios" USING btree ("owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_snapshots_account_date_idx" ON "investment_snapshots" USING btree ("investment_account_id","as_of");--> statement-breakpoint
CREATE INDEX "investment_snapshots_owner_date_idx" ON "investment_snapshots" USING btree ("owner_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "liabilities_owner_name_idx" ON "liabilities" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "migration_issues_owner_severity_idx" ON "migration_issues" USING btree ("owner_id","severity");--> statement-breakpoint
CREATE INDEX "migration_issues_import_batch_idx" ON "migration_issues" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "recurring_cash_flow_occurrence_exceptions_owner_series_idx" ON "recurring_cash_flow_occurrence_exceptions" USING btree ("owner_id","series_id","scheduled_occurrence_on");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_cash_flow_occurrence_exceptions_active_occurrence_idx" ON "recurring_cash_flow_occurrence_exceptions" USING btree ("series_id","scheduled_occurrence_on") WHERE "recurring_cash_flow_occurrence_exceptions"."is_active" = true;--> statement-breakpoint
CREATE INDEX "recurring_cash_flow_override_groups_owner_series_idx" ON "recurring_cash_flow_override_groups" USING btree ("owner_id","series_id","is_active","id");--> statement-breakpoint
CREATE INDEX "recurring_cash_flow_series_owner_state_idx" ON "recurring_cash_flow_series" USING btree ("owner_id","state","id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_cash_flow_series_owner_home_household_frequency_idx" ON "recurring_cash_flow_series" USING btree ("owner_id","home_household_frequency") WHERE "recurring_cash_flow_series"."home_household_frequency" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recurring_transactions_owner_next_occurrence_idx" ON "recurring_transactions" USING btree ("owner_id","next_occurrence_on");--> statement-breakpoint
CREATE INDEX "recurring_transactions_owner_series_idx" ON "recurring_transactions" USING btree ("owner_id","series_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_transactions_series_effective_start_idx" ON "recurring_transactions" USING btree ("series_id","effective_from");--> statement-breakpoint
CREATE INDEX "recurring_transactions_supersedes_version_idx" ON "recurring_transactions" USING btree ("supersedes_version_id");--> statement-breakpoint
CREATE INDEX "recurring_transactions_account_idx" ON "recurring_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "recurring_transactions_from_account_idx" ON "recurring_transactions" USING btree ("from_account_id");--> statement-breakpoint
CREATE INDEX "recurring_transactions_to_account_idx" ON "recurring_transactions" USING btree ("to_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rrq_year_limit_overrides_owner_tax_year_idx" ON "rrq_year_limit_overrides" USING btree ("owner_id","tax_year");--> statement-breakpoint
CREATE INDEX "salary_scenarios_owner_effective_idx" ON "salary_scenarios" USING btree ("owner_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_scenarios_owner_name_date_idx" ON "salary_scenarios" USING btree ("owner_id","name","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_snapshots_owner_year_date_idx" ON "salary_snapshots" USING btree ("owner_id","salary_year_id","snapshot_on");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_years_owner_tax_year_idx" ON "salary_years" USING btree ("owner_id","tax_year");--> statement-breakpoint
CREATE INDEX "shared_project_expenses_owner_project_date_idx" ON "shared_project_expenses" USING btree ("owner_id","project_id","expense_on","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_project_expenses_owner_id_id_idx" ON "shared_project_expenses" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "shared_project_participants_owner_project_created_idx" ON "shared_project_participants" USING btree ("owner_id","project_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_project_participants_owner_id_id_idx" ON "shared_project_participants" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "shared_projects_owner_year_idx" ON "shared_projects" USING btree ("owner_id","project_year","id");--> statement-breakpoint
CREATE INDEX "shared_projects_owner_archive_idx" ON "shared_projects" USING btree ("owner_id","archived_at","id");--> statement-breakpoint
CREATE INDEX "source_references_owner_idx" ON "source_references" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "source_references_import_batch_idx" ON "source_references" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "source_references_record_idx" ON "source_references" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_references_batch_source_record_idx" ON "source_references" USING btree ("import_batch_id","record_type","record_id","sheet_name","source_address");--> statement-breakpoint
CREATE INDEX "transactions_owner_date_idx" ON "transactions" USING btree ("owner_id","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_period_date_idx" ON "transactions" USING btree ("period_id","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_owner_recurring_series_idx" ON "transactions" USING btree ("owner_id","recurring_series_id","transaction_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recurring_occurrence_id_idx" ON "transactions" USING btree ("recurring_occurrence_id") WHERE "transactions"."recurring_occurrence_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recurring_scheduled_occurrence_idx" ON "transactions" USING btree ("recurring_series_id","scheduled_occurrence_on") WHERE "transactions"."is_generated" = true AND "transactions"."recurring_series_id" IS NOT NULL AND "transactions"."scheduled_occurrence_on" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transfers_owner_date_idx" ON "transfers" USING btree ("owner_id","transfer_date");--> statement-breakpoint
CREATE INDEX "transfers_owner_recurring_series_idx" ON "transfers" USING btree ("owner_id","recurring_series_id","transfer_date");--> statement-breakpoint
CREATE INDEX "transfers_from_account_date_idx" ON "transfers" USING btree ("from_account_id","transfer_date");--> statement-breakpoint
CREATE INDEX "transfers_to_account_date_idx" ON "transfers" USING btree ("to_account_id","transfer_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_recurring_occurrence_id_idx" ON "transfers" USING btree ("recurring_occurrence_id") WHERE "transfers"."recurring_occurrence_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_recurring_scheduled_occurrence_idx" ON "transfers" USING btree ("recurring_series_id","scheduled_occurrence_on") WHERE "transfers"."is_generated" = true AND "transfers"."recurring_series_id" IS NOT NULL AND "transfers"."scheduled_occurrence_on" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX passkey_user_idx ON public.passkey (user_id);--> statement-breakpoint
CREATE INDEX passkey_credential_id_idx ON public.passkey (credential_id);--> statement-breakpoint
CREATE INDEX owner_notifications_owner_created_idx ON public.owner_notifications (owner_id, created_at);--> statement-breakpoint
CREATE INDEX owner_notifications_owner_unread_idx ON public.owner_notifications (owner_id, created_at) WHERE read = false;--> statement-breakpoint
CREATE INDEX investment_holdings_account_idx ON public.investment_holdings (owner_id, account_id);--> statement-breakpoint
CREATE INDEX investment_holding_transactions_holding_idx ON public.investment_holding_transactions (owner_id, holding_id, occurred_on);--> statement-breakpoint
CREATE UNIQUE INDEX investment_holding_transactions_owner_id_id_idx ON public.investment_holding_transactions (owner_id, id);--> statement-breakpoint
CREATE INDEX investment_holding_prices_holding_idx ON public.investment_holding_prices (owner_id, holding_id, effective_on);--> statement-breakpoint
CREATE UNIQUE INDEX investment_holding_prices_owner_holding_date_source_idx ON public.investment_holding_prices (owner_id, holding_id, effective_on, source);--> statement-breakpoint
CREATE UNIQUE INDEX investment_holding_prices_owner_id_id_idx ON public.investment_holding_prices (owner_id, id);--> statement-breakpoint
CREATE INDEX investment_fx_rates_owner_effective_idx ON public.investment_fx_rates (owner_id, effective_on);--> statement-breakpoint
CREATE UNIQUE INDEX investment_fx_rates_owner_pair_date_source_idx ON public.investment_fx_rates (owner_id, base_currency, quote_currency, effective_on, source);--> statement-breakpoint
CREATE UNIQUE INDEX investment_fx_rates_owner_id_id_idx ON public.investment_fx_rates (owner_id, id);--> statement-breakpoint
CREATE INDEX financial_goal_plans_owner_idx ON public.financial_goal_plans (owner_id);--> statement-breakpoint
CREATE UNIQUE INDEX financial_goal_plans_owner_goal_idx ON public.financial_goal_plans (owner_id, goal_id);--> statement-breakpoint
CREATE UNIQUE INDEX financial_goal_plans_owner_rule_idx ON public.financial_goal_plans (owner_id, contribution_rule_id);--> statement-breakpoint
CREATE UNIQUE INDEX financial_goal_plans_owner_series_idx ON public.financial_goal_plans (owner_id, cash_flow_series_id) WHERE cash_flow_series_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX transfers_owner_period_date_idx ON public.transfers (owner_id, period_id, transfer_date);--> statement-breakpoint
CREATE INDEX cash_flow_periods_owner_paydate_idx ON public.cash_flow_periods (owner_id, pay_date, id);--> statement-breakpoint
CREATE INDEX rcfoe_owner_transaction_idx ON public.recurring_cash_flow_occurrence_exceptions (owner_id, transaction_id) WHERE transaction_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX rcfoe_owner_transfer_idx ON public.recurring_cash_flow_occurrence_exceptions (owner_id, transfer_id) WHERE transfer_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX rcfoe_owner_override_group_idx ON public.recurring_cash_flow_occurrence_exceptions (owner_id, override_group_id) WHERE override_group_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX audit_events_owner_batch_idx ON public.audit_events (owner_id, import_batch_id);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_migrator') THEN
    RAISE EXCEPTION 'athena_migrator role must be provisioned before the current schema baseline';
  END IF;
  IF NOT pg_has_role(current_user, 'athena_migrator', 'MEMBER') AND current_user <> 'athena_migrator' THEN
    RAISE EXCEPTION 'the current schema baseline must run through athena_migrator';
  END IF;
END
$$;--> statement-breakpoint

DO $$
DECLARE
  app_password text := current_setting('app.athena_app_password', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_app') THEN
    IF app_password IS NULL OR app_password = '' THEN
      RAISE EXCEPTION 'athena_app role is missing and app.athena_app_password is not set';
    END IF;
    EXECUTE format('CREATE ROLE athena_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', app_password);
  ELSE
    IF app_password IS NOT NULL AND app_password <> '' THEN
      EXECUTE format('ALTER ROLE athena_app WITH PASSWORD %L NOSUPERUSER NOBYPASSRLS', app_password);
    END IF;
  END IF;
END
$$;--> statement-breakpoint

ALTER SCHEMA public OWNER TO athena_migrator;--> statement-breakpoint

DO $$
DECLARE
  table_name text;
  owner_tables constant text[] := ARRAY[
    'institutions',
    'account_groups',
    'accounts',
    'envelopes',
    'balance_snapshots',
    'account_contribution_rules',
    'account_contribution_exceptions',
    'cash_flow_periods',
    'cash_flow_payday_checks',
    'account_balance_notes',
    'recurring_cash_flow_series',
    'transactions',
    'transfers',
    'recurring_transactions',
    'recurring_cash_flow_override_groups',
    'recurring_cash_flow_occurrence_exceptions',
    'annual_budgets',
    'annual_expenses',
    'annual_expense_values',
    'annual_expense_payments',
    'household_expenses',
    'annual_maintenance_items',
    'homes',
    'home_value_snapshots',
    'home_mortgage_terms',
    'home_mortgage_anchors',
    'liabilities',
    'salary_scenarios',
    'salary_years',
    'salary_snapshots',
    'shared_projects',
    'shared_project_expenses',
    'shared_project_participants',
    'investment_accounts',
    'investment_snapshots',
    'investment_scenarios',
    'investment_projection_projects',
    'investment_projection_project_accounts',
    'investment_projection_project_rates',
    'investment_projection_project_account_schedules',
    'investment_projection_project_account_schedule_overrides',
    'contribution_limits',
    'financial_goals',
    'rrq_year_limit_overrides',
    'import_batches',
    'source_references',
    'migration_issues',
    'audit_events',
    'page_help_seen',
    'calculation_workbooks',
    'investment_holdings',
    'investment_holding_transactions',
    'investment_holding_prices',
    'investment_fx_rates',
    'financial_goal_plans'
  ];
BEGIN
  FOREACH table_name IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO athena_migrator', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO athena_app', table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($policy$
      CREATE POLICY athena_owner_rls ON public.%I
      FOR ALL TO athena_app
      USING (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)
      WITH CHECK (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)
    $policy$, table_name);
  END LOOP;
END
$$;--> statement-breakpoint

ALTER TABLE public.rrq_year_limits OWNER TO athena_migrator;--> statement-breakpoint
REVOKE ALL ON TABLE public.rrq_year_limits FROM PUBLIC;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO athena_app;--> statement-breakpoint
REVOKE DELETE ON TABLE public.users FROM athena_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE public.rrq_year_limits FROM athena_app;--> statement-breakpoint
GRANT SELECT ON TABLE public.rrq_year_limits TO athena_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO athena_app;--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO athena_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE athena_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO athena_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE athena_migrator IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO athena_app;
-- Better Auth runtime uses a separate role with its own RLS boundary.
DO $$
DECLARE
  auth_password text := current_setting('app.athena_auth_password', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_auth') THEN
    IF auth_password IS NULL OR auth_password = '' THEN
      RAISE EXCEPTION 'athena_auth role is missing and app.athena_auth_password is not set';
    END IF;
    EXECUTE format('CREATE ROLE athena_auth WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', auth_password);
  ELSE
    IF auth_password IS NOT NULL AND auth_password <> '' THEN
      EXECUTE format('ALTER ROLE athena_auth WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', auth_password);
    ELSE
      ALTER ROLE athena_auth WITH LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END IF;
END
$$;--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM athena_auth;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO athena_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.auth_users,
  public.auth_sessions,
  public.auth_accounts,
  public.auth_verifications,
  public.auth_rate_limits,
  public.auth_two_factors
TO athena_auth;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.auth_invitations,
  public.auth_user_workspaces
TO athena_auth;--> statement-breakpoint

DO $$
DECLARE
  table_name text;
  auth_tables constant text[] := ARRAY[
    'auth_sessions',
    'auth_users',
    'auth_accounts',
    'auth_verifications',
    'auth_invitations',
    'auth_user_workspaces',
    'auth_rate_limits',
    'auth_two_factors'
  ];
BEGIN
  FOREACH table_name IN ARRAY auth_tables LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO athena_migrator', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;--> statement-breakpoint

ALTER TABLE public.users OWNER TO athena_migrator;--> statement-breakpoint
REVOKE ALL ON TABLE public.users FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.users FROM athena_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO athena_app;--> statement-breakpoint
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY athena_owner_rls ON public.users
  FOR ALL TO athena_app
  USING (id = nullif(current_setting('app.owner_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.owner_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE public.workspace_primary_owner OWNER TO athena_migrator;--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_primary_owner FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_primary_owner FROM athena_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.workspace_primary_owner TO athena_app;--> statement-breakpoint

DO $$
BEGIN
  CREATE POLICY athena_auth_runtime ON public.auth_sessions
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
  CREATE POLICY athena_auth_runtime ON public.auth_users
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
  CREATE POLICY athena_auth_runtime ON public.auth_accounts
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
  CREATE POLICY athena_auth_runtime ON public.auth_verifications
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
  CREATE POLICY athena_auth_runtime ON public.auth_invitations
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
  CREATE POLICY athena_auth_runtime ON public.auth_user_workspaces
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
  CREATE POLICY athena_auth_runtime ON public.auth_rate_limits
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
  CREATE POLICY athena_auth_runtime ON public.auth_two_factors
    FOR ALL TO athena_auth
    USING (true)
    WITH CHECK (true);
END
$$;--> statement-breakpoint

DO $$
BEGIN
  CREATE POLICY athena_app_auth_user ON public.auth_sessions
    FOR ALL TO athena_app
    USING (user_id = nullif(current_setting('app.auth_user_id', true), ''))
    WITH CHECK (user_id = nullif(current_setting('app.auth_user_id', true), ''));
  CREATE POLICY athena_app_auth_user ON public.auth_users
    FOR ALL TO athena_app
    USING (id = nullif(current_setting('app.auth_user_id', true), ''))
    WITH CHECK (id = nullif(current_setting('app.auth_user_id', true), ''));
  CREATE POLICY athena_app_auth_user ON public.auth_accounts
    FOR ALL TO athena_app
    USING (user_id = nullif(current_setting('app.auth_user_id', true), ''))
    WITH CHECK (user_id = nullif(current_setting('app.auth_user_id', true), ''));
  CREATE POLICY athena_app_auth_user ON public.auth_user_workspaces
    FOR ALL TO athena_app
    USING (auth_user_id = nullif(current_setting('app.auth_user_id', true), ''))
    WITH CHECK (auth_user_id = nullif(current_setting('app.auth_user_id', true), ''));
  CREATE POLICY athena_app_auth_user ON public.auth_invitations
    FOR ALL TO athena_app
    USING (created_by = nullif(current_setting('app.auth_user_id', true), ''))
    WITH CHECK (created_by = nullif(current_setting('app.auth_user_id', true), ''));
END
$$;--> statement-breakpoint

REVOKE ALL ON TABLE
  public.auth_users,
  public.auth_sessions,
  public.auth_accounts,
  public.auth_invitations,
  public.auth_user_workspaces,
  public.auth_verifications,
  public.auth_rate_limits,
  public.auth_two_factors
FROM athena_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.auth_users,
  public.auth_sessions,
  public.auth_accounts
TO athena_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.auth_user_workspaces TO athena_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.auth_invitations TO athena_app;--> statement-breakpoint
REVOKE ALL ON TABLE public.page_help_seen FROM athena_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.page_help_seen TO athena_app;
--> statement-breakpoint

ALTER TABLE public.passkey OWNER TO athena_migrator;--> statement-breakpoint
REVOKE ALL ON TABLE public.passkey FROM PUBLIC, athena_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passkey TO athena_auth;--> statement-breakpoint
ALTER TABLE public.passkey ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.passkey FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY athena_auth_runtime ON public.passkey
  FOR ALL TO athena_auth USING (true) WITH CHECK (true);--> statement-breakpoint

ALTER TABLE public.owner_notifications OWNER TO athena_migrator;--> statement-breakpoint
REVOKE ALL ON TABLE public.owner_notifications FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.owner_notifications TO athena_app;--> statement-breakpoint
ALTER TABLE public.owner_notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.owner_notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY athena_owner_rls ON public.owner_notifications
  FOR ALL TO athena_app
  USING (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('app.owner_id', true), '')::uuid);
