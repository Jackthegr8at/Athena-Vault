import { addMinorUnitsSafely } from "@athena/finance-engine";

export const maintenanceFrequencies = ["weekly", "biweekly", "monthly", "annual"] as const;

export type MaintenanceFrequency = (typeof maintenanceFrequencies)[number];

export const maintenanceAnnualizationFactors: Readonly<Record<MaintenanceFrequency, number>> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  annual: 1,
};

function assertMinorUnits(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

export function annualizeMaintenanceAmount(amountMinor: number, frequency: MaintenanceFrequency): number {
  assertMinorUnits(amountMinor, "Maintenance amount");
  const annualizedAmount = amountMinor * maintenanceAnnualizationFactors[frequency];
  assertMinorUnits(annualizedAmount, "Annualized maintenance amount");
  return annualizedAmount;
}

export function annualizeMaintenanceItems(
  items: readonly { amountMinor: number; frequency: MaintenanceFrequency }[],
): number {
  return items.reduce(
    (total, item) => addMinorUnitsSafely(total, annualizeMaintenanceAmount(item.amountMinor, item.frequency), "Annualized maintenance total"),
    0,
  );
}

export function monthlyMaintenanceReserve(annualAmountMinor: number): number {
  assertMinorUnits(annualAmountMinor, "Annual maintenance total");
  return Number((BigInt(annualAmountMinor) + 6n) / 12n);
}
