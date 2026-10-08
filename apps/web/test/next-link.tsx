import React from "react";

type TestLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly href: string;
  readonly prefetch?: boolean | null;
  readonly replace?: boolean;
  readonly scroll?: boolean;
};

export default function TestNextLink({ href, prefetch: _prefetch, replace: _replace, scroll: _scroll, ...props }: TestLinkProps) {
  return React.createElement("a", { ...props, href });
}
