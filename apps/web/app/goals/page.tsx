import "./goals.css";
import { preload } from "react-dom";
import { createGoalPlanRepository, createGoalRepository, toTorontoDateIso } from "@athena/database";
import { ModulePage } from "../components/module-page";
import { ModuleFirstUseCard } from "../components/module-first-use-card";
import { withAuthenticatedPageDatabase } from "../../lib/server/owner-database";
import { getOnboardingSnapshot } from "../../lib/server/onboarding";
import { GoalsManager } from "./goals-manager";
import { computeGoalPlanPreviews } from "./goal-previews";
import type { GoalPlanPreviews } from "./goal-plan-utils";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  preload("/brand/athena-vault-goals-mountains.png", { as: "image" });
  const { goals, onboarding, plans, destinationAccounts, sourceAccounts, previews, todayIso, readOnly } = await withAuthenticatedPageDatabase(async (database, user) => {
    const goalPlanRepository = createGoalPlanRepository(database);
    const [goals, onboarding, plans, destinationAccounts, sourceAccounts] = await Promise.all([
      createGoalRepository(database).listByOwner(user.owner.id),
      getOnboardingSnapshot(database, user.owner.id),
      goalPlanRepository.listByOwner(user.owner.id),
      goalPlanRepository.listEligibleDestinationAccounts(user.owner.id),
      goalPlanRepository.listEligibleSourceAccounts(user.owner.id),
    ]);
    const todayIso = toTorontoDateIso();
    const featuredGoal = goals.find((goal) => goal.status !== "archived");
    const previews: GoalPlanPreviews = featuredGoal ? { [featuredGoal.id]: computeGoalPlanPreviews(featuredGoal, todayIso) } : {};
    return { goals, onboarding, plans, destinationAccounts, sourceAccounts, todayIso, previews, readOnly: user.owner.isDemo };
  }, { requireTwoFactor: true });
  const goalAction = onboarding.nextStepId === "account"
    ? { href: "/accounts", label: "Add account" }
    : onboarding.nextStepId === "balance"
      ? { href: "/accounts", label: "Record balance" }
      : onboarding.nextStepId === "recurring"
        ? { href: "/cash-flow/recurring", label: "Add recurring movement" }
        : { href: "/", label: "Back to overview" };
  return <ModulePage active="Goals" mainClassName="goals-page" eyebrow="Goals" title="Goals" subtitle="Keep database-backed life plans visible alongside the monthly numbers.">
    {goals.length === 0 && readOnly ? <ModuleFirstUseCard headingId="goals-first-use-heading" title="Goals are ready when you are" description="There are no goal records for this owner yet. This page displays database-backed goals when they are available; it does not invent or import placeholder targets." actionHref={goalAction.href} actionLabel={goalAction.label} label="Goals workspace" supportingText="No goal record is available to display yet." seed="goals-first-use" /> : <GoalsManager goals={goals} plans={plans} destinationAccounts={destinationAccounts} sourceAccounts={sourceAccounts} previews={previews} todayIso={todayIso} readOnly={readOnly} />}
  </ModulePage>;
}
