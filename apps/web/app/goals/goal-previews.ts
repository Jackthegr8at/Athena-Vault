import { occurrencesBetween, type ContributionRuleSchedule } from "@athena/database/account-contributions";
import {
  calculateGoalSavingPlanPreview,
  computeGoalPlanDefaultStartDate,
  GOAL_SAVING_PLAN_FREQUENCIES,
} from "@athena/database/goal-saving-plans";
import type { FinancialGoalView } from "@athena/database";
import type { GoalPlanFrequencyPreview } from "./goal-plan-utils";

export function computeGoalPlanPreviews(goal: FinancialGoalView, todayIso: string): readonly GoalPlanFrequencyPreview[] {
  if (!goal.targetDate) return [];
  const targetDate = goal.targetDate;
  return GOAL_SAVING_PLAN_FREQUENCIES.map((frequency) => {
    const startsOn = computeGoalPlanDefaultStartDate({ targetDate, frequency, todayIso });
    const base = calculateGoalSavingPlanPreview({
      targetMinor: goal.targetMinor,
      currentMinor: goal.currentMinor,
      targetDate,
      todayIso,
      frequency,
      startsOn,
    });
    const rule: ContributionRuleSchedule = {
      id: `goal-saving-plan-preview-${goal.id}-${frequency}`,
      amountMinor: 0,
      frequency,
      startsOn,
      endsOn: targetDate,
      isEnabled: true,
    };
    const occurrenceDates = occurrencesBetween(rule, todayIso, targetDate);
    return {
      frequency,
      occurrenceDates,
      occurrences: base.occurrences,
      remainingMinor: base.remainingMinor,
      requiredAmountMinor: base.requiredAmountMinor,
      defaultStartsOn: startsOn,
    } satisfies GoalPlanFrequencyPreview;
  });
}
