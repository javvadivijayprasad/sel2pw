package com.example.steps;

import io.cucumber.java.en.Given;
import io.cucumber.java.en.When;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.And;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.testng.Assert;

public class LoginSteps {
    private WebDriver driver;

    @Given("the user is on the login page")
    public void onLoginPage() {
        driver.get("https://example.com/login");
    }

    @When("they enter username {string} and password {string}")
    public void enterCredentials(String user, String pass) {
        driver.findElement(By.id("username")).sendKeys(user);
        driver.findElement(By.id("password")).sendKeys(pass);
    }

    @And("they click the sign-in button")
    public void clickSignIn() {
        driver.findElement(By.cssSelector("button[type='submit']")).click();
    }

    @Then("they should see the welcome banner")
    public void seeWelcomeBanner() {
        String text = driver.findElement(By.id("welcome")).getText();
        Assert.assertTrue(text.contains("Welcome"));
    }

    @Then("they should see the error message {string}")
    public void seeErrorMessage(String expected) {
        String actual = driver.findElement(By.xpath("//div[@class='error']")).getText();
        Assert.assertEquals(actual, expected);
    }
}
