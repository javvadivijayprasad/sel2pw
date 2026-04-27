import { describe, it, expect } from "vitest";
import { applyApiRewrites } from "../../src/transformers/apiMap";

describe("applyApiRewrites", () => {
  it("rewrites driver.get(url) -> page.goto(url)", () => {
    const { body } = applyApiRewrites('driver.get("https://example.com");');
    expect(body).toBe('await this.page.goto("https://example.com");');
  });

  it("rewrites driver.navigate().to/back/forward/refresh", () => {
    const a = applyApiRewrites('driver.navigate().to("https://x");').body;
    const b = applyApiRewrites("driver.navigate().back();").body;
    const c = applyApiRewrites("driver.navigate().forward();").body;
    const d = applyApiRewrites("driver.navigate().refresh();").body;
    expect(a).toContain("page.goto");
    expect(b).toContain("page.goBack");
    expect(c).toContain("page.goForward");
    expect(d).toContain("page.reload");
  });

  it("rewrites driver.getTitle / getCurrentUrl", () => {
    expect(applyApiRewrites("driver.getTitle()").body).toContain("page.title()");
    expect(applyApiRewrites("driver.getCurrentUrl()").body).toContain("page.url()");
  });

  it("annotates driver.quit() and driver.close()", () => {
    const q = applyApiRewrites("driver.quit();").body;
    expect(q).toContain("driver.quit() — handled by Playwright fixture");
    expect(applyApiRewrites("driver.close();").body).toContain("page.close()");
  });

  it("rewrites WebElement actions on this.<field>", () => {
    expect(applyApiRewrites("this.loginBtn.click();").body).toBe(
      "await this.loginBtn.click();",
    );
    expect(applyApiRewrites('this.userInput.sendKeys("alice");').body).toBe(
      'await this.userInput.fill("alice");',
    );
    expect(applyApiRewrites("this.userInput.clear();").body).toBe(
      "await this.userInput.clear();",
    );
    expect(applyApiRewrites("this.banner.getText()").body).toBe(
      "await this.banner.innerText()",
    );
    expect(applyApiRewrites("this.banner.isDisplayed()").body).toBe(
      "await this.banner.isVisible()",
    );
    expect(applyApiRewrites("this.banner.isEnabled()").body).toBe(
      "await this.banner.isEnabled()",
    );
    expect(applyApiRewrites('this.elt.getAttribute("href")').body).toBe(
      'await this.elt.getAttribute("href")',
    );
  });

  it("isSelected -> isChecked with note for review", () => {
    const r = applyApiRewrites("this.box.isSelected()");
    expect(r.body).toContain("isChecked");
    expect(r.notes.join(" ")).toMatch(/isSelected/);
  });

  it("removes WebDriverWait().until() with note", () => {
    const r = applyApiRewrites(
      "new WebDriverWait(driver, 10).until(ExpectedConditions.elementToBeClickable(by));",
    );
    expect(r.body).toContain("removed: explicit wait");
    expect(r.notes.join(" ")).toMatch(/auto-waits/);
  });

  it("Thread.sleep -> waitForTimeout with note", () => {
    const r = applyApiRewrites("Thread.sleep(2000);");
    expect(r.body).toContain("waitForTimeout(2000)");
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("declares Java primitives as const", () => {
    expect(applyApiRewrites("String name = doIt();").body).toBe(
      "const name = doIt();",
    );
    expect(applyApiRewrites("int n = 1;").body).toBe("const n = 1;");
    expect(applyApiRewrites("boolean ok = true;").body).toBe("const ok = true;");
  });

  it("does NOT rewrite something that just contains the substring", () => {
    // negative — `notDriver.get(...)` shouldn't trigger driver.get rewrite
    const { body } = applyApiRewrites('notDriver.get("x");');
    expect(body).toBe('notDriver.get("x");');
  });
});
