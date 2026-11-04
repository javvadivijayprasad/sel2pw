import { describe, it, expect } from "vitest";
import { emitFixture } from "../../src/transformers/baseTestExtractor";
import { transformMethodBody } from "../../src/transformers/bodyTransformer";
import { JavaFile } from "../../src/types";

const baseTestSource = `package com.example.base;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;

public class BaseTest {
    protected WebDriver driver;

    @BeforeMethod
    public void setUp() {
        driver = new ChromeDriver();
        driver.manage().window().maximize();
    }

    @AfterMethod
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
}
`;

describe("BaseTest fixture emission", () => {
  it("strips a braced driver null guard without leaving its closing brace", () => {
    const file: JavaFile = {
      path: "/repo/src/test/java/com/example/base/BaseTest.java",
      relPath: "src/test/java/com/example/base/BaseTest.java",
      packageName: "com.example.base",
      className: "BaseTest",
      source: baseTestSource,
      kind: "base",
    };

    const { converted } = emitFixture(file);
    expect(converted.source).not.toContain("driver.quit");
    expect(countChar(converted.source, "{")).toBe(countChar(converted.source, "}"));
  });
});

describe("body transformer driver boilerplate", () => {
  it("removes a braced driver null guard as one block", () => {
    const { body } = transformMethodBody(
      "if (driver != null) {\n    driver.quit();\n}",
      "Test.java",
    );
    expect(body.trim()).toBe("");
  });
});

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
}
