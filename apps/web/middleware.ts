import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { createDemoCsrfToken, DEMO_CSRF_COOKIE_NAME, DEMO_CSRF_REQUEST_HEADER, isDemoCsrfToken } from "./lib/server/demo-csrf";
import { isStateChangingMethod, validateProxyRequest, validateStateChangingRequest } from "./lib/server/request-security";

// Inventory of residual inline `style` attributes/expressions across
// apps/web/app/**/*.tsx as of 2026-09-23. These files contain JSX
// `style={{ ... }}` occurrences that cannot be migrated to classes/data
// attributes without a broad UI rewrite.
// style-src 'unsafe-inline' is retained until this inventory is cleared.
export const residualInlineStyleFiles = [
  "app/accounts/account-manager.tsx",
  "app/accounts/accounts-hero-timeline.tsx",
  "app/accounts/balance-timeline-rows.tsx",
  "app/accounts/balance-timeline.tsx",
  "app/admin/invite/invite-form.tsx",
  "app/admin/invite/page.tsx",
  "app/cash-flow/client.tsx",
  "app/components/animated-line-background.tsx",
  "app/components/getting-started-card.tsx",
  "app/components/module-page.tsx",
  "app/components/net-worth-history-chart.tsx",
  "app/components/overview-hero-cards.tsx",
  "app/components/user-menu.tsx",
  "app/goals/goals-manager.tsx",
  "app/home/household-expenses-manager.tsx",
  "app/investments/investment-dialog.tsx",
  "app/investments/investment-dropdown.tsx",
  "app/investments/investment-project-chart.tsx",
  "app/investments/investment-project-detail.tsx",
  "app/investments/investment-project-row.tsx",
  "app/salaries/salaries-manager.tsx",
] as const;

const publicPagePrefixes = ["/login", "/setup", "/invite", "/security"];
// Fonts and their redistribution notices must load before a user signs in.
// Keep an exact allowlist; this does not expose other public-folder paths.
const publicFontAssets = new Set([
  "/fonts/archivo-latin.woff2",
  "/fonts/playfair-display-latin.woff2",
  "/fonts/archivo-OFL.txt",
  "/fonts/playfair-display-OFL.txt",
]);

function isPublicPage(pathname: string): boolean {
  return publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isDemoSignIn(pathname: string, method: string): boolean {
  return pathname === "/api/demo/sign-in" && method.toUpperCase() === "POST";
}

const workbookSnapshotApiPath = /^\/api\/workbooks\/[^/]+\/snapshot$/;

function isAllowedApiPath(pathname: string): boolean {
  return pathname === "/api/health"
    || pathname === "/api/demo/sign-in"
    || pathname === "/api/investments/symbol-search"
    || pathname === "/api/auth"
    || pathname.startsWith("/api/auth/")
    || workbookSnapshotApiPath.test(pathname);
}

function contentSecurityPolicy(nonce: string): string {
  const scriptSources = ["'self'", `'nonce-${nonce}'`];
  if (process.env.NODE_ENV === "development") scriptSources.push("'unsafe-eval'");

  const styleSources = residualInlineStyleFiles.length > 0
    ? ["'self'", "'unsafe-inline'"]
    : ["'self'"];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (process.env.NODE_ENV === "production") directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

function nextResponseWithContentSecurityPolicy(request: NextRequest, requestHeaders = new Headers(request.headers)): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  return response;
}

function loginResponse(request: NextRequest): NextResponse {
  const existingToken = request.cookies.get(DEMO_CSRF_COOKIE_NAME)?.value;
  const token = isDemoCsrfToken(existingToken) ? existingToken : createDemoCsrfToken();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(DEMO_CSRF_REQUEST_HEADER, token);

  const response = nextResponseWithContentSecurityPolicy(request, requestHeaders);
  if (token !== existingToken) {
    response.cookies.set({
      name: DEMO_CSRF_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });
  }
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const proxySource = request.headers.get("x-athena-proxy-source")?.trim() ?? null;
  // Read only the middleware policy values explicitly. Next bundles the
  // middleware separately, so dynamic access to the whole process.env object
  // does not reliably carry self-hosted deployment values into production.
  const environment = {
    NODE_ENV: process.env.NODE_ENV,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    ATHENA_AUTH_TRUSTED_ORIGINS: process.env.ATHENA_AUTH_TRUSTED_ORIGINS,
    ATHENA_AUTH_TRUSTED_PROXY_IPS: process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS,
    ATHENA_PROXY_SHARED_SECRET: process.env.ATHENA_PROXY_SHARED_SECRET,
  };
  const proxyCheck = await validateProxyRequest(request, environment, { sourceIp: proxySource });
  if (!proxyCheck.ok) {
    return NextResponse.json({ error: "Request rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (isStateChangingMethod(request.method)) {
    const security = validateStateChangingRequest(request, environment, { sourceIp: proxySource });
    if (!security.ok && !(isDemoSignIn(pathname, request.method) && security.reason === "origin")) {
      return NextResponse.json({ error: "Request rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  if (pathname === "/login" && request.method === "GET") return loginResponse(request);
  if (pathname.startsWith("/api/") && !isAllowedApiPath(pathname)) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const isPublicFontRequest = (request.method === "GET" || request.method === "HEAD") && publicFontAssets.has(pathname);
  if (isPublicPage(pathname) || isPublicFontRequest || pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.startsWith("/brand/")) {
    return nextResponseWithContentSecurityPolicy(request);
  }
  if (request.method !== "GET" || getSessionCookie(request)) return nextResponseWithContentSecurityPolicy(request);

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
