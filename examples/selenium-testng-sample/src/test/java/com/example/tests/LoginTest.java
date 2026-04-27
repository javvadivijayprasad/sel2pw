package com.example.tests;

import com.example.base.BaseTest;
import com.example.pages.HomePage;
import com.example.pages.LoginPage;
import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

public class LoginTest extends BaseTest {

    private LoginPage loginPage;
    private HomePage homePage;

    @BeforeMethod
    public void setUpPages() {
        loginPage = new LoginPage(driver);
        homePage = new HomePage(driver);
        loginPage.open("https://example.com");
    }

    @Test(description = "valid credentials log the user in", groups = {"smoke"})
    public void validLogin() {
        loginPage.login("alice", "correct-horse");
        String welcome = homePage.getWelcomeText();
        Assert.assertEquals(welcome, "Welcome, alice!");
        Assert.assertTrue(homePage.isLogoutVisible());
    }

    @Test(description = "invalid credentials show an error")
    public void invalidLogin() {
        loginPage.login("alice", "wrong-password");
        String error = loginPage.getErrorMessage();
        Assert.assertEquals(error, "Invalid username or password");
    }

    @Test(description = "search after login works")
    public void searchAfterLogin() {
        loginPage.login("alice", "correct-horse");
        homePage.search("playwright migration");
        Assert.assertTrue(homePage.isLogoutVisible());
    }
}
