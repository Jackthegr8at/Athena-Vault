import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { groupPeriodMovements } from '../../apps/web/app/cash-flow/period-projection-data.ts';

export function fixture(count) {
  const iso = day => new Date(Date.UTC(2030, 0, 1 + day)).toISOString().slice(0, 10);
  const periods = Array.from({ length: count }, (_, i) => ({ id: `period-${i}`, startsOn: iso(i * 14), endsOn: iso(i * 14 + 13) }));
  const transactions = periods.flatMap((p, i) => Array.from({ length: 20 }, (_, j) => ({ id: `t-${i}-${j}`, transactionDate: p.startsOn, accountId: `account-${j % 12}`, amountMinor: j * 100 })));
  const transfers = periods.flatMap((p, i) => Array.from({ length: 4 }, (_, j) => ({ id: `x-${i}-${j}`, transferDate: p.endsOn, fromAccountId: `account-${j}`, toAccountId: `account-${j + 1}`, amountMinor: j * 100 })));
  return { periods, transactions, transfers };
}
export function referenceGroups({ periods, transactions, transfers }) {
  return periods.map(p => ({ period: p, transactions: transactions.filter(t => t.transactionDate >= p.startsOn && t.transactionDate <= p.endsOn), transfers: transfers.filter(t => t.transferDate >= p.startsOn && t.transferDate <= p.endsOn) }));
}
export function measure(fn) {
  for (let i = 0; i < 5; i++) fn();
  const samples = Array.from({ length: 20 }, () => { const start = performance.now(); fn(); return performance.now() - start; }).sort((a, b) => a - b);
  return { medianMs: samples[10], p95Ms: samples[18], warmups: 5, samples: 20 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const count of [26, 260, 2600]) {
    const data = fixture(count);
    const result = referenceGroups(data);
    const metrics = { membershipChecks: 0, fallback: false };
    const indexed = groupPeriodMovements(data.periods, data.transactions, data.transfers, metrics);
    deepStrictEqual(indexed, result);
    if (count === 2600 && metrics.membershipChecks >= count * (data.transactions.length + data.transfers.length)) throw new Error('operation-reduction-not-established');
    console.log(JSON.stringify({ kind: 'synthetic-baseline', accounts: 12, periods: count, transactionsPerPeriod: 20, transfersPerPeriod: 4, membershipChecks: count * (data.transactions.length + data.transfers.length), jsonBytes: Buffer.byteLength(JSON.stringify(result)), databaseQueries: null, databaseRows: null, ...measure(() => referenceGroups(data)) }));
    console.log(JSON.stringify({ kind: 'synthetic-indexed', periods: count, ...metrics, jsonBytes: Buffer.byteLength(JSON.stringify(indexed)), ...measure(() => groupPeriodMovements(data.periods, data.transactions, data.transfers)) }));
  }
}
