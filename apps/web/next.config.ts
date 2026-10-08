import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const workspaceRoot = path.resolve(process.cwd(), "../..");
const pnpmStore = path.join(workspaceRoot, "node_modules", ".pnpm");

function resolvePnpmPackage(packageName: string, packagePrefix: string): string {
  const packageRoot = path.join(workspaceRoot, "node_modules", ...packageName.split("/"));
  const packageManifest = path.join(packageRoot, "package.json");

  if (fs.existsSync(packageManifest)) {
    const packageVersion = JSON.parse(fs.readFileSync(packageManifest, "utf8")).version as string;
    const storeEntry = fs.readdirSync(pnpmStore).find((entry) => entry.startsWith(`${packagePrefix}@${packageVersion}_`) || entry === `${packagePrefix}@${packageVersion}`);
    if (storeEntry) return path.join(pnpmStore, storeEntry, "node_modules", ...packageName.split("/"));
  }

  const storePackagePath = fs.readdirSync(pnpmStore)
    .filter((entry) => entry.startsWith(`${packagePrefix}@`))
    .map((entry) => path.join(pnpmStore, entry, "node_modules", ...packageName.split("/")))
    .find((candidate) => fs.existsSync(path.join(candidate, "package.json")));

  if (!storePackagePath) throw new Error(`Unable to resolve ${packageName} from the pnpm installation.`);
  return storePackagePath;
}

function getAllowedDevelopmentOrigin(): string | undefined {
  if (process.env.NODE_ENV !== "development" || !process.env.BETTER_AUTH_URL) return undefined;
  try {
    return new URL(process.env.BETTER_AUTH_URL).hostname;
  } catch {
    return undefined;
  }
}

const rediPath = resolvePnpmPackage("@wendellhu/redi", "@wendellhu+redi");
const rediTurbopackPath = path.relative(process.cwd(), rediPath).replaceAll("\\", "/");
const allowedDevelopmentOrigin = getAllowedDevelopmentOrigin();
const environmentFileTracingExcludes = [".env", ".env.*", "../../.env", "../../.env.*"];
// Trace patterns resolve from apps/web, even when the trace root is the workspace root.
const developmentPackageTracingExcludes = [
  "../../node_modules/.pnpm/typescript@*/**/*",
  "../../node_modules/.pnpm/vitest@*/**/*",
  "../../node_modules/.pnpm/tsx@*/**/*",
  "../../node_modules/.pnpm/drizzle-kit@*/**/*",
  "../../node_modules/.pnpm/eslint@*/**/*",
  "../../node_modules/.pnpm/jsdom@*/**/*",
  "../../node_modules/.pnpm/@playwright+test@*/**/*",
  "../../node_modules/.pnpm/tailwindcss@*/**/*",
  // Next depends on postcss@8.5.23; only exclude the build-tooling copy.
  "../../node_modules/.pnpm/postcss@8.5.26/**/*",
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Isolated release builds can use a `.next-*` directory to keep
  // normal development output in `.next` untouched.
  distDir: process.env.ATHENA_BUILD_DIST ?? ".next",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  // Next loads supported local environment files before this config runs.
  // These exclusions are defense in depth; the standard web build's
  // next-standalone-security sanitizer is authoritative for the final
  // standalone artifact because Next can still copy an environment file
  // directly into standalone output.
  outputFileTracingExcludes: {
    "/*": [...environmentFileTracingExcludes, ...developmentPackageTracingExcludes],
  },
  transpilePackages: ["@athena/database", "@athena/finance-engine", "@athena/validation"],
  // Univer's packages resolve peer dependencies through different pnpm
  // paths under Turbopack. Keep its shared runtime single-instanced so redi's
  // global lock is not initialized twice in the browser bundle.
  turbopack: {
    resolveAlias: {
      "@wendellhu/redi": rediTurbopackPath,
      "@wendellhu/redi/*": `${rediTurbopackPath}/*`,
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      // Keep the package root singleton without shadowing its package-export
      // subpaths such as `@wendellhu/redi/react-bindings`.
      "@wendellhu/redi$": rediPath,
    };
    return config;
  },
  // Next's middleware is bundled separately from the Node server. Keep the
  // middleware's non-secret origin/proxy policy available in that bundle;
  // database URLs, credentials, and auth secrets stay runtime-only.
  // Leave the local default unconfigured: the Next development server adds
  // its own loopback forwarded headers. Production Compose supplies an
  // explicit proxy policy through the required build/runtime environment.
  // Allow the configured browser-facing host to request dev resources such as
  // HMR; this option is only meaningful to `next dev`.
  ...(allowedDevelopmentOrigin ? { allowedDevOrigins: [allowedDevelopmentOrigin] } : {}),
  env: {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ATHENA_AUTH_TRUSTED_ORIGINS: process.env.ATHENA_AUTH_TRUSTED_ORIGINS ?? "",
    ATHENA_AUTH_TRUSTED_PROXY_IPS: process.env.ATHENA_AUTH_TRUSTED_PROXY_IPS ?? "",
  },
  experimental: {
    // Keep the page-data generation pool bounded on smaller developer/CI hosts.
    cpus: 4,
    // This app supplies a custom webpack alias for Univer. Opt back into the
    // build worker that Next disables by default when a webpack hook exists.
    webpackBuildWorker: true,
    // Workbook snapshots are capped at 5 MB in the database; leave room for
    // the Server Action envelope around the serialized snapshot.
    serverActions: { bodySizeLimit: "8mb" },
  },
  async headers() { return [{ source: "/(.*)", headers: securityHeaders }]; },
};
export default nextConfig;
