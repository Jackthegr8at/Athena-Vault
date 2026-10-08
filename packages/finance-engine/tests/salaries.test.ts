import { describe, expect, it } from "vitest";
import { deriveBiweeklyPaydays, deriveCompletedPayNumber, projectSalarySnapshot, projectSalaryYearEndMinor, salaryVarianceToBaseMinor } from "../src/index";

describe("salary projection", () => {
  it("projects the approved 16-of-26 federal and provincial snapshots with cent rounding", () => {
    expect(projectSalaryYearEndMinor({ cumulativeMinor: 6_558_710, completedPayNumber: 16, totalPayPeriods: 26 })).toBe(10_657_904);
    expect(projectSalaryYearEndMinor({ cumulativeMinor: 6_715_359, completedPayNumber: 16, totalPayPeriods: 26 })).toBe(10_912_458);
  });

  it("returns the projected variance against the annual base without floating-point money math", () => {
    const projection = projectSalarySnapshot({ cumulativeMinor: 6_558_710, completedPayNumber: 16, totalPayPeriods: 26 });
    expect(projection).toEqual({ projectedYearEndMinor: 10_657_904, completedPayNumber: 16, totalPayPeriods: 26 });
    expect(salaryVarianceToBaseMinor(projection.projectedYearEndMinor, 8_250_200)).toBe(2_407_704);
  });

  it("derives every biweekly payday in the selected year, including a 27-payday year", () => {
    const paydays = deriveBiweeklyPaydays("2026-01-07", 2026);
    expect(paydays).toHaveLength(26);
    expect(paydays[0]).toBe("2026-01-07");
    expect(paydays.at(-1)).toBe("2026-12-23");

    const twentySeven = deriveBiweeklyPaydays("2024-01-01", 2024);
    expect(twentySeven).toHaveLength(27);
    expect(twentySeven.at(-1)).toBe("2024-12-30");
  });

  it("returns the derived pay number only for dates on the biweekly rhythm", () => {
    expect(deriveCompletedPayNumber("2026-01-07", "2026-08-05", 2026)).toBe(16);
    expect(deriveCompletedPayNumber("2026-01-07", "2026-08-06", 2026)).toBeNull();
  });

  it("rounds half cents up for non-negative salary projections", () => {
    expect(projectSalaryYearEndMinor({ cumulativeMinor: 1, completedPayNumber: 2, totalPayPeriods: 3 })).toBe(2);
    expect(projectSalaryYearEndMinor({ cumulativeMinor: 2, completedPayNumber: 3, totalPayPeriods: 2 })).toBe(1);
  });
});
