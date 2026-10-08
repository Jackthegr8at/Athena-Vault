import Link from "next/link";
import { ArrowRight, Compass, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { AnimatedLineBackground } from "./animated-line-background";

export interface ModuleFirstUseCardProps {
  readonly headingId: string;
  readonly title: string;
  readonly description: string;
  readonly actionHref?: string;
  readonly actionLabel?: string;
  readonly secondaryHref?: string;
  readonly secondaryLabel?: string;
  readonly supportingText?: string;
  readonly label?: string;
  readonly seed?: string;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function ModuleFirstUseCard({
  headingId,
  title,
  description,
  actionHref,
  actionLabel = "Continue",
  secondaryHref,
  secondaryLabel = "Back to overview",
  supportingText = "Start with the next useful record. You can build from there.",
  label = "A clear first path",
  seed = headingId,
  className,
  children,
}: ModuleFirstUseCardProps) {
  const classNames = ["module-first-use-card", className].filter(Boolean).join(" ");
  const hasActions = Boolean(actionHref || secondaryHref || children);

  return <section className={classNames} aria-labelledby={headingId}>
    <AnimatedLineBackground
      lineCount={8}
      opacity={0.28}
      speed={19}
      scale={1.08}
      strokeWidth={1.1}
      density={0.92}
      drift={0.2}
      waveAmplitude={32}
      pulseStrength={0.72}
      color="#61452d"
      accentColor="#976c3c"
      direction="downward"
      seed={seed}
      className="animated-line-background--module-first-use"
    />
    <div className="module-first-use-card-copy">
      <div className="module-first-use-card-kicker"><Sparkles aria-hidden="true" size={15} />{label}</div>
      <h2 id={headingId}>{title}</h2>
      <p>{description}</p>
      {hasActions ? <div className="module-first-use-card-actions">
        {actionHref ? <Link className="account-primary-button" href={actionHref}>{actionLabel}<ArrowRight aria-hidden="true" size={15} /></Link> : null}
        {secondaryHref ? <Link className="account-secondary-button" href={secondaryHref}>{secondaryLabel}</Link> : null}
        {children}
      </div> : null}
    </div>
    <div className="module-first-use-card-route"><Compass aria-hidden="true" size={16} /><span>{supportingText}</span></div>
  </section>;
}
