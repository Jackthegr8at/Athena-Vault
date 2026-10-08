"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useMobileDisclosureChildren } from "../components/use-mobile-disclosure-children";

interface HomeMobileDisclosureProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly meta: string;
  readonly children: ReactNode;
  readonly id?: string;
  readonly className?: string;
  readonly defaultOpen?: boolean;
}

type HomeMobileDisclosureContentProps = Omit<HomeMobileDisclosureProps, "defaultOpen"> & {
  readonly bodyId: string;
  readonly defaultOpen: boolean;
};

/**
 * Keeps Home's desktop sections in their existing layout while giving phones
 * a compact, native disclosure surface for secondary detail.
 */
export function HomeMobileDisclosure({
  eyebrow,
  title,
  meta,
  children,
  id,
  className = "",
  defaultOpen = false,
}: HomeMobileDisclosureProps) {
  const generatedId = useId().replace(/:/g, "");
  const bodyId = `${id ?? `home-mobile-disclosure-${generatedId}`}-body`;
  return <HomeMobileDisclosureContent key={String(defaultOpen)} id={id} bodyId={bodyId} eyebrow={eyebrow} title={title} meta={meta} className={className} defaultOpen={defaultOpen}>{children}</HomeMobileDisclosureContent>;
}

function HomeMobileDisclosureContent({
  eyebrow,
  title,
  meta,
  children,
  id,
  bodyId,
  className,
  defaultOpen,
}: HomeMobileDisclosureContentProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const showChildren = useMobileDisclosureChildren(isOpen);

  return <section id={id} className={`home-mobile-disclosure ${className}`.trim()} data-open={isOpen ? "true" : "false"}>
    <button
      type="button"
      className="home-mobile-disclosure-trigger"
      aria-expanded={isOpen}
      aria-controls={bodyId}
      onClick={() => setIsOpen((open) => !open)}
    >
      <span className="home-mobile-disclosure-copy">
        <span className="home-mobile-disclosure-eyebrow">{eyebrow}</span>
        <span className="home-mobile-disclosure-title">{title}</span>
      </span>
      <span className="home-mobile-disclosure-meta">{meta}</span>
      <ChevronDown className="home-mobile-disclosure-chevron" aria-hidden="true" size={18} strokeWidth={1.8} />
    </button>
    <div id={bodyId} className="home-mobile-disclosure-body">{showChildren ? children : null}</div>
  </section>;
}
