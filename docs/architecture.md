# Architecture

Athena Vault is a self-hosted Next.js application backed by PostgreSQL. Browser routes and server actions use authenticated owner scope; financial calculations use integer minor units. The Docker deployment runs PostgreSQL, a one-shot migration service, the web service, and Caddy. Only Caddy publishes a host port. The public migration catalog is designed for a fresh empty database and one `0000_current_schema_baseline.sql`; it is not an in-place upgrade path for private databases.

The one-time historical workbook importer is retired. Operational pages read PostgreSQL directly. [Historical workbook design](excel-migration.md) records the boundary without exposing source data.

## Private calculation workbench

`/workbooks` is an owner-scoped scratch domain for formulas and notes. It stores bounded JSON snapshots and is separate from Accounts, Cash Flow, budgets, Investments, and other financial rows. Clipboard range paste does not make it a financial import path. Demo access is read-only.

## Cash Flow recurring series

Cash Flow maintains dated account balances, transactions, recurring income/expenses/transfers, projection anchors, and generated future occurrences. Actual and manual rows remain distinct from generated projections. Editable generated occurrences reconcile through protected version rules; owner scoping and transactional writes are mandatory. Account visibility is display-only and never removes an account from projection calculations.

## Investment planning

Investment projects are owner-scoped planning read models. Calculator projects start from a manual amount; portfolio projects derive from selected investment accounts and saved assumptions. Saving a project must not create or mutate Cash Flow rows or historical provenance. Missing or inactive sources produce explicit warnings rather than fabricated values.

## Current REEI / RDSP holdings

The holdings ledger stores owner-scoped fund/ETF positions and optional pricing inputs. Absent or failed external price/FX lookup must retain manual entry and must not silently turn a nonzero holding into zero. The optional market-provider token stays server-side.

## Overview net-worth history read model

Overview derives current net worth from the owner's current financial account values plus Home equity, with explicit liability handling. Historical and projected chart values are read models over stored account and projection data, not separate mutable balances. Chart display must not change source rows.

## Goals

Goals use owner-scoped plans and contributions with integer minor units. Planning scenarios remain separate from actual account balances and transactions. A goal calculation change requires focused tests and an explicit rule update.

## Read-model, RLS, and runtime security

The database applies owner-scoped row-level security, and application requests must set the authenticated owner context. Missing or invalid owner context fails closed. Multi-row financial writes use transactions and reject unexpected affected-row counts. Better Auth credentials and sessions are server-only; production setup requires a separate token. Public release checks must include migration/catalog verification, typecheck, tests, lint, build, and separately reported database/browser coverage. See [Security](security.md) and [Data model](data-model.md).
