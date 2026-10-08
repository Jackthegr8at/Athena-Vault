import "./server-only";

import { parseTrustedProxyIpsPolicy } from "./auth-policy";

export interface RequestSecurityEnvironment {
  readonly [key: string]: string | undefined;
  readonly BETTER_AUTH_URL?: string;
  readonly ATHENA_AUTH_TRUSTED_ORIGINS?: string;
  readonly ATHENA_AUTH_TRUSTED_PROXY_IPS?: string;
  readonly ATHENA_PROXY_SHARED_SECRET?: string;
  readonly NODE_ENV?: string;
}

export interface RequestSecurityContext {
  readonly sourceIp?: string | null;
}

export type RequestSecurityResult =
  | { readonly ok: true; readonly origin: string | null }
  | { readonly ok: false; readonly reason: "origin" | "forwarded" | "header" };

export type ProxyRequestResult =
  | { readonly ok: true; readonly origin: string | null }
  | { readonly ok: false; readonly reason: "proxy" | "forwarded" | "origin" };

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PROXY_SOURCE_HEADER = "x-athena-proxy-source";

const PROXY_SECRET_HEADER = "x-athena-proxy-secret";

// The middleware bundle does not expose node:crypto, so the shared-secret
// comparison hashes both sides with WebCrypto and compares the fixed-length
// digests without an early exit.
async function sha256Digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

const configuredSecretDigests = new Map<string, Promise<Uint8Array>>();

// The configured secret only changes when the deployment environment changes,
// so its SHA-256 digest is memoised by value while the supplied secret is
// still hashed for every request.
async function configuredSecretDigest(secret: string): Promise<Uint8Array> {
  const memoised = configuredSecretDigests.get(secret);
  if (memoised) return memoised;
  const digest = sha256Digest(secret);
  configuredSecretDigests.set(secret, digest);
  return digest;
}

async function proxySecretsMatch(expected: string, supplied: string): Promise<boolean> {
  const [expectedDigest, suppliedDigest] = await Promise.all([configuredSecretDigest(expected), sha256Digest(supplied)]);
  // SHA-256 digests are always 32 bytes; DataView.getUint8 returns a definite
  // number, so the byte loop needs no undefined checks. The length difference
  // is folded into the accumulator and the loop never exits early.
  const expectedView = new DataView(expectedDigest.buffer, expectedDigest.byteOffset, expectedDigest.byteLength);
  const suppliedView = new DataView(suppliedDigest.buffer, suppliedDigest.byteOffset, suppliedDigest.byteLength);
  let difference = expectedView.byteLength ^ suppliedView.byteLength;
  for (let index = 0; index < Math.min(expectedView.byteLength, suppliedView.byteLength); index += 1) {
    difference |= expectedView.getUint8(index) ^ suppliedView.getUint8(index);
  }
  return difference === 0;
}

const forwardedOriginHeaderNames = [
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-forwarded-port",
];

const identityForwardingHeaders = [
  "x-real-ip",
  "x-forwarded-user",
  "x-forwarded-email",
  "x-authenticated-user",
  "forwarded",
];

const deniedForwardedHeaderNames = [
  ...forwardedOriginHeaderNames,
  ...identityForwardingHeaders,
];

export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0 || value.trim().toLowerCase() === "null") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeRefererOrigin(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function loopbackOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost") return new URL(`${url.protocol}//127.0.0.1:${url.port}`).origin;
    if (url.hostname === "127.0.0.1") return new URL(`${url.protocol}//localhost:${url.port}`).origin;
  } catch {
    // Invalid configured origins are ignored and fail closed below.
  }
  return null;
}

const trustedOriginsMemo = new Map<string, string[]>();

// Parsing the trusted-origin set is pure configuration work, so it is memoised
// by the raw environment values it reads. A changed value produces a new key,
// which invalidates the memo entry naturally.
export function trustedOrigins(environment: RequestSecurityEnvironment = process.env): string[] {
  const memoKey = `${environment.BETTER_AUTH_URL ?? ""}${environment.ATHENA_AUTH_TRUSTED_ORIGINS ?? ""}`;
  const memoised = trustedOriginsMemo.get(memoKey);
  if (memoised) return [...memoised];
  const origins = parseTrustedOrigins(environment);
  trustedOriginsMemo.set(memoKey, origins);
  return [...origins];
}

function parseTrustedOrigins(environment: RequestSecurityEnvironment): string[] {
  const origins = new Set<string>();
  const applicationOrigin = normalizeOrigin(environment.BETTER_AUTH_URL);
  if (applicationOrigin) {
    origins.add(applicationOrigin);
    const loopback = loopbackOrigin(applicationOrigin);
    if (loopback) origins.add(loopback);
  }
  for (const configured of (environment.ATHENA_AUTH_TRUSTED_ORIGINS ?? "").split(",")) {
    const origin = normalizeOrigin(configured);
    if (!origin) continue;
    origins.add(origin);
  }
  return [...origins];
}

function singleHeader(headers: Headers, name: string): string | null | "multiple" {
  const value = headers.get(name);
  if (!value) return null;
  return value.includes(",") ? "multiple" : value.trim();
}

function parseXForwardedFor(headers: Headers): string[] | "invalid" {
  const raw = headers.get("x-forwarded-for");
  if (raw === null) return [];
  const segments = raw.split(",").map((entry) => entry.trim());
  if (segments.length === 0 || segments.some((entry) => entry.length === 0)) return "invalid";
  return segments;
}

function splitHostPort(hostWithPort: string): { host: string; port: number | undefined } | null {
  if (hostWithPort.startsWith("[")) {
    const close = hostWithPort.indexOf("]");
    if (close === -1) return null;
    const host = hostWithPort.slice(0, close + 1);
    const after = hostWithPort.slice(close + 1);
    if (after === "") return { host, port: undefined };
    if (!after.startsWith(":")) return null;
    const port = Number(after.slice(1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }
  const colon = hostWithPort.lastIndexOf(":");
  if (colon !== -1) {
    const host = hostWithPort.slice(0, colon);
    const port = Number(hostWithPort.slice(colon + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }
  return { host: hostWithPort, port: undefined };
}

function forwardedOrigin(headers: Headers, allowedOrigins: ReadonlySet<string>): string | null | "invalid" {
  const forwardedHost = singleHeader(headers, "x-forwarded-host");
  const forwardedProto = singleHeader(headers, "x-forwarded-proto");
  const forwardedPort = singleHeader(headers, "x-forwarded-port");
  const xff = parseXForwardedFor(headers);
  if (forwardedHost === "multiple" || forwardedProto === "multiple" || forwardedPort === "multiple" || xff === "invalid") {
    return "invalid";
  }

  const hasOriginInputs = forwardedHost !== null || forwardedProto !== null;
  if (!hasOriginInputs) {
    return xff.length === 0 && forwardedPort === null ? null : "invalid";
  }

  if (!forwardedHost || !forwardedProto || (forwardedProto !== "http" && forwardedProto !== "https")) {
    return "invalid";
  }

  const parsedHost = splitHostPort(forwardedHost);
  if (parsedHost === null) return "invalid";

  let explicitPort: number | undefined;
  if (forwardedPort !== null) {
    const port = Number(forwardedPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "invalid";
    explicitPort = port;
  }

  if (explicitPort !== undefined && parsedHost.port !== undefined && explicitPort !== parsedHost.port) {
    return "invalid";
  }

  const effectivePort = parsedHost.port ?? explicitPort;
  const hostPart = effectivePort !== undefined ? `${parsedHost.host}:${effectivePort}` : parsedHost.host;
  const origin = normalizeOrigin(`${forwardedProto}://${hostPart}`);
  return origin && allowedOrigins.has(origin) ? origin : "invalid";
}

function hasForwardedHeaders(headers: Headers): boolean {
  return forwardedOriginHeaderNames.some((name) => headers.has(name));
}

function hasIdentityForwardingHeaders(headers: Headers): boolean {
  return identityForwardingHeaders.some((name) => headers.has(name));
}

function hasDeniedForwardedHeaders(headers: Headers): boolean {
  return deniedForwardedHeaderNames.some((name) => headers.has(name));
}

function isSameOriginFetch(headers: Headers): boolean {
  return headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin";
}

type ProxyPolicyCheck =
  | { readonly type: "unconfigured" }
  | { readonly type: "none" }
  | { readonly type: "allowlist"; readonly list: readonly string[] }
  | { readonly type: "invalid" };

const proxyPolicyMemo = new Map<string, ProxyPolicyCheck>();

function getProxyPolicy(
  environment: RequestSecurityEnvironment,
): ProxyPolicyCheck {
  const raw = environment.ATHENA_AUTH_TRUSTED_PROXY_IPS;
  const memoKey = `${raw ?? ""}${environment.NODE_ENV ?? ""}`;
  const memoised = proxyPolicyMemo.get(memoKey);
  if (memoised) return memoised;
  const policy = parseProxyPolicy(environment, raw);
  proxyPolicyMemo.set(memoKey, policy);
  return policy;
}

function parseProxyPolicy(
  environment: RequestSecurityEnvironment,
  raw: string | undefined,
): ProxyPolicyCheck {
  const value = raw?.trim() ?? "";
  if (value === "") {
    return environment.NODE_ENV === "production" ? { type: "invalid" } : { type: "unconfigured" };
  }
  try {
    const policy = parseTrustedProxyIpsPolicy(raw);
    if (policy.type === "none") return { type: "none" };
    if (policy.ips.some((ip) => ip.toLowerCase() === "none")) return { type: "invalid" };
    return { type: "allowlist", list: [...policy.ips] };
  } catch {
    return { type: "invalid" };
  }
}

function configuredProxyIps(environment: RequestSecurityEnvironment): readonly string[] {
  const policy = getProxyPolicy(environment);
  return policy.type === "allowlist" ? policy.list : [];
}

export function isStateChangingMethod(method: string): boolean {
  return stateChangingMethods.has(method.toUpperCase());
}

export function validateStateChangingRequest(
  request: Pick<Request, "method" | "headers">,
  environment: RequestSecurityEnvironment = process.env,
  context: RequestSecurityContext = {},
): RequestSecurityResult {
  if (!isStateChangingMethod(request.method)) return { ok: true, origin: null };

  const allowedOrigins = new Set(trustedOrigins(environment));
  if (allowedOrigins.size === 0) return { ok: false, reason: "origin" };

  const proxyIps = configuredProxyIps(environment);
  if (hasForwardedHeaders(request.headers) && proxyIps.length > 0 && (!context.sourceIp || !proxyIps.includes(context.sourceIp))) {
    return { ok: false, reason: "forwarded" };
  }

  const forwarded = forwardedOrigin(request.headers, allowedOrigins);
  if (forwarded === "invalid") return { ok: false, reason: "forwarded" };

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const requestOrigin = originHeader !== null ? normalizeOrigin(originHeader) : normalizeRefererOrigin(refererHeader);
  const hasOriginSignal = originHeader !== null || refererHeader !== null;
  const metadataOrigin = !hasOriginSignal && isSameOriginFetch(request.headers)
    ? typeof forwarded === "string" ? forwarded : normalizeOrigin(environment.BETTER_AUTH_URL)
    : null;
  const effectiveOrigin = requestOrigin ?? metadataOrigin;
  if (!effectiveOrigin || !allowedOrigins.has(effectiveOrigin)) return { ok: false, reason: "origin" };
  if (forwarded && forwarded !== effectiveOrigin) return { ok: false, reason: "forwarded" };

  for (const header of ["x-forwarded-user", "x-forwarded-email", "x-authenticated-user"]) {
    if (request.headers.has(header)) return { ok: false, reason: "header" };
  }
  return { ok: true, origin: effectiveOrigin };
}

export async function validateProxyRequest(
  request: Pick<Request, "method" | "headers">,
  environment: RequestSecurityEnvironment = process.env,
  context: RequestSecurityContext = {},
): Promise<ProxyRequestResult> {
  const policy = getProxyPolicy(environment);
  if (policy.type === "invalid") return { ok: false, reason: "proxy" };

  const headerMarker = singleHeader(request.headers, PROXY_SOURCE_HEADER);
  const suppliedMarker = context.sourceIp?.trim() ?? null;

  if (policy.type === "unconfigured") {
    if (request.headers.has(PROXY_SOURCE_HEADER)) return { ok: false, reason: "proxy" };
    const allowedOrigins = new Set(trustedOrigins(environment));
    const forwarded = forwardedOrigin(request.headers, allowedOrigins);
    if (forwarded === "invalid") return { ok: false, reason: "forwarded" };
    return { ok: true, origin: forwarded };
  }

  if (policy.type === "none") {
    if (request.headers.has(PROXY_SOURCE_HEADER)) return { ok: false, reason: "proxy" };
    if (headerMarker === "multiple" || suppliedMarker !== null) return { ok: false, reason: "proxy" };
    if (hasDeniedForwardedHeaders(request.headers)) return { ok: false, reason: "forwarded" };
    return { ok: true, origin: null };
  }

  if (headerMarker === null || headerMarker === "multiple") return { ok: false, reason: "proxy" };
  if (suppliedMarker !== null && suppliedMarker !== headerMarker) return { ok: false, reason: "proxy" };
  if (!policy.list.includes(headerMarker)) return { ok: false, reason: "proxy" };

  const configuredSecret = environment.ATHENA_PROXY_SHARED_SECRET?.trim();
  if (configuredSecret) {
    const suppliedSecret = singleHeader(request.headers, PROXY_SECRET_HEADER);
    if (suppliedSecret === null || suppliedSecret === "multiple" || !(await proxySecretsMatch(configuredSecret, suppliedSecret))) {
      return { ok: false, reason: "proxy" };
    }
  }

  const xff = parseXForwardedFor(request.headers);
  if (xff === "invalid") return { ok: false, reason: "forwarded" };
  if (xff.length > 0 && xff[xff.length - 1] !== headerMarker) return { ok: false, reason: "forwarded" };

  if (hasIdentityForwardingHeaders(request.headers)) return { ok: false, reason: "forwarded" };

  if (hasForwardedHeaders(request.headers)) {
    const allowedOrigins = new Set(trustedOrigins(environment));
    const forwarded = forwardedOrigin(request.headers, allowedOrigins);
    if (forwarded === "invalid") return { ok: false, reason: "forwarded" };
    return { ok: true, origin: forwarded };
  }

  return { ok: true, origin: null };
}
