package com.example;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;

/**
 * PageFactory-style page object — annotations on fields instead of
 * explicit By locators. Common in older Selenium codebases.
 */
public class PageFactoryLoginPage {
    @FindBy(id = "username")
    private WebElement usernameInput;

    @FindBy(id = "password")
    private WebElement passwordInput;

    @FindBy(css = "button[type='submit']")
    private WebElement loginButton;

    @FindBy(xpath = "//div[@class='error']")
    private WebElement errorBanner;

    public PageFactoryLoginPage(WebDriver driver) {
        PageFactory.initElements(driver, this);
    }

    /** Submits the login form with the given credentials. */
    public void login(String user, String pass) {
        usernameInput.sendKeys(user);
        passwordInput.sendKeys(pass);
        loginButton.click();
    }

    public String errorMessage() {
        return errorBanner.getText();
    }
}
