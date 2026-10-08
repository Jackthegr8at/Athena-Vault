import { AUTH_RATE_LIMIT_POLICY } from "../../../../lib/server/auth-policy";
import { consumeGlobalAuthRateLimit } from "../../../../lib/server/auth-rate-limit";
import { auth } from "../../../../lib/server/auth";
import { demoCsrfTokensMatch, DEMO_CSRF_COOKIE_NAME } from "../../../../lib/server/demo-csrf";
import { normalizeOrigin } from "../../../../lib/server/request-security";
import { safeNextPath } from "../../../../lib/safe-next-path";
import { getDemoAccessCredentials } from "../../../../lib/server/demo-access";
import { logOperationalFailure } from "../../../../lib/server/security-logging";

export const dynamic = "force-dynamic";

function unavailableResponse(status = 503): Response {
  return Response.json(
    { error: "Demo sign-in is currently unavailable." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function statusToFailureStatus(status: number): "invalid" | "unauthorized" | "forbidden" | "unavailable" {
  if (status >= 500 || status === 429) return "unavailable";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "invalid";
}

function internalAuthOrigin(request: Request): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim().toLowerCase();
  if (forwardedHost && forwardedProto && !forwardedHost.includes(",") && !forwardedProto.includes(",")) {
    const forwardedOrigin = normalizeOrigin(`${forwardedProto}://${forwardedHost}`);
    if (forwardedOrigin) return forwardedOrigin;
  }

  return normalizeOrigin(process.env.BETTER_AUTH_URL) ?? normalizeOrigin(new URL(request.url).origin);
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const demo = getDemoAccessCredentials();
  if (!demo) return unavailableResponse(404);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return unavailableResponse(400);
  }

  if (!demoCsrfTokensMatch(cookieValue(request, DEMO_CSRF_COOKIE_NAME), formData.get("demoCsrfToken"))) {
    return unavailableResponse(403);
  }

  let allowed: boolean;
  try {
    allowed = await consumeGlobalAuthRateLimit("global:login", AUTH_RATE_LIMIT_POLICY.login.global);
  } catch (error) {
    logOperationalFailure({
      operation: "auth.demo_signin",
      error,
      status: "unavailable",
      failureCode: "DEMO_SIGNIN_RATE_LIMIT_FAILED",
    });
    return unavailableResponse(503);
  }
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(AUTH_RATE_LIMIT_POLICY.login.global.windowSeconds) } },
    );
  }

  const nextPath = safeNextPath(formData.get("next"));

  const authHeaders = new Headers(request.headers);
  authHeaders.delete("content-length");
  authHeaders.delete("content-type");
  // Native form submissions from privacy-focused browsers may send an empty
  // or `null` Origin. Better Auth sees the forwarded demo CSRF cookie and
  // therefore requires a valid origin, so use the canonical proxy origin for
  // this server-to-server sign-in request instead of forwarding the client
  // value verbatim.
  const origin = internalAuthOrigin(request);
  if (origin) authHeaders.set("origin", origin);
  authHeaders.set("content-type", "application/json");

  const authRequest = new Request(new URL("/api/auth/sign-in/email", request.url), {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      email: demo.identifier,
      password: demo.password,
      callbackURL: nextPath,
    }),
  });

  let authResponse: Response;
  try {
    authResponse = await auth.handler(authRequest);
  } catch (error) {
    logOperationalFailure({
      operation: "auth.demo_signin",
      error,
      status: "unavailable",
      failureCode: "DEMO_SIGNIN_AUTH_HANDLER_FAILED",
    });
    return unavailableResponse(503);
  }
  if (authResponse.status >= 400) {
    const failureStatus = statusToFailureStatus(authResponse.status);
    logOperationalFailure({
      operation: "auth.demo_signin",
      status: failureStatus,
      failureCode: "DEMO_SIGNIN_REJECTED",
    });
    return unavailableResponse(503);
  }

  const responseHeaders = new Headers(authResponse.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-type");
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("location", nextPath);
  return new Response(null, { status: 303, headers: responseHeaders });
}
