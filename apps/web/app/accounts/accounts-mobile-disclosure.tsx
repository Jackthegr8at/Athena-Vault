"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useMobileDisclosureChildren } from "../components/use-mobile-disclosure-children";

interface AccountsMobileDisclosureProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly eyebrow?: string;
  readonly meta?: string;
  readonly id?: string;
  readonly className?: string;
  readonly defaultOpen?: boolean;
  readonly variant?: "card" | "advanced";
}

/**
 * A mobile-only disclosure wrapper. On desktop the section, trigger, and body
 * are transparent so the shared component inside keeps its existing desktop
 * placement; on phones the trigger appears and the body collapses until opened.
 */
export function AccountsMobileDisclosure({
  title,
  children,
  eyebrow,
  meta,
  id,
  className = "",
  defaultOpen = false,
  variant = "card",
}: AccountsMobileDisclosureProps) {
  const generatedId = useId().replace(/:/g, "");
  const bodyId = `${id ?? `accounts-mobile-disclosure-${generatedId}`}-body`;
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const base = variant === "advanced" ? "accounts-mobile-advanced" : "accounts-mobile-disclosure";
  const showChildren = useMobileDisclosureChildren(isOpen);

  return <section id={id} className={`${base} ${className}`.trim()} data-open={isOpen ? "true" : "false"}>
    <button
      type="button"
      className={`${base}-trigger`}
      aria-expanded={isOpen}
      aria-controls={bodyId}
      onClick={() => setIsOpen((open) => !open)}
    >
      {variant === "advanced" ? (
        <span><strong>{title}</strong>{meta ? <small>{meta}</small> : null}</span>
      ) : (
        <span>{eyebrow ? <small>{eyebrow}</small> : null}<strong>{title}</strong>{meta ? <em>{meta}</em> : null}</span>
      )}
      <ChevronRight aria-hidden="true" size={variant === "advanced" ? 18 : 20} strokeWidth={1.8} />
    </button>
    <div id={bodyId} className={`${base}-body`}>{showChildren ? children : null}</div>
  </section>;
}
