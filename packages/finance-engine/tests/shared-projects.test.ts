import { describe, expect, it } from "vitest";
import { calculateSharedProjectExpenseTotalMinor, calculateSharedProjectFinance, deriveSharedProjectPaymentStatus } from "../src/index";

describe("shared project finance", () => {
  it("rounds the equal share to the nearest cent without distributing cents unevenly", () => {
    const result = calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 71_243 }], participants: Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, paidMinor: 0 })), ownerParticipates: true });
    expect(result.summary).toMatchObject({ splitCount: 11, sharePerPersonMinor: 6_477, ownerShareMinor: 6_477, expectedFromOthersMinor: 64_770, roundingDifferenceMinor: 4 });
  });

  it("includes or excludes the owner from the divisor and collection target", () => {
    const participants = [{ id: "one", paidMinor: 0 }, { id: "two", paidMinor: 0 }];
    expect(calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 10_000 }], participants, ownerParticipates: true }).summary).toMatchObject({ splitCount: 3, sharePerPersonMinor: 3_333, expectedFromOthersMinor: 6_666, ownerShareMinor: 3_333 });
    expect(calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 10_000 }], participants, ownerParticipates: false }).summary).toMatchObject({ splitCount: 2, sharePerPersonMinor: 5_000, expectedFromOthersMinor: 10_000, ownerShareMinor: null });
  });

  it("reports that a project with no divisor cannot calculate a split", () => {
    const result = calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 1_000 }], participants: [], ownerParticipates: false });
    expect(result.summary).toMatchObject({ splitCount: 0, sharePerPersonMinor: null, expectedFromOthersMinor: null, canCalculate: false, netCashResultMinor: -1_000 });
  });

  it("derives unpaid, partial, exact, and extra payment states", () => {
    expect(deriveSharedProjectPaymentStatus(0, 1_000)).toBe("unpaid");
    expect(deriveSharedProjectPaymentStatus(500, 1_000)).toBe("partial");
    expect(deriveSharedProjectPaymentStatus(1_000, 1_000)).toBe("paid");
    expect(deriveSharedProjectPaymentStatus(1_100, 1_000)).toBe("extra");
  });

  it("calculates received, outstanding, overpayment, and net cash without mutating payments", () => {
    const partial = calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 10_000 }], participants: [{ id: "partial", paidMinor: 2_000 }, { id: "exact", paidMinor: 5_000 }], ownerParticipates: false });
    expect(partial.summary).toMatchObject({ receivedFromOthersMinor: 7_000, outstandingMinor: 3_000, overpaymentReceivedMinor: 0, netCashResultMinor: -3_000 });
    expect(partial.participants).toEqual([
      expect.objectContaining({ id: "partial", paidMinor: 2_000, status: "partial", remainingMinor: 3_000, extraMinor: 0 }),
      expect.objectContaining({ id: "exact", paidMinor: 5_000, status: "paid", remainingMinor: 0, extraMinor: 0 }),
    ]);

    const extra = calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 10_000 }], participants: [{ id: "extra", paidMinor: 11_000 }, { id: "zero", paidMinor: 0 }], ownerParticipates: false });
    expect(extra.summary).toMatchObject({ receivedFromOthersMinor: 11_000, outstandingMinor: 0, overpaymentReceivedMinor: 1_000, netCashResultMinor: 1_000 });
    expect(extra.participants[0]).toMatchObject({ paidMinor: 11_000, status: "extra", remainingMinor: 0, extraMinor: 6_000 });

    const recalculated = calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 12_000 }], participants: [{ id: "partial", paidMinor: 2_000 }, { id: "exact", paidMinor: 5_000 }], ownerParticipates: false });
    expect(recalculated.participants.map((participant) => participant.paidMinor)).toEqual([2_000, 5_000]);
    expect(recalculated.participants.map((participant) => participant.status)).toEqual(["partial", "partial"]);
  });

  it("rejects negative or unsafe money inputs", () => {
    expect(() => calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: -1 }], participants: [], ownerParticipates: false })).toThrow("Expense amount");
    expect(() => calculateSharedProjectFinance({ expenses: [{ quantity: 1, amountMinor: 1 }], participants: [{ id: "p", paidMinor: -1 }], ownerParticipates: false })).toThrow("Paid amount");
  });

  it("derives quantity-adjusted line totals with checked safe integer arithmetic", () => {
    expect(calculateSharedProjectExpenseTotalMinor(8, 1_000)).toBe(8_000);
    expect(calculateSharedProjectFinance({
      expenses: [{ quantity: 8, amountMinor: 1_000 }, { quantity: 2, amountMinor: 250 }],
      participants: [{ id: "p", paidMinor: 0 }],
      ownerParticipates: false,
    }).summary.totalExpensesMinor).toBe(8_500);
    expect(() => calculateSharedProjectExpenseTotalMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow("Expense total");
    expect(() => calculateSharedProjectExpenseTotalMinor(0, 1_000)).toThrow("Expense quantity");
    expect(() => calculateSharedProjectExpenseTotalMinor(1.5, 1_000)).toThrow("Expense quantity");
  });
});
