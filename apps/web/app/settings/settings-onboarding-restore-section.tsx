import React, { type FormHTMLAttributes } from "react";

interface SettingsOnboardingRestoreSectionProps {
  readonly action: NonNullable<FormHTMLAttributes<HTMLFormElement>["action"]>;
  readonly pending: boolean;
}

export function SettingsOnboardingRestoreSection({ action, pending }: SettingsOnboardingRestoreSectionProps) {
  return <section className="card section-card settings-card settings-onboarding-card editorial-page-art-surface" aria-labelledby="settings-onboarding-heading">
    <div className="settings-card-header">
      <div>
        <p className="eyebrow">Getting started</p>
        <h2 className="card-title" id="settings-onboarding-heading">Bring back the Getting Started guide</h2>
        <p className="card-subtitle">Show the Getting Started guide on the Overview page again.</p>
      </div>
      <form className="settings-onboarding-form" action={action}>
        <input type="hidden" name="state" value="active" readOnly />
        <button className="account-primary-button" type="submit" disabled={pending}>{pending ? "Showing guide…" : "Show the Getting Started guide back"}</button>
      </form>
    </div>
  </section>;
}
