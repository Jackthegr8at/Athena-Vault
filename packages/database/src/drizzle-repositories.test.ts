import { describe, expect, it } from "vitest";
import { pickLatestEffectiveBalance, type AccountEffectiveBalance } from "./drizzle-repositories";

interface CandidateRow extends AccountEffectiveBalance {
  readonly source: "snapshot" | "payday-check";
  readonly id: string;
}

/**
 * Reference copy of the pre-TASK-023 JS reduction: iterated every snapshot and
 * payday-check row (asOf <= bound, status-filtered) and kept the winner under
 * (asOf desc, payday-check first, id desc).
 */
function previousReduction(candidates: readonly CandidateRow[]): Map<string, CandidateRow> {
  const latestByAccount = new Map<string, CandidateRow>();
  for (const candidate of candidates) {
    const current = latestByAccount.get(candidate.accountId);
    if (!current
      || candidate.asOf > current.asOf
      || (candidate.asOf === current.asOf && (
        (candidate.source === "payday-check" && current.source !== "payday-check")
        || (candidate.source === current.source && candidate.id > current.id)
      ))) {
      latestByAccount.set(candidate.accountId, candidate);
    }
  }
  return latestByAccount;
}

/**
 * Simulates the new query path: SQL keeps only the (as_of desc, id desc)
 * winner per account per source, then pickLatestEffectiveBalance merges them.
 */
function newMerge(candidates: readonly CandidateRow[]): Map<string, AccountEffectiveBalance> {
  const snapshotWinners = new Map<string, CandidateRow>();
  const checkWinners = new Map<string, CandidateRow>();
  for (const candidate of candidates) {
    const winners = candidate.source === "snapshot" ? snapshotWinners : checkWinners;
    const current = winners.get(candidate.accountId);
    if (!current || candidate.asOf > current.asOf || (candidate.asOf === current.asOf && candidate.id > current.id)) {
      winners.set(candidate.accountId, candidate);
    }
  }
  const merged = new Map<string, AccountEffectiveBalance>();
  const accountIds = new Set([...snapshotWinners.keys(), ...checkWinners.keys()]);
  for (const accountId of accountIds) {
    const latest = pickLatestEffectiveBalance(snapshotWinners.get(accountId), checkWinners.get(accountId));
    if (latest) merged.set(accountId, { accountId: latest.accountId, asOf: latest.asOf, balanceMinor: latest.balanceMinor });
  }
  return merged;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCandidates(seed: number): CandidateRow[] {
  const random = mulberry32(seed);
  const dates = ["2026-08-01", "2026-08-15", "2026-09-01", "2026-09-01", "2026-09-10"];
  const candidates: CandidateRow[] = [];
  for (let account = 0; account < 6; account += 1) {
    const accountId = `account-${account}`;
    const rowCount = Math.floor(random() * 6);
    for (let index = 0; index < rowCount; index += 1) {
      candidates.push({
        accountId,
        source: random() < 0.5 ? "snapshot" : "payday-check",
        id: `${String(Math.floor(random() * 1_000_000)).padStart(6, "0")}-${index}`,
        asOf: dates[Math.floor(random() * dates.length)]!,
        balanceMinor: Math.floor(random() * 100_000),
      });
    }
  }
  return candidates;
}

describe("pickLatestEffectiveBalance", () => {
  const snapshot = { accountId: "a", asOf: "2026-09-01", balanceMinor: 1000 };
  const check = { accountId: "a", asOf: "2026-09-01", balanceMinor: 1500 };

  it("returns undefined when neither source has a row", () => {
    expect(pickLatestEffectiveBalance(undefined, undefined)).toBeUndefined();
  });

  it("returns the only available source", () => {
    expect(pickLatestEffectiveBalance(snapshot, undefined)).toBe(snapshot);
    expect(pickLatestEffectiveBalance(undefined, check)).toBe(check);
  });

  it("lets a payday check supersede a snapshot on the same date", () => {
    expect(pickLatestEffectiveBalance(snapshot, check)).toBe(check);
  });

  it("keeps the snapshot when it is strictly later than the check", () => {
    expect(pickLatestEffectiveBalance({ ...snapshot, asOf: "2026-09-05" }, check)).toEqual({ ...snapshot, asOf: "2026-09-05" });
  });

  it("keeps the check when it is strictly later than the snapshot", () => {
    expect(pickLatestEffectiveBalance(snapshot, { ...check, asOf: "2026-09-02" })).toEqual({ ...check, asOf: "2026-09-02" });
  });

  it("matches the previous JS reduction on randomized multi-source fixtures", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const candidates = randomCandidates(seed);
      const expected = previousReduction(candidates);
      const actual = newMerge(candidates);
      const accountIds = new Set(candidates.map((row) => row.accountId));
      expect(actual.size).toBe(expected.size);
      for (const accountId of accountIds) {
        const winner = expected.get(accountId);
        expect(actual.get(accountId)).toEqual(
          winner ? { accountId, asOf: winner.asOf, balanceMinor: winner.balanceMinor } : undefined,
        );
      }
    }
  });

  it("matches the previous reduction on same-date id tiebreaks within one source", () => {
    const candidates: CandidateRow[] = [
      { accountId: "a", source: "snapshot", id: "0001", asOf: "2026-09-01", balanceMinor: 1 },
      { accountId: "a", source: "snapshot", id: "0009", asOf: "2026-09-01", balanceMinor: 9 },
      { accountId: "a", source: "payday-check", id: "0005", asOf: "2026-09-01", balanceMinor: 5 },
      { accountId: "b", source: "snapshot", id: "0009", asOf: "2026-09-02", balanceMinor: 10 },
      { accountId: "b", source: "payday-check", id: "0001", asOf: "2026-09-01", balanceMinor: 20 },
    ];
    const expected = previousReduction(candidates);
    const actual = newMerge(candidates);
    expect(actual.get("a")).toEqual({ accountId: "a", asOf: "2026-09-01", balanceMinor: 5 });
    for (const accountId of ["a", "b"]) {
      const winner = expected.get(accountId)!;
      expect(actual.get(accountId)).toEqual({ accountId, asOf: winner.asOf, balanceMinor: winner.balanceMinor });
    }
  });
});
