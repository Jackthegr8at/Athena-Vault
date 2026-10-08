# Data model

PostgreSQL is the authoritative operational store. New public installations start from an empty database and the single active `0000_current_schema_baseline.sql`; existing private deployments retain their separate migration history and cannot be upgraded with this public baseline. Monetary columns use integer minor units, not floating point. Rows are owner-scoped, with row-level security as a second boundary. The historical workbook importer is retired; see [Historical workbook design](excel-migration.md).

## Calculation workbook model

`calculation_workbooks` holds bounded owner-scoped JSON snapshots for the optional formula editor. Workbooks are scratch data and do not update Accounts, Cash Flow, budgets, or Investments.

## Annual budget model

Annual budgets group owner-managed funding envelopes. Annual expense templates, year-specific values, and dated payments remain separate records. New budget names and links are user-controlled; no historical personal labels or imported-record counts are part of the public setup contract.

## Salary and RRQ tracking

Salary years and cumulative pay snapshots store independently entered federal/provincial amounts by completed pay date/number. Optional RRQ contributions use non-negative integer minor units. These records do not infer or import pay data from a workbook.

The salary page labels the regional tracker **Québec — RRQ/QPP**; it is not a CPP/RPC tracker. A per-user, versioned browser display preference shows or hides its tracker, contribution column, and contribution inputs. Without a saved preference, it is shown when any salary snapshot contains an RRQ observation (including zero), otherwise hidden. Hiding it does not change salary tracking, calculations, or saved contributions: snapshot edits omit the RRQ field so the existing value is preserved. Blocked browser storage falls back to an in-page toggle.

## Shared Expenses model

Shared Expenses stores owner-scoped projects, participants, expense amounts, and independently recorded payments. The calculation engine derives shares and balances without rewriting payment history. It does not synchronize into Cash Flow automatically.

## Account timeline model

Accounts and dated balance snapshots distinguish Actual data from Projected data. Account kinds include liquid, credit, loan, registered/unregistered investment, and other asset categories. Display labels and last-four metadata are not calculation inputs. Hidden-account preference affects presentation only; it does not remove an account from projections.

## REEI / RDSP holdings model

Holdings belong to an owner and account, with security type, quantity, price/FX inputs, and optional manual overrides. Missing lookup data must remain visibly missing rather than produce a false zero-valued holding. The model does not calculate tax, benefit eligibility, or withdrawal rules.

## Annual maintenance model

Home maintenance stores owner-scoped planned items and dated entries separate from Accounts and Cash Flow. Edits must not rewrite Actual financial rows.

## Recurring Cash Flow series

Recurring income, expenses, and transfers generate projected occurrences from versioned rules. Manual and Actual rows, projection anchors, exceptions, and accepted provenance remain protected. Changes to a rule affect only eligible generated projections and require transactional reconciliation.

## Recurring account contributions

Account-linked contribution schedules are planning inputs and must retain their owner/account identity. Paused or ended sources are not silently treated as active future cash movements.

## Financial goal plans

Goals store target amounts, dates, and optional contributions/scenarios in minor units. A planning projection is not an actual account balance.

## Home and mortgage model

Home equity is derived from a property valuation and applicable liabilities. It contributes to net-worth read models without writing account balances. Mortgage and maintenance inputs remain owner-scoped.

## Overview net-worth history read model

Overview combines current account categories and Home equity, then derives historical/projection display series from source rows. The chart is not a source of truth. Liabilities retain their sign convention; no visual formatting rule may alter financial math.

## Query and archival boundaries

Application queries require authenticated owner scope; multi-row writes are transactional. Migration metadata and historical provenance are integrity records, not a public workbook import mechanism. Do not run private verification scripts against a fresh public install if they assert old accepted-record identities. Run the active migration catalog and focused tests against a disposable database before release.
