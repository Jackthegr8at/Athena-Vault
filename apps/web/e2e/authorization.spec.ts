import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Run only on a freshly reset fixture:
 * ATHENA_E2E_ENABLED=true ATHENA_E2E_DISPOSABLE=true ATHENA_E2E_SUITE=authorization
 */

const enabled = process.env.ATHENA_E2E_ENABLED === "true";
const baseURL = process.env.ATHENA_E2E_BASE_URL || "http://localhost:3000";

const ownerAEmail = process.env.ATHENA_E2E_OWNER_A_EMAIL;
const ownerAPassword = process.env.ATHENA_E2E_OWNER_A_PASSWORD;
const ownerBEmail = process.env.ATHENA_E2E_OWNER_B_EMAIL;
const ownerBPassword = process.env.ATHENA_E2E_OWNER_B_PASSWORD;

const missingEnv =
  !enabled ||
  !ownerAEmail ||
  !ownerAPassword ||
  !ownerBEmail ||
  !ownerBPassword;

test.skip(
  missingEnv,
  "ATHENA_E2E_ENABLED is not true or required owner fixture credentials are missing"
);

test.setTimeout(120_000);

test("two disposable owners are isolated on /shared-expenses and tampered project ids fail neutrally", async ({
  browser,
}) => {
  const fixtureId = randomUUID();
  const projectName = `Owner A shared expense ${fixtureId}`;
  const projectNote = `Fixture note for ${fixtureId}`;
  const expenseAmount = "123.45";
  const bProjectName = `Owner B shared expense ${randomUUID()}`;

  // Owner A: create the first account through setup.
  const aContext = await browser.newContext({ baseURL });
  await aContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const aPage = await aContext.newPage();

  await aPage.goto("/setup");
  await aPage.locator('input[name="email"]').fill(ownerAEmail!);
  await aPage.locator('input[name="displayName"]').fill("Owner A");
  await aPage.locator('input[name="password"]').fill(ownerAPassword!);

  const setupTokenInput = aPage.locator('input[name="setupToken"]');
  if (await setupTokenInput.count() > 0) {
    await setupTokenInput.fill(process.env.ATHENA_E2E_SETUP_TOKEN ?? "");
  }

  await aPage.locator('button.login-submit-button').click();
  await aPage.waitForURL("/");

  // Owner A: invite owner B.
  await aPage.goto("/admin/invite");
  await aPage.locator('input[name="email"]').fill(ownerBEmail!);
  await aPage.locator('input[name="displayName"]').fill("Owner B");
  await aPage.getByRole("button", { name: "Create invitation" }).click();
  await aPage.locator("div.account-message.is-success").waitFor();
  await aPage.getByRole("button", { name: "Copy link" }).click();
  await aPage.getByText("Copied link.").waitFor();
  await expect
    .poll(() => aPage.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
    .toContain("token=");

  const inviteLink = await aPage.evaluate(() => navigator.clipboard.readText());
  const token = new URL(inviteLink, baseURL).searchParams.get("token");
  if (!token) throw new Error("Invitation token not found in copied link");

  // Owner B: accept the invitation and sign in.
  const bContext = await browser.newContext({ baseURL });
  const bPage = await bContext.newPage();

  await bPage.goto(`/invite?token=${encodeURIComponent(token)}`);
  await bPage.locator('input[name="token"]').fill(token);
  await bPage.locator('input[name="email"]').fill(ownerBEmail!);
  await bPage.locator('input[name="displayName"]').fill("Owner B");
  await bPage.locator('input[name="password"]').fill(ownerBPassword!);
  await bPage.getByRole("button", { name: "Create account" }).click();
  await bPage.waitForURL("/");

  // Owner A: create a shared expense project on /shared-expenses.
  await aPage.goto("/shared-expenses");
  await aPage.getByRole("button", { name: "New shared expense" }).click();
  await aPage.locator('input[name="name"]').fill(projectName);
  await aPage.locator('input[name="year"]').fill(String(new Date().getFullYear()));
  await aPage.locator('input[name="ownerParticipates"]').check();
  await aPage.locator('textarea[name="projectNote"]').fill(projectNote);
  await aPage.getByRole("button", { name: "Create shared expense" }).click();
  await aPage.locator("table.projects-table").waitFor();

  const aProjectLink = await aPage
    .locator("table.projects-table tbody th a")
    .first()
    .getAttribute("href");
  const aProjectId = aProjectLink?.split("/").pop();
  if (!aProjectId) throw new Error("Owner A project id not found in list");

  // Add an expense so the list shows a distinctive amount for owner A.
  await aPage.goto(`/shared-expenses/${aProjectId}`);
  await aPage.getByRole("button", { name: "Add expense" }).click();
  await aPage.locator('input[name="description"]').fill(`Expense ${fixtureId}`);
  await aPage.locator('input[name="amount"]').fill(expenseAmount);
  await aPage.getByRole("button", { name: "Add expense" }).click();
  await aPage.locator("article#project-expenses-panel").waitFor();

  await aPage.goto("/shared-expenses");
  await aPage.locator("table.projects-table").waitFor();
  await expect(aPage.getByText(projectName)).toBeVisible();
  await expect(aPage.getByText(expenseAmount)).toBeVisible();

  // Owner B: /shared-expenses must not expose owner A's project name or amount.
  await bPage.goto("/shared-expenses");
  await expect(bPage.getByText(projectName)).toHaveCount(0);
  await expect(bPage.getByText(expenseAmount)).toHaveCount(0);
  await expect(bPage.getByText("No active shared expenses yet.")).toBeVisible();

  // Owner B: directly navigating to owner A's project URL must produce a neutral 404.
  const tamperedUrlResponse = await bPage.goto(`/shared-expenses/${aProjectId}`);
  if (tamperedUrlResponse) {
    expect(tamperedUrlResponse.status()).toBe(404);
  }
  await expect(bPage.locator("section#project-workspace")).not.toBeVisible();
  await expect(bPage.getByText(projectName)).toHaveCount(0);
  await expect(bPage.getByText(expenseAmount)).toHaveCount(0);

  // Owner B: create a project so we can tamper the update form with owner A's id.
  await bPage.goto("/shared-expenses");
  await bPage.getByRole("button", { name: "New shared expense" }).click();
  await bPage.locator('input[name="name"]').fill(bProjectName);
  await bPage.locator('input[name="year"]').fill(String(new Date().getFullYear()));
  await bPage.locator('input[name="ownerParticipates"]').check();
  await bPage.getByRole("button", { name: "Create shared expense" }).click();
  await bPage.locator("table.projects-table").waitFor();

  const bProjectLink = await bPage
    .locator("table.projects-table tbody th a")
    .first()
    .getAttribute("href");
  const bProjectId = bProjectLink?.split("/").pop();
  if (!bProjectId) throw new Error("Owner B project id not found in list");

  await bPage.goto(`/shared-expenses/${bProjectId}`);
  await bPage.getByRole("button", { name: "Edit project details" }).click();

  // Tamper the hidden projectId to owner A's id while the form belongs to owner B.
  await bPage.evaluate(
    (id) => {
      const el = document.querySelector(
        'input[name="projectId"]'
      ) as HTMLInputElement | null;
      if (el) el.value = id;
    },
    aProjectId
  );
  await bPage.locator('input[name="name"]').fill(`Tampered ${projectName}`);
  await bPage.getByRole("button", { name: "Save details" }).click();
  await expect(bPage.locator(".project-action-message.is-error")).toContainText(
    "That project was not found."
  );

  // Owner B's project is unchanged.
  await expect(bPage.getByRole("heading", { name: bProjectName })).toBeVisible();

  // Owner A: owner B's project must never appear in owner A's list.
  await aPage.goto("/shared-expenses");
  await aPage.locator("table.projects-table").waitFor();
  await expect(aPage.locator("table.projects-table tbody tr")).toHaveCount(1);
  await expect(aPage.getByText(bProjectName)).toHaveCount(0);
  await expect(aPage.getByText(projectName)).toBeVisible();

  await aContext.close();
  await bContext.close();
});
