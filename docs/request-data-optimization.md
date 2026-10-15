# Request-data optimizations

Workbook selection uses metadata without loading snapshot JSON. Accounts read the visible timeline window with separate Actual/manual predecessor seeds; full-history consumers and authoritative Cash Flow projection inputs remain unchanged. Cash Flow editor details and excluded rows load on demand through the owner-scoped, MFA-required, private/no-store details API. Indexed movement grouping preserves source order and overlapping-window behavior.

These changes do not alter stored financial records, schema or monetary rules. See [Architecture](architecture.md) for the contracts.

## Synthetic evidence and limitations

In synthetic fixtures, Accounts snapshot output fell from 240 to 30 rows while query count remained 11. Initial Cash Flow detail props fell from 17,523 to 135 serialized bytes; the deferred response fixture was 38,685 bytes, so this is not an overall transfer-reduction claim. At 2,600 periods, indexed movement grouping reduced membership checks from 162,240,000 to 650,808 with identical serialized output.

These are synthetic work reductions, not measured production latency. Authenticated browser smoke and actual HTML/RSC/network measurements remain pending. Build, component and repository tests do not replace those checks.

Run the synthetic benchmark with a Node runtime supporting native TypeScript stripping (the reference run used Node 24):

```sh
node scripts/benchmarks/request-data-optimization.mjs
```

The benchmark does not connect to a database. Repository integration tests use only the explicit `ATHENA_SYNTHETIC_TEST_DATABASE_URL`; leave it unset to skip them. Set it only to a separately approved disposable synthetic database, never a live instance or restored financial backup. Tests roll back fixture transactions but still require explicit authorization and appropriate test roles.
