import "./server-only";

export type SecurityEventName = "settings_security_summary_unavailable" | "settings_session_revoke_failed" | "auth_security_event_failed";

const SECURITY_EVENT_NAMES: ReadonlySet<string> = new Set<string>([
  "settings_security_summary_unavailable",
  "settings_session_revoke_failed",
  "auth_security_event_failed",
]);

const SECURITY_EVENT_FAILURE_CODES: Record<SecurityEventName, string> = {
  settings_security_summary_unavailable: "SETTINGS_SECURITY_SUMMARY_UNAVAILABLE",
  settings_session_revoke_failed: "SETTINGS_SESSION_REVOKE_FAILED",
  auth_security_event_failed: "AUTH_SECURITY_EVENT_FAILED",
};

const SECURITY_COMPONENTS: ReadonlySet<string> = new Set<string>(["settings", "auth"]);

const SECURITY_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "load-security-summary",
  "revoke-session",
  "two-factor-enable",
  "two-factor-disable",
  "backup-codes-regenerate",
  "session-revoke",
  "session-create",
  "password-change",
  "passkey-register",
  "passkey-authenticate",
  "passkey-revoke",
  "notification-email",
]);

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export type RedactedSecurityStatus = "unknown" | "success" | "client-error" | "server-error";

export type SecurityEventInput = {
  readonly event: SecurityEventName;
  readonly component: string;
  readonly operation: string;
  readonly error?: unknown;
  readonly status?: number;
};

function redactStatus(status: number | undefined): RedactedSecurityStatus {
  if (typeof status !== "number" || !Number.isFinite(status)) return "unknown";
  if (status >= 200 && status < 300) return "success";
  if (status >= 400 && status < 500) return "client-error";
  if (status >= 500 && status < 600) return "server-error";
  return "unknown";
}

function errorClassName(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return ERROR_CLASS_PATTERN.test(name) ? name : "UnknownError";
}

export function logSecurityEvent(input: SecurityEventInput): void {
  if (!SECURITY_EVENT_NAMES.has(input.event)) return;
  if (!SECURITY_COMPONENTS.has(input.component)) return;
  if (!SECURITY_OPERATIONS.has(input.operation)) return;
  console.error(
    JSON.stringify({
      event: input.event,
      component: input.component,
      operation: input.operation,
      errorClass: errorClassName(input.error),
      status: redactStatus(input.status),
      failureCode: SECURITY_EVENT_FAILURE_CODES[input.event],
    }),
  );
}

export type OperationalFailureOperation =
  | "auth.better_auth"
  | "auth.demo_signin"
  | "database.connect"
  | "database.configure"
  | "database.verify"
  | "migration.run"
  | "backup.scheduled"
  | "backup.run"
  | "restore.database"
  | "restore.production"
  | "verify.restore"
  | "verify.local_backup";

export type OperationalFailureStatus =
  | "failed"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "invalid"
  | "aborted"
  | "redacted";

const OPERATIONAL_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "auth.better_auth",
  "auth.demo_signin",
  "database.connect",
  "database.configure",
  "database.verify",
  "migration.run",
  "backup.scheduled",
  "backup.run",
  "restore.database",
  "restore.production",
  "verify.restore",
  "verify.local_backup",
]);

const OPERATIONAL_STATUSES: ReadonlySet<string> = new Set<string>([
  "failed",
  "unauthorized",
  "forbidden",
  "unavailable",
  "invalid",
  "aborted",
  "redacted",
]);

const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]+$/;

function redactOperationalStatus(status: string | undefined): OperationalFailureStatus {
  if (status && OPERATIONAL_STATUSES.has(status)) return status as OperationalFailureStatus;
  return "redacted";
}

export type OperationalFailureInput = {
  readonly operation: OperationalFailureOperation;
  readonly error?: unknown;
  readonly status?: OperationalFailureStatus;
  readonly failureCode: string;
};

export function logOperationalFailure(input: OperationalFailureInput): void {
  if (!OPERATIONAL_OPERATIONS.has(input.operation)) return;
  const failureCode = FAILURE_CODE_PATTERN.test(input.failureCode) ? input.failureCode : "UNKNOWN";
  console.error(
    JSON.stringify({
      event: "operational_failure",
      operation: input.operation,
      errorClass: errorClassName(input.error),
      status: redactOperationalStatus(input.status),
      failureCode,
    }),
  );
}
