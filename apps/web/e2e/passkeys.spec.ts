import { expect, test } from "@playwright/test";

const enabled = process.env.ATHENA_E2E_ENABLED === "true";
const describeFn = enabled ? test.describe : test.describe.skip;

describeFn("Passkeys — local virtual authenticator release gate", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("uses the configured local origin and exposes the optional control only when enabled", async ({ page }) => {
    await page.goto("/login");
    const origin = new URL(page.url());
    expect(["http:", "https:"].includes(origin.protocol)).toBe(true);
    expect(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)).toBe(true);
    if (process.env.ATHENA_PASSKEYS_ENABLED === "true") {
      await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
    }
  });

  test("supports a virtual authenticator ceremony without navigator.credentials polyfills", async ({ page, context }) => {
    test.skip(process.env.ATHENA_PASSKEYS_ENABLED !== "true", "Requires the disposable passkey-enabled local environment.");
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("navigator.credentials polyfill");
  });
});
