import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { InventoryPage } from '../pages/inventory.page';

test.describe('LoginTest', () => {
  let loginPage: LoginPage;
  let inventoryPage: InventoryPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    inventoryPage = new InventoryPage(page);
  });

  /**
   * Two representative Selenium+TestNG login flows against
   * https://www.saucedemo.com — a stable public demo site used across the
   * industry for tool evaluation. The tests are intentionally small so the
   * sel2pw conversion output is easy to inspect end-to-end.
   * 
   * The functional-equivalence claim: sel2pw converts these tests to a
   * Playwright TypeScript scaffold, and after the small documented manual
   * cleanup pass, the converted tests still pass the same assertions against
   * the same target site.
   */
  test("Valid login lands on the inventory page", async ({ page }) => {
    await loginPage.open();
    await loginPage.loginAs("standard_user", "secret_sauce");

    expect(await inventoryPage.getPageTitle()).toBe("Products");
    expect(await inventoryPage.isInventoryVisible()).toBe(true);
    expect(await inventoryPage.isCartVisible()).toBe(true);
  });

  test("Locked-out account shows an error message", async ({ page }) => {
    await loginPage.open();
    await loginPage.loginAs("locked_out_user", "secret_sauce");

    const error = await loginPage.getErrorMessage();
    expect(error.includes("locked out")).toBe(true);
  });

});
