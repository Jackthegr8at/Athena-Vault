import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../lib/server/auth";
import { AUTH_RATE_LIMIT_POLICY, authRateLimitScope } from "../../../../lib/server/auth-policy";
import { consumeGlobalAuthRateLimit } from "../../../../lib/server/auth-rate-limit";
import { logOperationalFailure } from "../../../../lib/server/security-logging";

export const dynamic = "force-dynamic";

const handlers = toNextJsHandler(auth);

function tooManyAuthRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } },
  );
}

function statusToFailureStatus(status: number): "invalid" | "unauthorized" | "forbidden" | "unavailable" {
  if (status >= 500 || status === 429) return "unavailable";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "invalid";
}


async function safeAuthHandler(
  handler: (request: Request) => Promise<Response> | Response,
  request: Request,
): Promise<Response> {
  try {
    const response = await handler(request);
    if (response.status >= 400) {
      logOperationalFailure({
        operation: "auth.better_auth",
        status: statusToFailureStatus(response.status),
        failureCode: "AUTH_HANDLER_REJECTED",
      });
    }
    return response;
  } catch (error) {
    logOperationalFailure({
      operation: "auth.better_auth",
      error,
      status: "unavailable",
      failureCode: "AUTH_HANDLER_FAILED",
    });
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return safeAuthHandler(handlers.GET, request);
}

export async function POST(request: Request): Promise<Response> {
  const scope = authRateLimitScope(new URL(request.url).pathname);
  if (scope) {
    let allowed: boolean;
    try {
      allowed = await consumeGlobalAuthRateLimit(`global:${scope}`, AUTH_RATE_LIMIT_POLICY[scope].global);
    } catch (error) {
      logOperationalFailure({
        operation: "auth.better_auth",
        error,
        status: "unavailable",
        failureCode: "AUTH_RATE_LIMIT_FAILED",
      });
      return Response.json(
        { error: "Authentication is currently unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!allowed) return tooManyAuthRequests(AUTH_RATE_LIMIT_POLICY[scope].global.windowSeconds);
  }
  return safeAuthHandler(handlers.POST, request);
}
