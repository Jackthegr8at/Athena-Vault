import { test, expect, type Page } from "@playwright/test";

/**
 * TASK-021 — Financial invariants (Phase 2 browser spec)
 *
 * This suite asserts three financial invariants using two disposable owners
 * against a migrated, fixture-driven local database:
 *
 *   1. Integer-minor-unit money mutation on /accounts renders the exact decimal.
 *   2. Owner scope: no account name or balance display crosses owner contexts.
 *   3. An existing Actual balance marker/value on /accounts remains unchanged
 *      after a planned /cash-flow transaction.
 *
 * All credentials, identifiers, and expected display values come from the
 * environment. The suite is skipped with a clear reason when the gate or any
 * required fixture variable is missing. No production data or secrets are
 * committed.
 *
 * Required environment (all values are disposable local fixtures):
 *   ATHENA_E2E_ENABLED=true ATHENA_E2E_DISPOSABLE=true
 *   ATHENA_E2E_SUITE=financial-invariants
 *   ATHENA_E2E_OWNER_A_EMAIL
 *   ATHENA_E2E_OWNER_A_PASSWORD
 *   ATHENA_E2E_OWNER_B_EMAIL
 *   ATHENA_E2E_OWNER_B_PASSWORD
 *   ATHENA_E2E_OWNER_A_MAIN_ACCOUNT
 *   ATHENA_E2E_OWNER_A_MAIN_BALANCE
 *   ATHENA_E2E_OWNER_B_MAIN_ACCOUNT
 *   ATHENA_E2E_OWNER_B_MAIN_BALANCE
 *   ATHENA_E2E_MUTATION_ACCOUNT_NAME
 *   ATHENA_E2E_MUTATION_AMOUNT
 *   ATHENA_E2E_MUTATION_DISPLAY
 *   ATHENA_E2E_TRANSACTION_DESCRIPTION
 *   ATHENA_E2E_TRANSACTION_AMOUNT
 *   ATHENA_E2E_TRANSACTION_DISPLAY
 */
const baseURL = process.env.ATHENA_E2E_BASE_URL ?? "http://localhost:3000";


const REQUIRED_ENV = [
  "ATHENA_E2E_OWNER_A_EMAIL",
  "ATHENA_E2E_OWNER_A_PASSWORD",
  "ATHENA_E2E_OWNER_B_EMAIL",
  "ATHENA_E2E_OWNER_B_PASSWORD",
  "ATHENA_E2E_OWNER_A_MAIN_ACCOUNT",
  "ATHENA_E2E_OWNER_A_MAIN_BALANCE",
  "ATHENA_E2E_OWNER_B_MAIN_ACCOUNT",
  "ATHENA_E2E_OWNER_B_MAIN_BALANCE",
  "ATHENA_E2E_MUTATION_ACCOUNT_NAME",
  "ATHENA_E2E_MUTATION_AMOUNT",
  "ATHENA_E2E_MUTATION_DISPLAY",
  "ATHENA_E2E_TRANSACTION_DESCRIPTION",
  "ATHENA_E2E_TRANSACTION_AMOUNT",
  "ATHENA_E2E_TRANSACTION_DISPLAY",
] as const;

function env(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required E2E environment variable: ${key}`);
  }
  return value;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function accountBalanceCell(page: Page, accountName: string) {
  return page
    .locator("tr", {
      hasText: new RegExp(escapeRegex(accountName)),
    })
    .locator("td.is-selected .timeline-cell-amount")
    .first();
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await expect(page.locator("h1#login-heading")).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  });
}

const enabled = process.env.ATHENA_E2E_ENABLED === "true";
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (!enabled || missing.length > 0) {
  const reason = !enabled
    ? "ATHENA_E2E_ENABLED is not true"
    : `Missing required E2E environment variables: ${missing.join(", ")}`;
  test.skip(`Financial invariants suite is disabled — ${reason}`, () => {});
} else {
  test.describe("Financial invariants", () => {
    test.setTimeout(120_000);
    test.use({ baseURL });

    const ownerAEmail = env("ATHENA_E2E_OWNER_A_EMAIL");
    const ownerAPassword = env("ATHENA_E2E_OWNER_A_PASSWORD");
    const ownerBEmail = env("ATHENA_E2E_OWNER_B_EMAIL");
    const ownerBPassword = env("ATHENA_E2E_OWNER_B_PASSWORD");

    const ownerAMain = env("ATHENA_E2E_OWNER_A_MAIN_ACCOUNT");
    const ownerAMainBalance = env("ATHENA_E2E_OWNER_A_MAIN_BALANCE");
    const ownerBMain = env("ATHENA_E2E_OWNER_B_MAIN_ACCOUNT");
    const ownerBMainBalance = env("ATHENA_E2E_OWNER_B_MAIN_BALANCE");

    const mutationAccount = env("ATHENA_E2E_MUTATION_ACCOUNT_NAME");
    const mutationAmount = env("ATHENA_E2E_MUTATION_AMOUNT");
    const mutationDisplay = env("ATHENA_E2E_MUTATION_DISPLAY");

    const transactionDescription = env("ATHENA_E2E_TRANSACTION_DESCRIPTION");
    const transactionAmount = env("ATHENA_E2E_TRANSACTION_AMOUNT");
    const transactionDisplay = env("ATHENA_E2E_TRANSACTION_DISPLAY");

    test("owner scope on /accounts and /cash-flow never crosses owners", async ({
      browser,
    }) => {
      const aContext = await browser.newContext({ baseURL });
      const aPage = await aContext.newPage();
      await login(aPage, ownerAEmail, ownerAPassword);

      // Owner A sees their own account on /accounts, never owner B's.
      await aPage.goto("/accounts");
      await expect(aPage.getByText(ownerAMain).first()).toBeVisible();
      await expect(aPage.getByText(ownerAMainBalance).first()).toBeVisible();
      await expect(aPage.getByText(ownerBMain)).toHaveCount(0);
      await expect(aPage.getByText(ownerBMainBalance)).toHaveCount(0);

      // Owner A sees their own account on /cash-flow, never owner B's.
      await aPage.goto("/cash-flow");
      await expect(aPage.getByText(ownerAMain).first()).toBeVisible();
      await expect(aPage.getByText(ownerBMain)).toHaveCount(0);

      await aContext.close();

      const bContext = await browser.newContext({ baseURL });
      const bPage = await bContext.newPage();
      await login(bPage, ownerBEmail, ownerBPassword);

      // Owner B sees their own account on /accounts, never owner A's.
      await bPage.goto("/accounts");
      await expect(bPage.getByText(ownerBMain).first()).toBeVisible();
      await expect(bPage.getByText(ownerBMainBalance).first()).toBeVisible();
      await expect(bPage.getByText(ownerAMain)).toHaveCount(0);
      await expect(bPage.getByText(ownerAMainBalance)).toHaveCount(0);

      // Owner B sees their own account on /cash-flow, never owner A's.
      await bPage.goto("/cash-flow");
      await expect(bPage.getByText(ownerBMain).first()).toBeVisible();
      await expect(bPage.getByText(ownerAMain)).toHaveCount(0);

      await bContext.close();
    });

    test("integer-minor-unit money mutation renders exactly and preserves Actual rows", async ({
      browser,
    }) => {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();

      try {
        // 1. Sign in as owner A and navigate to the /accounts form.
        await login(page, ownerAEmail, ownerAPassword);
        await page.goto("/accounts");
        await page
          .getByRole("button", { name: "Add account" })
          .click({ timeout: 5_000 });

        // 2. Create a new account with a decimal initial balance and set it
        //    to "actual" so it becomes an Actual row on the timeline.
        const accountForm = page.locator("form.account-form");
        await accountForm.locator('input[name="name"]').fill(mutationAccount);
        await accountForm
          .locator('input[name="institutionName"]')
          .fill("Playwright Test Bank");
        await accountForm
          .locator('input[name="initialBalance"]')
          .fill(mutationAmount);
        await accountForm
          .locator('select[name="initialStatus"]')
          .selectOption("actual");
        await accountForm.locator("button.account-form-add-button").click();

        await expect(page.locator("span.account-row-name").filter({
          hasText: mutationAccount,
        })).toBeVisible();

        // 3. Assert the integer-minor-unit balance renders as the exact
        //    expected decimal string.
        const newAccountCell = accountBalanceCell(page, mutationAccount);
        await expect(newAccountCell).toHaveText(mutationDisplay);

        // 4. Capture the main account's pre-existing Actual balance marker.
        const mainAccountCell = accountBalanceCell(page, ownerAMain);
        await expect(mainAccountCell).toHaveText(ownerAMainBalance);

        // 5. Add a planned transaction on /cash-flow.
        await page.goto("/cash-flow");
        await page
          .getByRole("button", {
            name: `Add transaction to ${ownerAMain}`,
          })
          .click();

        const dialog = page.getByRole("dialog", { name: /Add to/ });
        await expect(dialog).toBeVisible();
        await dialog.locator('input[name="description"]').fill(
          transactionDescription,
        );
        await dialog.locator('input[name="amount"]').fill(transactionAmount);
        await dialog.getByRole("button", { name: "Add transaction" }).click();

        const transactionRow = page
          .locator("div.cash-flow-item-row", {
            hasText: transactionDescription,
          })
          .first();
        await expect(transactionRow).toBeVisible();
        await expect(transactionRow).toContainText(transactionDisplay);

        // 6. The planned /cash-flow transaction must not have overwritten the
        //    Actual row. Return to /accounts and assert both the new Actual
        //    balance and the main account's Actual balance remain exactly.
        await page.goto("/accounts");
        await expect(accountBalanceCell(page, ownerAMain)).toHaveText(
          ownerAMainBalance,
        );
        await expect(accountBalanceCell(page, mutationAccount)).toHaveText(
          mutationDisplay,
        );
      } finally {
        await context.close();
      }
    });
  });
}
