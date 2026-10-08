import { createHmac } from "node:crypto";
import { test, expect } from "@playwright/test";

/**
 * Required local fixture variables:
 * - ATHENA_E2E_ENABLED=true
 * - ATHENA_E2E_DISPOSABLE=true
 * - ATHENA_E2E_SUITE=authentication
 * - ATHENA_E2E_AUTH_OWNER_EMAIL/PASSWORD
 */

const E2E_ENABLED = process.env.ATHENA_E2E_ENABLED === "true";
const BASE_URL = process.env.ATHENA_E2E_BASE_URL ?? "http://localhost:3000";

const describeFn = E2E_ENABLED ? test.describe : test.describe.skip;
const describeTitle = E2E_ENABLED
  ? "Authentication (Phase 2 local E2E)"
  : "Authentication — skipped: ATHENA_E2E_ENABLED is not true. These tests require a disposable Phase 2 local workspace with the MFA policy implemented.";

function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = value.toUpperCase().replace(/[^A-Z2-7]/g, "");

  let bits = "";
  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function deriveTotpCode(otpauthUri: string, now = Date.now()): string {
  const parsed = new URL(otpauthUri);
  const protocol = parsed.protocol.replace(/:$/, "");

  if (protocol !== "otpauth") {
    throw new Error(`Unsupported OTP protocol: ${protocol}`);
  }
  if (parsed.host !== "totp") {
    throw new Error(`Only TOTP is supported, got: ${parsed.host}`);
  }

  const secret = parsed.searchParams.get("secret");
  if (!secret) {
    throw new Error("Missing secret in otpauth URI");
  }

  const digits = Math.max(3, Math.min(10, Number(parsed.searchParams.get("digits") ?? "6"))) || 6;
  const period = Math.max(1, Number(parsed.searchParams.get("period") ?? "30")) || 30;
  const algorithm = (parsed.searchParams.get("algorithm") ?? "SHA1").toUpperCase();

  const hashName =
    algorithm === "SHA256"
      ? "sha256"
      : algorithm === "SHA512"
        ? "sha512"
        : "sha1";

  const key = base32Decode(secret);
  const counter = BigInt(Math.floor(now / 1000 / period));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter, 0);

  const hmac = createHmac(hashName, key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const code = binary % 10 ** digits;
  return String(code).padStart(digits, "0");
}

describeFn(describeTitle, () => {
  test.describe.configure({ mode: "serial" });

  test.use({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });

  const ownerCredentials = () => {
    const email = process.env.ATHENA_E2E_AUTH_OWNER_EMAIL;
    const password = process.env.ATHENA_E2E_AUTH_OWNER_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "ATHENA_E2E_AUTH_OWNER_EMAIL and ATHENA_E2E_AUTH_OWNER_PASSWORD must be set when ATHENA_E2E_ENABLED is true.",
      );
    }
    return { email, password };
  };

  let capturedOtpauthUri = "";

  test("signs in with owner credentials", async ({ page }) => {
    const { email, password } = ownerCredentials();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
  });

  test("signs out from settings and returns to the login page", async ({ page }) => {
    const { email, password } = ownerCredentials();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/", { timeout: 15_000 });

    await page.goto("/settings");
    await page.getByRole("button", { name: "Log out" }).click();

    await page.waitForURL("/login", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Sign in to Athena Vault" })).toBeVisible();
  });

  test("enables TOTP and acknowledges backup codes", async ({ page }) => {
    const { email, password } = ownerCredentials();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/", { timeout: 15_000 });

    await page.goto("/settings");

    await page.locator(".settings-two-factor-section").getByLabel("Current password").fill(password);
    await page.getByRole("button", { name: "Enable TOTP" }).click();

    const manualCode = page.locator("code.settings-two-factor-dialog-manual-code");
    await page.locator("details.settings-two-factor-dialog-manual summary").click();
    await expect(manualCode).toBeVisible({ timeout: 15_000 });

    const otpauthUri = await manualCode.textContent();
    if (!otpauthUri) {
      throw new Error("No otpauth URI was rendered for TOTP setup.");
    }
    capturedOtpauthUri = otpauthUri;

    const verificationCode = deriveTotpCode(otpauthUri);
    await page.getByLabel("Authenticator code").fill(verificationCode);
    await page.getByRole("button", { name: "Verify and enable" }).click();

    await expect(page.getByText("Two-factor authentication is enabled")).toBeVisible();
    await expect(page.getByText("Save your backup codes")).toBeVisible();

    const backupCodes = await page
      .locator(".settings-two-factor-dialog-codes li code")
      .allTextContents();
    expect(backupCodes.length).toBeGreaterThan(0);

    await page
      .getByRole("checkbox", { name: "I saved my backup codes in a secure place." })
      .check();
    await page.getByRole("button", { name: "Done" }).click();

    await expect(page.locator(".settings-two-factor-section")).toContainText("Enabled");
  });

  test("signs in with TOTP after enrollment", async ({ page }) => {
    const { email, password } = ownerCredentials();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Verify your sign-in")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Authenticator code")).toBeVisible();

    const totpCode = deriveTotpCode(capturedOtpauthUri);
    await page.getByLabel("Authenticator code").fill(totpCode);
    await page.getByRole("button", { name: "Verify code" }).click();

    await page.waitForURL("/", { timeout: 15_000 });
  });
});
