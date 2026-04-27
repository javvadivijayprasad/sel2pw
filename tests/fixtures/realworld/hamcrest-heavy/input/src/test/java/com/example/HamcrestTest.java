package com.example;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

import java.util.List;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.*;

/**
 * Test class that leans heavily on Hamcrest matchers — a real-world shape
 * in JUnit + Selenium codebases. Exercises the hamcrestMap transformer.
 */
public class HamcrestTest {
    private WebDriver driver;

    @BeforeMethod
    public void setUp() {
        // Driver creation usually lives in BaseTest; inlined here for test isolation.
    }

    @AfterMethod
    public void tearDown() {
        if (driver != null) driver.quit();
    }

    @Test
    public void homePageContainsExpectedItems() {
        driver.get("https://example.com");
        List<String> items = driver.findElements(By.cssSelector(".nav-item"))
                .stream().map(e -> e.getText()).toList();

        assertThat(items, hasItem("Home"));
        assertThat(items, containsInAnyOrder("Home", "About", "Pricing"));
        assertThat(items, hasSize(3));
        assertThat(items, not(empty()));
    }

    @Test
    public void titleIsCaseInsensitive() {
        driver.get("https://example.com");
        String title = driver.getTitle();
        assertThat(title, equalToIgnoringCase("Example Domain"));
        assertThat(title, containsString("Example"));
        assertThat(title, startsWith("Example"));
    }

    @Test
    public void revenueIsAboveThreshold() {
        long revenue = 12_500L;
        assertThat(revenue, greaterThan(10_000L));
        assertThat(revenue, lessThanOrEqualTo(20_000L));
        assertThat(revenue, is(notNullValue()));
    }
}
