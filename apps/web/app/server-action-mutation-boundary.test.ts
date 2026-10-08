import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const readOnlyActionFiles: Record<string, true> = {
  "components/page-help-actions.ts": true,
  "settings/actions.ts": true,
};

// Thin wrappers that delegate their auth/setup checks to lib/server/auth-setup.ts.
// Each entry maps the action file to the single auth-setup export it must call
// and the exact relative specifier it must import it from.
const authSetupDelegatedActions: Record<string, { readonly exportName: string; readonly importPath: string }> = {
  "admin/invite/actions.ts": { exportName: "createInvitation", importPath: "../../../lib/server/auth-setup" },
  "setup/actions.ts": { exportName: "setupFirstUser", importPath: "../../lib/server/auth-setup" },
  "invite/actions.ts": { exportName: "acceptInvitation", importPath: "../../lib/server/auth-setup" },
};

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function relativeAppPath(path: string): string {
  return path.slice(appRoot.length).replaceAll("\\", "/").replace(/^\/+/, "");
}

function currentServerActionFiles(): readonly string[] {
  return listFiles(appRoot)
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .filter((path) => /^\s*["']use server["'];?/m.test(readFileSync(path, "utf8")))
    .map(relativeAppPath);
}

describe("server-action mutation boundaries", () => {
  it("routes every current app server action through the writable boundary except explicit read-only/session actions", () => {
    const actionFiles = currentServerActionFiles();
    expect(actionFiles.length).toBeGreaterThan(0);

    for (const relativePath of actionFiles) {
      const source = readFileSync(`${appRoot}${relativePath}`, "utf8");
      const delegated = authSetupDelegatedActions[relativePath];
      if (delegated) {
        expect(source, relativePath).toContain(`import { ${delegated.exportName} } from "${delegated.importPath}"`);
        expect(source, relativePath).toContain(`return ${delegated.exportName}(`);
        expect(source, relativePath).not.toContain("withWritableAuthenticatedDatabase");
        expect(source, relativePath).not.toContain("withAuthenticatedDatabase");
        expect(source, relativePath).not.toContain("withAuthenticatedPageDatabase");
      } else if (readOnlyActionFiles[relativePath]) {
        expect(source).toContain("withAuthenticatedDatabase");
        expect(source).not.toContain("withWritableAuthenticatedDatabase");
      } else {
        expect(source, relativePath).toContain("withWritableAuthenticatedDatabase");
        expect(source, relativePath).not.toContain("withAuthenticatedDatabase");
      }
    }
  });
});
