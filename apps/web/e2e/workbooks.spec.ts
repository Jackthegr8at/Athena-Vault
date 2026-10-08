import { test, expect } from "@playwright/test";

/**
 * Required local fixture variables:
 * - ATHENA_E2E_ENABLED=true
 * - ATHENA_E2E_DISPOSABLE=true
 * - ATHENA_E2E_SUITE=workbooks
 * - ATHENA_E2E_WORKBOOK_OWNER_EMAIL/PASSWORD
 */
const enabled = process.env.ATHENA_E2E_ENABLED === "true";
const baseURL = process.env.ATHENA_E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Workbook lifecycle through the real UI", () => {
  test.skip(!enabled, "ATHENA_E2E_ENABLED is not 'true'; skipping local E2E suite.");
  test.use({ baseURL });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("creates, saves, reloads, guards unsaved changes, and fails safely through the workbench", async ({ page }) => {
    const ownerEmail = process.env.ATHENA_E2E_WORKBOOK_OWNER_EMAIL;
    const ownerPassword = process.env.ATHENA_E2E_WORKBOOK_OWNER_PASSWORD;
    if (!ownerEmail || !ownerPassword) {
      throw new Error("ATHENA_E2E_WORKBOOK_OWNER_EMAIL and ATHENA_E2E_WORKBOOK_OWNER_PASSWORD must be set.");
    }

    await test.step("sign in as the synthetic owner", async () => {
      await page.goto("/login");
      await page.fill('input[name="email"]', ownerEmail);
      await page.fill('input[name="password"]', ownerPassword);
      await page.click('button.login-submit-button');
      await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
      await page.goto("/workbooks");
      await page.waitForSelector('section[aria-label="Calculation workbench"]');
    });

    const baseName = `E2E Workbook ${Date.now()}`;
    const stayName = `${baseName} stay`;
    const discardName = `${baseName} discarded`;
    const nameInput = page.locator('input#calculation-workbook-name');
    const saveButton = page.locator('button.workbook-save-button');
    const saveState = page.locator('.workbook-save-state');

    await test.step("create a workbook and wait for the dynamic editor save callback", async () => {
      await page.click('button[aria-label="Create workbook"]');
      await page.waitForURL(/\/workbooks\?workbook=/, { timeout: 15000 });
      await page.waitForSelector('div.athena-univer-editor[aria-label="Calculation workbook editor"]');
      await expect(nameInput).toHaveValue("");
    });

    await test.step("safe failure: save is disabled while the editor name is empty", async () => {
      await expect(saveButton).toBeDisabled();
    });

    await test.step("edit the workbook name, save, and verify the list updates", async () => {
      await nameInput.fill(baseName);
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(saveState).toContainText("Saved");
      await expect(page.locator('aside[aria-label="Saved workbooks"]')).toContainText(baseName);
    });

    await test.step("reload and confirm the saved name persisted", async () => {
      await page.reload();
      await page.waitForSelector('input#calculation-workbook-name');
      await expect(nameInput).toHaveValue(baseName);
      await expect(saveState).toContainText("Saved");
    });

    await test.step("choose to stay when leaving with unsaved changes", async () => {
      await nameInput.fill(stayName);
      await page.locator('a[href="/accounts"]').first().click();
      await page.waitForSelector('dialog.confirmation-dialog');
      await expect(page.locator('h2.confirmation-dialog__title')).toHaveText("Save workbook changes before leaving?");
      await page.click('button.confirmation-dialog__cancel');
      await expect(page.locator('dialog.confirmation-dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/\/workbooks\?workbook=/);
      await expect(nameInput).toHaveValue(stayName);
    });

    await test.step("choose to save and leave when leaving with unsaved changes", async () => {
      await page.locator('a[href="/accounts"]').first().click();
      await page.waitForSelector('dialog.confirmation-dialog');
      await page.click('button.confirmation-dialog__confirm');
      await page.waitForURL("/accounts", { timeout: 15000 });
    });

    await test.step("return and confirm the saved-and-left name persisted", async () => {
      await page.goto("/workbooks");
      await page.waitForSelector('button.workbook-list-item');
      await page.click('button.workbook-list-item');
      await page.waitForURL(/\/workbooks\?workbook=/, { timeout: 15000 });
      await expect(nameInput).toHaveValue(stayName);
    });

    await test.step("choose to leave without saving", async () => {
      await nameInput.fill(discardName);
      await page.locator('a[href="/accounts"]').first().click();
      await page.waitForSelector('dialog.confirmation-dialog');
      await page.click('button.confirmation-dialog__secondary');
      await page.waitForURL("/accounts", { timeout: 15000 });
    });

    await test.step("return and confirm the discarded change was not saved", async () => {
      await page.goto("/workbooks");
      await page.waitForSelector('button.workbook-list-item');
      await page.click('button.workbook-list-item');
      await page.waitForURL(/\/workbooks\?workbook=/, { timeout: 15000 });
      await expect(nameInput).toHaveValue(stayName);
    });

    await test.step("delete all workbooks and verify the empty state", async () => {
      let remaining = await page.locator('button.workbook-list-item').count();
      while (remaining > 0) {
        page.once("dialog", async (dialog) => {
          if (dialog.type() === "confirm") await dialog.accept();
        });
        await page.click('button[aria-label="Delete workbook"]');
        await expect.poll(async () => page.locator('button.workbook-list-item').count()).toBe(remaining - 1);
        remaining -= 1;
      }

      await page.waitForSelector('.workbook-empty-state');
      await expect(page.locator('.workbook-empty-state')).toContainText("Start a private workbook");
      const createEmptyButton = page.locator('.workbook-empty-state button.account-primary-button');
      await expect(createEmptyButton).toBeEnabled();
      await expect(createEmptyButton).toContainText("Create workbook");
      await expect(page.locator('aside[aria-label="Saved workbooks"]')).toContainText("0 saved workbooks");
    });

    await test.step("safe failure from the empty state: create button still works and empty names remain non-saveable", async () => {
      await page.locator('.workbook-empty-state button.account-primary-button').click();
      await page.waitForURL(/\/workbooks\?workbook=/, { timeout: 15000 });
      await page.waitForSelector('input#calculation-workbook-name');
      await expect(saveButton).toBeDisabled();
      await nameInput.fill(baseName);
      await expect(saveButton).toBeEnabled();
    });
  });
});
