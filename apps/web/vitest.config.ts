import { defaultExclude, defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// ReactDOM resolves the hoisted workspace peer; use that same module for app imports.
const sharedReactModule = createRequire(import.meta.url).resolve("react");
const testNextImageComponent = fileURLToPath(new URL("./test/next-image.tsx", import.meta.url));
const testNextLinkComponent = fileURLToPath(new URL("./test/next-link.tsx", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^next\/image$/, replacement: testNextImageComponent },
      { find: /^next\/link$/, replacement: testNextLinkComponent },
      { find: /^react$/, replacement: sharedReactModule },
    ],
  },
  test: {
    exclude: [
      ...defaultExclude,
      "**/.next/**",
      "**/.next-*/**",
      "e2e/**",
    ],
  },
});
