package com.sel2pw.eval;

import com.sel2pw.eval.pages.InventoryPage;
import com.sel2pw.eval.pages.LoginPage;
import org.testng.Assert;
import org.testng.annotations.Test;

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
public class LoginTest extends BaseTest {

    @Test(description = "Valid login lands on the inventory page")
    public void validLoginLandsOnInventory() {
        LoginPage loginPage = new LoginPage(driver);
        loginPage.open();
        loginPage.loginAs("standard_user", "secret_sauce");

        InventoryPage inventoryPage = new InventoryPage(driver);
        Assert.assertEquals(inventoryPage.getPageTitle(), "Products");
        Assert.assertTrue(inventoryPage.isInventoryVisible());
        Assert.assertTrue(inventoryPage.isCartVisible());
    }

    @Test(description = "Locked-out account shows an error message")
    public void lockedOutUserSeesError() {
        LoginPage loginPage = new LoginPage(driver);
        loginPage.open();
        loginPage.loginAs("locked_out_user", "secret_sauce");

        String error = loginPage.getErrorMessage();
        Assert.assertTrue(error.contains("locked out"));
    }
}
