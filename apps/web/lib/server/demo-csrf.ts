import "./server-only";

export const DEMO_CSRF_COOKIE_NAME = "athena_demo_csrf";
export const DEMO_CSRF_REQUEST_HEADER = "x-athena-demo-csrf";

const demoCsrfTokenPattern = /^[0-9a-f]{64}$/i;

export function createDemoCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isDemoCsrfToken(value: unknown): value is string {
  return typeof value === "string" && demoCsrfTokenPattern.test(value);
}

export function demoCsrfTokensMatch(expected: string | null | undefined, provided: unknown): boolean {
  if (!isDemoCsrfToken(expected) || !isDemoCsrfToken(provided) || expected.length !== provided.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return difference === 0;
}
