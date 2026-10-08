import type { AnnualExpense, MinorUnits } from "./domain";
import { money } from "./domain";

export interface AnnualExpenseFunding {
  id: string;
  label: string;
  dueDate: string;
  amount: MinorUnits;
  funded: MinorUnits;
  remaining: MinorUnits;
  perPayPeriod: MinorUnits;
  status: "on-track" | "attention" | "funded";
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function safeCeilingDivision(numerator: number, denominator: number): number {
  const bigResult = (BigInt(numerator) + BigInt(denominator) - BigInt(1)) / BigInt(denominator);
  if (bigResult > MAX_SAFE_INTEGER_BIGINT) {
    throw new RangeError("Per-pay-period amount is outside the safe integer range.");
  }
  return Number(bigResult);
}

function isOnTrack(funded: number, amount: number): boolean {
  if (amount === 0) return true;
  const fundedTimesFour = BigInt(funded) * BigInt(4);
  const amountTimesThree = BigInt(amount) * BigInt(3);
  return amount > 0 ? fundedTimesFour >= amountTimesThree : fundedTimesFour <= amountTimesThree;
}

export function allocateAnnualExpenses(expenses: AnnualExpense[], payPeriodsRemaining: number): AnnualExpenseFunding[] {
  const periods = Math.max(1, Math.trunc(payPeriodsRemaining));
  return expenses.map((expense) => {
    const remaining = Math.max(0, expense.amount - expense.funded);
    const perPayPeriod = safeCeilingDivision(remaining, periods);
    const status = remaining === 0 ? "funded" : isOnTrack(expense.funded, expense.amount) ? "on-track" : "attention";
    return { id: expense.id, label: expense.label, dueDate: expense.dueDate, amount: expense.amount, funded: expense.funded, remaining: money(remaining), perPayPeriod: money(perPayPeriod), status };
  });
}
