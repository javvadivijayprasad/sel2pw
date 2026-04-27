import { describe, it, expect } from "vitest";
import { toPlaywrightLocatorExpr } from "../../src/transformers/locatorMapper";

describe("toPlaywrightLocatorExpr", () => {
  it("By.id -> page.locator('#…')", () => {
    expect(toPlaywrightLocatorExpr("id", "username", "page")).toBe(
      'page.locator("#username")',
    );
  });

  it("By.cssSelector -> page.locator('…')", () => {
    expect(toPlaywrightLocatorExpr("css", "button.primary", "page")).toBe(
      'page.locator("button.primary")',
    );
  });

  it("By.xpath -> page.locator('xpath=…')", () => {
    expect(toPlaywrightLocatorExpr("xpath", "//div[@class='x']", "page")).toBe(
      'page.locator("xpath=//div[@class=\'x\']")',
    );
  });

  it("By.linkText -> page.getByRole('link', …)", () => {
    expect(toPlaywrightLocatorExpr("linkText", "Sign out", "page")).toBe(
      "page.getByRole('link', { name: \"Sign out\" })",
    );
  });

  it("By.partialLinkText -> getByRole exact:false", () => {
    expect(toPlaywrightLocatorExpr("partialLinkText", "Sign", "page")).toContain(
      "exact: false",
    );
  });

  it("By.name -> [name=…]", () => {
    expect(toPlaywrightLocatorExpr("name", "q", "page")).toContain('[name=');
  });

  it("By.className -> .<class>", () => {
    expect(toPlaywrightLocatorExpr("className", "primary", "page")).toBe(
      'page.locator(".primary")',
    );
  });
});
