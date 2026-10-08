import "./server-only";

import { createHash } from "node:crypto";
import { PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR, PASSWORD_COMPROMISED_ERROR } from "../password-policy";

const HIBP_RANGE_ENDPOINT = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 5_000;

export type PasswordBreachCheckEnvironment = Readonly<{
  readonly ATHENA_PASSWORD_BREACH_CHECK?: string;
  readonly NODE_ENV?: string;
}>;

export class PasswordCompromisedError extends Error {
  constructor() {
    super(PASSWORD_COMPROMISED_ERROR);
    this.name = "PasswordCompromisedError";
  }
}

export class PasswordBreachCheckUnavailableError extends Error {
  constructor() {
    super(PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR);
    this.name = "PasswordBreachCheckUnavailableError";
  }
}

export function isPasswordBreachCheckEnabled(environment: PasswordBreachCheckEnvironment = process.env): boolean {
  const configured = environment.ATHENA_PASSWORD_BREACH_CHECK?.trim().toLowerCase();
  if (!configured || configured === "enforce") return true;
  if (configured === "off") {
    const nodeEnvironment = environment.NODE_ENV?.trim().toLowerCase();
    if (nodeEnvironment !== "development" && nodeEnvironment !== "test") {
      throw new Error("ATHENA_PASSWORD_BREACH_CHECK=off is allowed only in development or test.");
    }
    return false;
  }
  throw new Error("ATHENA_PASSWORD_BREACH_CHECK must be unset, enforce, or off.");
}

function parsePwnedPasswordResponse(body: string, suffix: string): boolean {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matches = lines.map((line) => line.match(/^([0-9a-f]{35}):(\d+)$/i));
  if (matches.length === 0 || matches.some((match) => match === null)) throw new Error("Invalid HIBP response.");
  return matches.some((match) => match?.[1]?.toUpperCase() === suffix);
}

export async function assertPasswordNotCompromised(
  password: string,
  fetchImplementation: typeof fetch = fetch,
  environment: PasswordBreachCheckEnvironment = process.env,
): Promise<void> {
  if (!password || !isPasswordBreachCheckEnabled(environment)) return;

  const fullHash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = fullHash.slice(0, 5);
  const suffix = fullHash.slice(5);

  try {
    const response = await fetchImplementation(`${HIBP_RANGE_ENDPOINT}${prefix}`, {
      cache: "no-store",
      headers: {
        "Add-Padding": "true",
        "User-Agent": "Athena Vault Password Checker",
      },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HIBP returned HTTP ${response.status}.`);
    if (parsePwnedPasswordResponse(await response.text(), suffix)) throw new PasswordCompromisedError();
  } catch (error) {
    if (error instanceof PasswordCompromisedError) throw error;
    throw new PasswordBreachCheckUnavailableError();
  }
}
