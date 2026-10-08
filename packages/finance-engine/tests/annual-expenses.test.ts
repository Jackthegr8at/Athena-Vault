import { describe, expect, it } from "vitest";
import { allocateAnnualExpenses, money, type AnnualExpense } from "../src/index";

function expense(amount: number, funded: number): AnnualExpense {
  return { id: "expense-1", label: "Insurance", account: "Checking", dueDate: "2026-12-01", amount: money(amount), funded: money(funded) };
}

describe("allocateAnnualExpenses", () => {
  it("divides the remaining amount evenly across pay periods", () => {
    const [result] = allocateAnnualExpenses([expense(120_000, 0)], 12);
    expect(result).toMatchObject({ remaining: 120_000, perPayPeriod: 10_000, status: "attention" });
  });

  it("rounds the per-period amount up when a remainder exists", () => {
    const [result] = allocateAnnualExpenses([expense(100_001, 0)], 10);
    expect(result).toMatchObject({ remaining: 100_001, perPayPeriod: 10_001 });
  });

  it("clamps zero or fractional pay periods to a single period", () => {
    const [result] = allocateAnnualExpenses([expense(50_000, 0)], 0);
    expect(result).toMatchObject({ remaining: 50_000, perPayPeriod: 50_000 });
  });

  it("reports a fully funded expense with nothing remaining", () => {
    const [result] = allocateAnnualExpenses([expense(120_000, 120_000)], 12);
    expect(result).toMatchObject({ remaining: 0, perPayPeriod: 0, status: "funded" });
  });

  it("reports an over-funded expense with nothing remaining", () => {
    const [result] = allocateAnnualExpenses([expense(120_000, 150_000)], 12);
    expect(result).toMatchObject({ remaining: 0, perPayPeriod: 0, status: "funded" });
  });

  it("marks an expense on-track at exactly three quarters funded", () => {
    const [result] = allocateAnnualExpenses([expense(120_000, 90_000)], 12);
    expect(result).toMatchObject({ remaining: 30_000, perPayPeriod: 2_500, status: "on-track" });
  });

  it("marks an expense attention just below three quarters funded", () => {
    const [result] = allocateAnnualExpenses([expense(120_000, 89_999)], 12);
    expect(result).toMatchObject({ remaining: 30_001, perPayPeriod: 2_501, status: "attention" });
  });

  it("does not let a floating-point ratio round up to the on-track threshold", () => {
    // 6755399441055743 / 9007199254740991 is just below 0.75, but the IEEE-754
    // quotient rounds to exactly 0.75; exact integer comparison keeps "attention".
    const result = allocateAnnualExpenses([expense(Number.MAX_SAFE_INTEGER, 6_755_399_441_055_743)], 12)[0]!;
    expect(result.status).toBe("attention");
  });

  it("allocates a near-max-safe-integer amount exactly", () => {
    const [result] = allocateAnnualExpenses([expense(Number.MAX_SAFE_INTEGER, 0)], 3);
    expect(result).toMatchObject({ remaining: Number.MAX_SAFE_INTEGER, perPayPeriod: 3_002_399_751_580_331, status: "attention" });
  });
});
