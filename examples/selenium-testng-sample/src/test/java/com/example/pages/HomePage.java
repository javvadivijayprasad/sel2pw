package com.example.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;

public class HomePage {
    private WebDriver driver;

    private By welcomeBanner = By.id("welcome");
    private By logoutLink = By.linkText("Sign out");
    private By searchInput = By.name("q");

    public HomePage(WebDriver driver) {
        this.driver = driver;
    }

    public String getWelcomeText() {
        return driver.findElement(welcomeBanner).getText();
    }

    public boolean isLogoutVisible() {
        return driver.findElement(logoutLink).isDisplayed();
    }

    public void search(String query) {
        driver.findElement(searchInput).clear();
        driver.findElement(searchInput).sendKeys(query);
    }

    public void logout() {
        driver.findElement(logoutLink).click();
    }
}
