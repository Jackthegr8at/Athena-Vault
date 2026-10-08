const FALLBACK_ORIGIN = "http://athena.invalid";
const MAX_NEXT_PATH_LENGTH = 2048;
/**
 * Returns true when the string contains an ASCII C0 control character
 * (U+0000..U+001F) or DEL (U+007F).
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
const ENCODED_SLASH_OR_BACKSLASH = /%2f|%5c/i;

/**
 * Returns a safe same-origin redirect target for post-sign-in navigation.
 *
 * Accepts only absolute paths on this origin: a leading single `/`, no
 * backslashes, no C0/DEL control characters, and no percent-encoded `/` or
 * `\` that a downstream decoder could turn into an authority or scheme
 * bypass. Anything else yields `fallback`.
 */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (value.length > MAX_NEXT_PATH_LENGTH) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  if (hasControlCharacter(value)) return fallback;
  if (ENCODED_SLASH_OR_BACKSLASH.test(value)) return fallback;
  try {
    if (new URL(value, FALLBACK_ORIGIN).origin !== FALLBACK_ORIGIN) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
