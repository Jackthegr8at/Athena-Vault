import React from "react";
import { ArrowRight } from "lucide-react";

type DemoAccessCardProps = Readonly<{
  readonly identifier: string;
  readonly nextPath: string;
  readonly csrfToken: string | null;
}>;

export function DemoAccessCard({ identifier, nextPath, csrfToken }: DemoAccessCardProps) {
  return (
    <section className="login-demo-card" aria-labelledby="login-demo-heading">
      <p className="login-demo-eyebrow">Try the shared demo</p>
      <h2 id="login-demo-heading">Explore a read-only workspace</h2>
      <p className="login-demo-copy">Browse representative data in the shared workspace. Changes to financial records, settings, and the shared fixture are blocked.</p>
      <dl className="login-demo-credentials">
        <div>
          <dt>Demo user</dt>
          <dd><code>{identifier}</code></dd>
        </div>
      </dl>
      <form className="login-demo-form" action="/api/demo/sign-in" method="post">
        <input type="hidden" name="next" value={nextPath} />
        {csrfToken ? <input type="hidden" name="demoCsrfToken" value={csrfToken} /> : null}
        <button className="login-demo-button" type="submit">Continue as demo <ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} /></button>
      </form>
      <p className="login-demo-notice">Shared account · read-only · no personal data · no password entry</p>
    </section>
  );
}
