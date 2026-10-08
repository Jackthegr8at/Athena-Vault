"use client";

import { useActionState, useCallback, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Compass, Sparkles } from "lucide-react";
import { AnimatedLineBackground } from "./animated-line-background";
import { ActionNotification } from "./action-notification";
import {
  isOnboardingGuideVisible,
  initialOnboardingActionState,
  ONBOARDING_STEP_IDS,
  type OnboardingActionState,
  type OnboardingSnapshot,
  type OnboardingStepId,
} from "../onboarding-types";
import { updateOnboardingStateAction } from "../onboarding-actions";

interface OnboardingStepCopy {
  readonly id: OnboardingStepId;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly actionLabel: string;
}

const STEP_COPY: readonly OnboardingStepCopy[] = [
  {
    id: "account",
    title: "Add your first account",
    description: "Start with the account you want to understand first.",
    href: "/accounts",
    actionLabel: "Add account",
  },
  {
    id: "balance",
    title: "Record a current balance",
    description: "Give your account a starting point for the timeline.",
    href: "/accounts",
    actionLabel: "Record balance",
  },
  {
    id: "recurring",
    title: "Add recurring income or expense",
    description: "Make the next cash-flow decisions visible.",
    href: "/cash-flow/recurring",
    actionLabel: "Add recurring movement",
  },
];

function guideStateInput(state: "dismissed" | "completed") {
  return <input type="hidden" name="state" value={state} readOnly />;
}

function ProgressSummary({ snapshot }: { readonly snapshot: OnboardingSnapshot }) {
  const total = ONBOARDING_STEP_IDS.length;
  return (
    <div className="getting-started-progress-wrap">
      <div className="getting-started-progress-label">
        <span>Progress</span>
        <strong>{snapshot.completedCount} of {total} complete</strong>
      </div>
      <div
        className="getting-started-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={snapshot.completedCount}
        aria-valuetext={`${snapshot.completedCount} of ${total} getting started steps complete`}
      >
        <span style={{ width: `${(snapshot.completedCount / total) * 100}%` }} />
      </div>
    </div>
  );
}

function StepRow({ step, snapshot }: { readonly step: OnboardingStepCopy; readonly snapshot: OnboardingSnapshot }) {
  const complete = snapshot[step.id];
  const next = snapshot.nextStepId === step.id;
  return (
    <li className={`getting-started-step ${complete ? "is-complete" : ""} ${next ? "is-next" : ""}`}>
      <span className="getting-started-step-icon" aria-hidden="true">
        {complete ? <Check size={15} strokeWidth={2.4} /> : <span>{ONBOARDING_STEP_IDS.indexOf(step.id) + 1}</span>}
      </span>
      <div className="getting-started-step-copy">
        <strong>{step.title}</strong>
        <span>{step.description}</span>
      </div>
      {complete ? <span className="getting-started-step-status">Complete</span> : next ? <Link href={step.href} className="getting-started-step-action">{step.actionLabel}<ArrowRight aria-hidden="true" size={15} /></Link> : <span className="getting-started-step-status">Next</span>}
    </li>
  );
}

function ExploreLinks() {
  return (
    <div className="getting-started-explore">
      <span className="getting-started-explore-label">Explore next</span>
      <div className="getting-started-explore-links">
        <Link href="/goals">Goals</Link>
        <Link href="/home">Home</Link>
        <Link href="/investments">Investments</Link>
        <Link href="/annual-expenses">Annual expenses</Link>
        <Link href="/shared-expenses">Shared Expenses</Link>
      </div>
    </div>
  );
}

export function GettingStartedCard({ snapshot }: { readonly snapshot: OnboardingSnapshot }) {
  const [visibilityOverride, setVisibilityOverride] = useState<{ readonly snapshotState: OnboardingSnapshot["state"]; readonly hidden: boolean | null }>({ snapshotState: snapshot.state, hidden: null });
  if (visibilityOverride.snapshotState !== snapshot.state) {
    setVisibilityOverride({ snapshotState: snapshot.state, hidden: null });
  }
  const stateAction = useCallback(async (previousState: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> => {
    const nextState = await updateOnboardingStateAction(previousState, formData);
    if (!nextState.ok && nextState.message) setVisibilityOverride({ snapshotState: snapshot.state, hidden: false });
    return nextState;
  }, [snapshot.state]);
  const [actionState, formAction, pending] = useActionState(stateAction, initialOnboardingActionState);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [hasClosedGuide, setHasClosedGuide] = useState(false);
  const isGuideHidden = visibilityOverride.snapshotState === snapshot.state && visibilityOverride.hidden !== null
    ? visibilityOverride.hidden
    : snapshot.state === "dismissed";
  const requestedState = actionState.state;
  const guideVisible = isGuideOpen || (!hasClosedGuide && requestedState !== "dismissed" && requestedState !== "completed" && isOnboardingGuideVisible(snapshot));
  const actionNotification = <ActionNotification state={actionState} />;

  if (isGuideHidden) return <>{actionNotification}</>;

  if (!guideVisible) {
    return (
      <>
        <section className="getting-started-compact" aria-label="Getting started">
          <div>
            <span className="getting-started-compact-label">Getting started</span>
            <p>{snapshot.completedCount === ONBOARDING_STEP_IDS.length ? "Your starting point is ready." : "Pick up the guide whenever you are ready."}</p>
          </div>
          <button type="button" className="account-secondary-button" disabled={pending} onClick={() => { setVisibilityOverride({ snapshotState: snapshot.state, hidden: false }); setHasClosedGuide(false); setIsGuideOpen(true); }}>Open guide <ArrowRight aria-hidden="true" size={15} /></button>
        </section>
        {actionNotification}
      </>
    );
  }

  return (
    <>
      <section className="getting-started-card" aria-labelledby="getting-started-heading" data-onboarding-state={snapshot.state}>
        <AnimatedLineBackground
          lineCount={7}
          opacity={0.2}
          speed={22}
          scale={1.05}
          strokeWidth={1.1}
          density={0.8}
          drift={0.18}
          waveAmplitude={24}
          pulseStrength={0.58}
          color="#947047"
          accentColor="#C49A58"
          direction="downward"
          seed="getting-started"
          className="animated-line-background--getting-started"
        />
        <div className="getting-started-card-intro">
          <div className="getting-started-card-kicker"><Sparkles aria-hidden="true" size={15} />A clear first path</div>
          <h2 id="getting-started-heading">Build your financial starting point</h2>
          <p>Accounts, current balances, and recurring movement give the rest of Athena Vault something useful to work with.</p>
          <div className="getting-started-card-actions">
            <form action={formAction} onSubmit={() => { setHasClosedGuide(true); setIsGuideOpen(false); }}>
              {guideStateInput("completed")}
              <button type="submit" className="account-primary-button" disabled={pending}>I&apos;m done</button>
            </form>
            <form action={formAction} onSubmit={() => { setHasClosedGuide(true); setIsGuideOpen(false); }}>
              {guideStateInput("dismissed")}
              <button type="submit" className="account-secondary-button" disabled={pending}>Not now</button>
            </form>
          </div>
        </div>
        <div className="getting-started-card-details">
          <ProgressSummary snapshot={snapshot} />
          <ol className="getting-started-steps">
            {STEP_COPY.map((step) => <StepRow key={step.id} step={step} snapshot={snapshot} />)}
          </ol>
          <div className="getting-started-orientation">
            <Compass aria-hidden="true" size={16} />
            <Link href="/cash-flow">See it in Cash flow <ArrowRight aria-hidden="true" size={14} /></Link>
          </div>
          <ExploreLinks />
        </div>
        <form action={formAction} onSubmit={() => { setHasClosedGuide(true); setIsGuideOpen(false); setVisibilityOverride({ snapshotState: snapshot.state, hidden: true }); }} className="getting-started-card-footer">
          {guideStateInput("dismissed")}
          <button type="submit" className="getting-started-hide-guide" disabled={pending}>Hide guide</button>
        </form>
      </section>
      {actionNotification}
    </>
  );
}
