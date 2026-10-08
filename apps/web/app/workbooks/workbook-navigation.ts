export interface WorkbookNavigationClick {
  readonly href: string;
  readonly currentHref: string;
  readonly button: number;
  readonly defaultPrevented: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly target: string;
  readonly download: boolean;
}

export function resolveWorkbookNavigationHref(input: WorkbookNavigationClick): string | null {
  if (input.defaultPrevented || input.button !== 0 || input.metaKey || input.ctrlKey || input.shiftKey || input.altKey || input.download) return null;
  const target = input.target.trim().toLowerCase();
  if (target && target !== "_self") return null;

  let currentUrl: URL;
  let targetUrl: URL;
  try {
    currentUrl = new URL(input.currentHref);
    targetUrl = new URL(input.href, currentUrl);
  } catch {
    return null;
  }

  if (targetUrl.origin !== currentUrl.origin) return null;
  if (targetUrl.pathname === currentUrl.pathname && targetUrl.search === currentUrl.search) return null;
  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}
