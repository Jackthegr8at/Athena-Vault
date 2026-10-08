import "./login.css";
import Image from "next/image";
import { preload } from "react-dom";
import { Landmark, ShieldCheck, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { isFirstRun } from "../../lib/server/auth-setup";
import { getDemoAccessPresentation } from "../../lib/server/demo-access";
import { DEMO_CSRF_COOKIE_NAME, DEMO_CSRF_REQUEST_HEADER } from "../../lib/server/demo-csrf";
import { safeNextPath } from "../../lib/safe-next-path";
import { DemoAccessCard } from "./demo-access-card";
import { LoginGreeting } from "./login-greeting";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

type LoginSearchParams = { readonly next?: string | string[] };

export default async function LoginPage({ searchParams }: { readonly searchParams?: Promise<LoginSearchParams> }) {
  preload("/brand/sign-in-background.jpg", { as: "image" });
  if (await isFirstRun()) {
    redirect("/setup");
  }
  const demoAccess = getDemoAccessPresentation();
  const params = searchParams ? await searchParams : {};
  const nextPath = safeNextPath(Array.isArray(params.next) ? params.next[0] : params.next);
  const requestHeaders = demoAccess ? await headers() : null;
  const requestCookies = demoAccess ? await cookies() : null;
  const demoCsrfToken = requestCookies?.get(DEMO_CSRF_COOKIE_NAME)?.value ?? requestHeaders?.get(DEMO_CSRF_REQUEST_HEADER) ?? null;
  return <main className="auth-page">
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
        <section className="card auth-card" aria-labelledby="login-heading">
          <div className="auth-card-ornament" aria-hidden="true"><span /><Landmark size={24} strokeWidth={1.5} /><span /></div>
          <LoginGreeting />
          <h1 id="login-heading" className="auth-card-title">Sign in to Athena Vault</h1>
          <p className="auth-card-subtitle">Access your private finance workspace and manage what matters most.</p>

          <LoginForm nextPath={nextPath} passkeysEnabled={process.env.ATHENA_PASSKEYS_ENABLED?.trim().toLowerCase() === "true"} />
          <div className="auth-security-note"><div className="auth-security-heading"><ShieldCheck aria-hidden="true" size={16} strokeWidth={1.7} /><strong>Your security is our priority.</strong></div><a className="auth-security-link" href="/security">Learn more about security <span aria-hidden="true">→</span></a></div>
        </section>

        {demoAccess ? <DemoAccessCard {...demoAccess} nextPath={nextPath} csrfToken={demoCsrfToken} /> : null}

      </div>
    </div>
  </div>
  </main>;
}
