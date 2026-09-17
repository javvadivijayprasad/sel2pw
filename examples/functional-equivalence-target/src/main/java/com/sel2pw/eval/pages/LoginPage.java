package com.sel2pw.eval.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;

/**
 * Page object for the Sauce Labs demo login page at https://www.saucedemo.com.
 *
 * Locators verified stable against saucedemo.com as of September 2026.
 * The site publishes accepted credentials on the login page itself:
 *   standard_user / secret_sauce  — succeeds
 *   locked_out_user / secret_sauce — blocked (for negative tests)
 */
public class LoginPage {

    private final WebDriver driver;

    @FindBy(id = "user-name")
    private WebElement usernameInput;

    @FindBy(id = "password")
    private WebElement passwordInput;

    @FindBy(id = "login-button")
    private WebElement loginButton;

    @FindBy(css = "[data-test='error']")
    private WebElement errorMessage;

    public LoginPage(WebDriver driver) {
        this.driver = driver;
        PageFactory.initElements(driver, this);
    }

    public void open() {
        driver.get("https://www.saucedemo.com/");
    }

    public void enterUsername(String username) {
        usernameInput.sendKeys(username);
    }

    public void enterPassword(String password) {
        passwordInput.sendKeys(password);
    }

    public void clickLogin() {
        loginButton.click();
    }

    public String getErrorMessage() {
        return errorMessage.getText();
    }

    public void loginAs(String username, String password) {
        enterUsername(username);
        enterPassword(password);
        clickLogin();
    }
}
