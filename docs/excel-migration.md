# Historical workbook design note

An earlier private installation was seeded from a one-time workbook import. That importer and its workbook-inspection output are retired and are **not** a supported setup, restore, or repair path. New self-hosted installations start from an empty PostgreSQL database and the active migration catalog. Operational pages read PostgreSQL directly.

The schema retains owner-scoped provenance structures so existing private data can remain traceable without loading the original workbook at runtime. Do not put workbook files, imported records, source labels, counts, fingerprints, or derived examples into a public repository or test fixture. The optional `/workbooks` calculation editor is a separate owner-scoped scratch workspace; it is not the historical importer and does not update Accounts or Cash Flow.

Existing private deployments must retain their private migration and backup history. The planned single-baseline public migration path is for fresh empty databases only and must never be used as an in-place upgrade for private data.
