import Image from "next/image";
import { Landmark, ShieldCheck, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import { isFirstRun } from "../../lib/server/auth-setup";
import { isSetupTokenRequired } from "../../lib/server/auth-setup-token";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await isFirstRun())) {
    redirect("/login");
  }

  return (
    <main className="auth-page">
      <div className="auth-canvas">
        <div className="auth-shell">
          <section className="auth-brand-panel" aria-label="Athena Vault overview">
            <Image className="auth-brand-wordmark" src="/brand/athena-vault-wordmark.svg" alt="Athena Vault" width={300} height={81} />
            <p className="auth-brand-tagline">Private finance workspace</p>
            <div className="auth-brand-rule" aria-hidden="true"><span /><Landmark size={16} strokeWidth={1.6} /><span /></div>
            <h2>Private finance,<br /><em>professionally managed.</em></h2>
            <p className="auth-brand-copy">Athena Vault gives you a clear view of your finances, trusted data, and the tools to plan with confidence.</p>
            <ul className="auth-brand-features">
              <li><span className="auth-brand-feature-icon"><ShieldCheck aria-hidden="true" size={19} strokeWidth={1.7} /></span><span><strong>Secure by design</strong><small>Bank-level security and encryption.</small></span></li>
              <li><span className="auth-brand-feature-icon"><Landmark aria-hidden="true" size={19} strokeWidth={1.7} /></span><span><strong>Owner-controlled</strong><small>You own your data. Always.</small></span></li>
              <li><span className="auth-brand-feature-icon"><TrendingUp aria-hidden="true" size={19} strokeWidth={1.7} /></span><span><strong>Built for clarity</strong><small>Powerful insights. Beautifully simple.</small></span></li>
            </ul>
          </section>
          <div className="auth-form-column">
            <section className="card auth-card" aria-labelledby="setup-heading">
              <div className="auth-card-ornament" aria-hidden="true"><span /><Landmark size={24} strokeWidth={1.5} /><span /></div>
              <p className="auth-card-eyebrow">First-run setup</p>
              <h1 id="setup-heading" className="auth-card-title">Set up Athena Vault</h1>
              <p className="auth-card-subtitle">Create the first account for this workspace.</p>
              <SetupForm setupTokenRequired={isSetupTokenRequired()} />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
