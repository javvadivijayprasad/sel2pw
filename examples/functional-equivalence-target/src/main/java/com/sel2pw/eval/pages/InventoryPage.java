package com.sel2pw.eval.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;

/**
 * Page object for the Sauce Labs demo inventory (post-login landing) page.
 */
public class InventoryPage {

    private final WebDriver driver;

    @FindBy(css = ".title")
    private WebElement pageTitle;

    @FindBy(css = ".inventory_item")
    private WebElement firstInventoryItem;

    @FindBy(id = "shopping_cart_container")
    private WebElement cartLink;

    public InventoryPage(WebDriver driver) {
        this.driver = driver;
        PageFactory.initElements(driver, this);
    }

    public String getPageTitle() {
        return pageTitle.getText();
    }

    public boolean isInventoryVisible() {
        return firstInventoryItem.isDisplayed();
    }

    public boolean isCartVisible() {
        return cartLink.isDisplayed();
    }
}
