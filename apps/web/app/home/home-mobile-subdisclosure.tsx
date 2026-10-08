"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface HomeMobileSubdisclosureProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly meta?: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

type HomeMobileSubdisclosureContentProps = Omit<HomeMobileSubdisclosureProps, "defaultOpen"> & {
  readonly bodyId: string;
  readonly defaultOpen: boolean;
};

/**
 * A mobile-only secondary disclosure. It is transparent in the desktop DOM so
 * the approved desktop composition keeps its existing structure and spacing.
 */
export function HomeMobileSubdisclosure({
  eyebrow,
  title,
  meta,
  children,
  defaultOpen = false,
  className = "",
}: HomeMobileSubdisclosureProps) {
  const generatedId = useId().replace(/:/g, "");
  const bodyId = `home-mobile-subdisclosure-${generatedId}-body`;
  return (
    <HomeMobileSubdisclosureContent key={String(defaultOpen)} bodyId={bodyId} eyebrow={eyebrow} title={title} meta={meta} defaultOpen={defaultOpen} className={className}>
      {children}
    </HomeMobileSubdisclosureContent>
  );
}

function HomeMobileSubdisclosureContent({
  eyebrow,
  title,
  meta,
  children,
  defaultOpen,
  className,
  bodyId,
}: HomeMobileSubdisclosureContentProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className={`home-mobile-subdisclosure ${className}`.trim()} data-open={isOpen ? "true" : "false"}>
      <button
        type="button"
        className="home-mobile-subdisclosure-trigger"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="home-mobile-subdisclosure-copy">
          {eyebrow ? <span className="home-mobile-subdisclosure-eyebrow">{eyebrow}</span> : null}
          <span className="home-mobile-subdisclosure-title">{title}</span>
        </span>
        {meta ? <span className="home-mobile-subdisclosure-meta">{meta}</span> : null}
        <ChevronDown aria-hidden="true" className="home-mobile-subdisclosure-chevron" size={18} strokeWidth={1.8} />
      </button>
      <div id={bodyId} className="home-mobile-subdisclosure-body">{children}</div>
    </section>
  );
}
