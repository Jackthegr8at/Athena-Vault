import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./server-only", () => ({}));

import { logOperationalFailure, logSecurityEvent } from "./security-logging";

describe("structured security logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits only the operational failure schema and error class", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logOperationalFailure({
      operation: "database.connect",
      error: new Error("database diagnostic details should not be logged"),
      status: "unavailable",
      failureCode: "DATABASE_CONNECTION_FAILED",
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "operational_failure",
      operation: "database.connect",
      errorClass: "Error",
      status: "unavailable",
      failureCode: "DATABASE_CONNECTION_FAILED",
    });
    expect(line).not.toContain("database diagnostic details");
  });

  it("redacts invalid status and failure-code values", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logOperationalFailure({
      operation: "auth.better_auth",
      status: "success" as never,
      failureCode: "not-safe" as never,
    });

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual({
      event: "operational_failure",
      operation: "auth.better_auth",
      errorClass: "UnknownError",
      status: "redacted",
      failureCode: "UNKNOWN",
    });
  });

  it("keeps the legacy security event schema allowlisted and stable", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logSecurityEvent({
      event: "settings_session_revoke_failed",
      component: "settings",
      operation: "revoke-session",
      status: 503,
      error: new TypeError("raw failure details"),
    });

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual({
      event: "settings_session_revoke_failed",
      component: "settings",
      operation: "revoke-session",
      errorClass: "TypeError",
      status: "server-error",
      failureCode: "SETTINGS_SESSION_REVOKE_FAILED",
    });
  });
});
