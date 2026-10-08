import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.ATHENA_E2E_ENABLED === "true";
const demoEnabled = process.env.ATHENA_DEMO_ENABLED === "true";
const demoIdentifier = process.env.ATHENA_DEMO_IDENTIFIER;
const demoPassword = process.env.ATHENA_DEMO_PASSWORD;

test.skip(
  !e2eEnabled || !demoEnabled || !demoIdentifier || !demoPassword,
  "ATHENA_E2E_ENABLED=true, ATHENA_E2E_DISPOSABLE=true, ATHENA_E2E_SUITE=demo, ATHENA_DEMO_ENABLED=true, and ATHENA_DEMO_IDENTIFIER/PASSWORD are required for a disposable demo environment.",
);

async function signInAsDemo(page: Page) {
  await page.goto("/login");
  await expect(page.locator("section.login-demo-card")).toBeVisible();
  await expect(page.locator("h2#login-demo-heading")).toHaveText(
    "Explore a read-only workspace",
  );
  await expect(page.locator("section.login-demo-card code")).toHaveText(
    demoIdentifier!,
  );
  await page.locator("form.login-demo-form button").click();
  await page.waitForURL("/");
  await expect(page.locator(".user-menu-demo-badge")).toBeVisible();
  await expect(page.locator(".user-menu-demo-badge")).toHaveText(
    "Shared demo · Read-only",
  );
}

const financeRoutes = [
  "/",
  "/accounts",
  "/cash-flow",
  "/workbooks",
  "/shared-expenses",
  "/settings",
];

test.describe("Demo read-only mode", () => {
  test("public demo sign-in from /login lands on the read-only dashboard", async ({
    page,
  }) => {
    await signInAsDemo(page);
    await expect(page.locator("main, [role='main']")).toBeVisible();
  });

  test("navigates representative finance routes in read-only mode", async ({
    page,
  }) => {
    await signInAsDemo(page);

    for (const route of financeRoutes) {
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.locator("body")).not.toContainText("Forbidden");
    }
  });

  test("blocks demo mutation controls in workbooks and settings", async ({
    page,
  }) => {
    await signInAsDemo(page);

    await page.goto("/workbooks", { waitUntil: "networkidle" });
    await expect(page.locator("button.workbook-add-button")).toBeDisabled();
    await expect(page.locator(".workbook-demo-note")).toBeVisible();

    await page.goto("/settings", { waitUntil: "networkidle" });
    await expect(page.locator(".settings-read-only-notice")).toBeVisible();
    await expect(page.locator("form.settings-password-form")).toHaveCount(0);
  });

  test("direct state-changing request from the demo session is forbidden", async ({
    page,
  }) => {
    await signInAsDemo(page);

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/auth/update-user", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "demo-mutation-attempt" }),
      });
      return { status: response.status, text: await response.text() };
    });

    // The request must be rejected with a neutral forbidden response.
    // 403 is expected both from the demo guard and from any upstream CSRF gate.
    expect(result.status).toBe(403);
    expect(result.text).toBeTruthy();
  });

  test("settings privacy does not expose session details", async ({ page }) => {
    await signInAsDemo(page);
    await page.goto("/settings", { waitUntil: "networkidle" });

    await expect(page.locator(".settings-read-only-notice")).toBeVisible();

    // Session rows, identifiers, device labels, and revocation controls must be absent.
    await expect(page.locator(".settings-session-row")).toHaveCount(0);
    await expect(page.locator(".settings-session-list")).toHaveCount(0);
    await expect(page.locator(".settings-session-count")).toHaveCount(0);
    await expect(page.getByText("Signed in")).toHaveCount(0);
    await expect(page.getByText("Expires")).toHaveCount(0);
    await expect(page.getByText("Revoke")).toHaveCount(0);
    await expect(page.getByText("Current session")).toHaveCount(0);
    await expect(page.getByText("Unknown device")).toHaveCount(0);
  });
});
