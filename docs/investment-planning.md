# Investment planning

Athena Vault's Investments page contains two separate owner-scoped workflows: current REEI/RDSP holdings management and long-range projection planning. Holdings do not replace Accounts as the source of operational balance snapshots, and neither workflow writes back to Cash Flow. The current-holdings workspace is shown only when at least one active REEI / RDSP Account exists; without one, `/investments` goes directly to projection planning.

## Current REEI / RDSP holdings

Create an operational Account with type **REEI / RDSP**, then use the holdings workspace at the top of `/investments` to add any number of **FCP / MF** and **FNB / ETF** positions to that same Account. A position is identified by its own row rather than a unique symbol, so repeated symbols and repeated mutual-fund/ETF types are allowed. Each position has a transaction ledger for opening balances, buys, sells, distributions, and fees. Use **Delete position** only for an erroneous position; for a genuine sale, keep the position history and record a **Sell** ledger entry instead. The section is omitted when there is no active REEI / RDSP Account; archiving the last such account hides the section without deleting its holdings.

Units use six decimal places and money uses integer CAD/USD minor units. The workspace calculates weighted-average cost and keeps valid zero values distinct from missing data. Enter a manual price or use the explicit market refresh for the position. The holding symbol field provides debounced suggestions from the optional server-side EODHD Search API; the built-in Vanguard Canadian mutual-fund catalog remains available when that token is not configured. Exchange-traded symbols use Yahoo Finance; supported Vanguard Canadian mutual-fund codes such as `VIC1000` use the provider's dated NAV history. USD positions also need a dated USD-to-CAD rate; manual prices/rates take precedence over market data on the same date. Missing prices or FX rates are shown as unavailable, and market-data failures do not remove the last saved values.

The holdings readout compares the derived position total with the latest Account balance snapshot when the currencies and required quotes are available. An empty position with zero units is shown as zero even before its first quote; a non-zero position without a price remains unavailable. It is a review aid only: adding or valuing a holding does not create a balance snapshot, alter Cash Flow, alter a projection project, or change Overview totals. RDSP grant, bond, tax, beneficiary, contribution-limit, broker-sync, and tax-lot rules are outside this first slice.

## Symbol search and instrument verification

Typing at least two characters in the position's **Symbol** field requests debounced, authenticated suggestions filtered by instrument type and trading currency. When `ATHENA_EODHD_API_TOKEN` is configured, the server queries EODHD and returns a bounded list of matching funds or ETFs. The token is read only by the web server and is never sent to the browser. If it is absent or the provider is unavailable, manual symbol entry remains available and the local Vanguard mutual-fund catalog still supplies supported Canadian fund suggestions.

Each suggestion can open the authenticated, read-only route `/investments/instrument/[symbol]` in a new tab. The link carries the selected instrument type and currency, and the dashboard shows the confirmed name, exchange/provider, current dated quote when available, and external references. Vanguard mutual funds expose the official Vanguard Canada page when the local catalog knows the product; exchange-listed instruments use a Yahoo Finance quote page, while an unsupported fund code uses a Yahoo Finance search page. **Use this symbol** returns to `/investments` with the verified fields prefilled; opening or reviewing the dashboard does not create a holding or change balances.

For a standalone web process, set `ATHENA_EODHD_API_TOKEN` in the ignored server environment used by `apps/web` (for example `apps/web/.env`) and restart the process. For Docker, set it in the selected ignored Compose environment file, such as `.env.docker.prod` or `.env.docker.public`, then recreate the web service so Compose injects it server-side. The token is optional; do not use a `NEXT_PUBLIC_` variable for it.

## Modes

- **Calculator** — starts from a manually entered amount and applies saved return-rate scenarios and manual contribution assumptions.
- **Portfolio** — selects investment accounts, starts from their latest available actual balances, and projects each selected account with its own contribution schedule, annual increases, and calendar-year overrides.

All money values use integer CAD minor units. Project edits are transactional and owner-scoped. They must not mutate actual balances, manual projection anchors, Cash Flow rows, accepted workbook/provenance records, or another owner's data.

Projection growth compounds at the nominal annual rate divided by the number of periods per year (`annualRateBps / compoundingPeriodsPerYear` per period). This differs from the mortgage effective-rate convention in `packages/finance-engine/src/mortgage.ts`, which converts the nominal annual rate into an effective per-day factor.

## Cash Flow-backed contributions

Portfolio schedules default to `cash_flow`. In that mode, the repository resolves recurring transfer occurrences whose destination matches the selected operational investment account by ID. It aggregates all matching supported monthly and biweekly planned occurrences by effective date and honors recurring versions, date/amount overrides, and skip exceptions. Multiple matching sources are intentionally combined instead of silently choosing one.

Selecting `manual` is an explicit opt-out. Manual schedules stay inside the Investments project and do not change when Cash Flow schedules change. The UI can show the resolved source, funding-account route, and a detected unique destination; saving a detected link is explicit.

## Persistence and migrations

The projection persistence/read-model boundary is `packages/database/src/repositories/investment-projection.ts`. Holdings persistence/read-model assembly is in `packages/database/src/repositories/investment-holdings.ts`; pure holdings valuation is in `packages/finance-engine/src/investment-holdings.ts`. Pure recurring-source resolution is in `packages/database/src/investment-cash-flow-contributions.ts`, and projection arithmetic is in `packages/finance-engine/src/investments.ts`.

The active public migration catalog is `packages/database/src/migrations/catalog.ts` and should contain only the single fresh-install `0000` baseline. Never apply private historical SQL to a new public database or use this baseline to upgrade an existing private installation.

## Acceptance boundary

The source contract requires warnings for missing, unsupported, multiple, paused, and ended recurring sources. The repository now retains owner-scoped paused/ended transfer series for the pure resolver, which emits actionable state warnings for linked sources while excluding their future automatic events. The focused resolver suite covers the paused/ended behavior; the plans remain incomplete until the runtime acceptance checks below are available.

Before release, run focused unit/component/page tests, lint, typecheck, an isolated production build, disposable-database integration, and an authenticated browser smoke for the current implementation. Record each result separately; skipped or unavailable database/browser checks are not passes. Do not publish operator-specific acceptance logs or private plan history as product documentation.
