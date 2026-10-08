"use client";

import type { MouseEvent, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

interface HomeMobileDetailsLinkProps {
  readonly targetId: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/** Opens a Home disclosure before moving the user to its detail surface. */
export function HomeMobileDetailsLink({ targetId, children, className }: HomeMobileDetailsLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const disclosure = document.getElementById(targetId);
    if (!disclosure) return;

    event.preventDefault();
    const trigger = disclosure.querySelector<HTMLButtonElement>(".home-mobile-disclosure-trigger");
    if (trigger?.getAttribute("aria-expanded") !== "true") trigger?.click();
    window.setTimeout(() => disclosure.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  return <a href={`#${targetId}`} className={className} onClick={handleClick}>
    {children}
    <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
  </a>;
}
