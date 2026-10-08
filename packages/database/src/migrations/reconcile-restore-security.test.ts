import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const reconcileSql = readFileSync(
  fileURLToPath(new URL("../../../../scripts/docker/reconcile-local-restore-security.sql", import.meta.url)),
  "utf8",
);

describe("local restore security reconciliation", () => {
  it("keeps the all-tables app grant then restores scoped workspace and auth grants", () => {
    const allTablesGrant = reconcileSql.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO athena_app");
    const verificationRevoke = reconcileSql.indexOf("REVOKE ALL ON TABLE public.auth_verifications FROM athena_app");
    const rateLimitRevoke = reconcileSql.indexOf("REVOKE ALL ON TABLE public.auth_rate_limits FROM athena_app");
    const twoFactorRevoke = reconcileSql.indexOf("REVOKE ALL ON TABLE public.auth_two_factors FROM athena_app");
    const workspaceRevoke = reconcileSql.indexOf("REVOKE DELETE ON TABLE public.workspace_primary_owner FROM athena_app");

    expect(allTablesGrant).toBeGreaterThanOrEqual(0);
    expect(verificationRevoke).toBeGreaterThan(allTablesGrant);
    expect(rateLimitRevoke).toBeGreaterThan(allTablesGrant);
    expect(twoFactorRevoke).toBeGreaterThan(allTablesGrant);
    expect(workspaceRevoke).toBeGreaterThan(allTablesGrant);
    expect(reconcileSql).toContain("GRANT USAGE ON SCHEMA public TO athena_auth");
    expect(reconcileSql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_two_factors TO athena_auth");
    expect(reconcileSql).not.toContain("CREATE ROLE athena_auth");
  });
});
