import "./server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export const SETUP_AUTHORIZATION_ERROR = "Setup authorization failed.";

function configuredSetupToken(): string | null {
  const value = process.env.ATHENA_AUTH_SETUP_TOKEN?.trim();
  return value || null;
}

export function isSetupTokenRequired(): boolean {
  return process.env.NODE_ENV === "production" || configuredSetupToken() !== null;
}

export function isSetupTokenValid(candidate: string | undefined): boolean {
  const expected = configuredSetupToken();
  if (expected === null) return process.env.NODE_ENV !== "production";

  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const candidateValue = typeof candidate === "string" ? candidate.trim() : "";
  const candidateDigest = createHash("sha256").update(candidateValue, "utf8").digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}
