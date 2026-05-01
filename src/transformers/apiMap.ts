/**
 * Selenium WebDriver/WebElement API → Playwright API mappings.
 *
 * Each entry is a pattern that the body transformer applies to method bodies.
 * Order matters — more specific patterns come first.
 */

export interface ApiRewrite {
  /** Regex applied per-line (or sometimes across lines). */
  pattern: RegExp;
  /** Replacement string. Capture groups available as $1, $2 ... */
  replacement: string;
  /** Human description used in review report when this pattern fires. */
  note?: string;
}

export const API_REWRITES: ApiRewrite[] = [
  // ----- Driver navigation -----
  {
    pattern: /\bdriver\.get\s*\(\s*([^)]+)\)\s*;/g,
    replacement: "await this.page.goto($1);",
  },
  {
    pattern: /\bdriver\.navigate\(\)\.to\s*\(\s*([^)]+)\)\s*;/g,
    replacement: "await this.page.goto($1);",
  },
  {
    pattern: /\bdriver\.navigate\(\)\.back\s*\(\s*\)\s*;/g,
    replacement: "await this.page.goBack();",
  },
  {
    pattern: /\bdriver\.navigate\(\)\.forward\s*\(\s*\)\s*;/g,
    replacement: "await this.page.goForward();",
  },
  {
    pattern: /\bdriver\.navigate\(\)\.refresh\s*\(\s*\)\s*;/g,
    replacement: "await this.page.reload();",
  },
  {
    pattern: /\bdriver\.getTitle\s*\(\s*\)/g,
    replacement: "await this.page.title()",
  },
  {
    pattern: /\bdriver\.getCurrentUrl\s*\(\s*\)/g,
    replacement: "this.page.url()",
  },
  {
    pattern: /\bdriver\.quit\s*\(\s*\)\s*;/g,
    replacement: "// driver.quit() — handled by Playwright fixture",
  },
  {
    pattern: /\bdriver\.close\s*\(\s*\)\s*;/g,
    replacement: "await this.page.close();",
  },

  // ----- findElement chained calls (locator field-based code shouldn't hit these often) -----
  {
    pattern: /\bdriver\.findElement\s*\(\s*By\.id\s*\(\s*("[^"]*")\s*\)\s*\)/g,
    replacement: `this.page.locator("#" + $1.replace(/^"|"$/g, ""))`,
    note: "driver.findElement(By.id) → page.locator('#…') — review string interpolation",
  },
  {
    pattern: /\bdriver\.findElement\s*\(\s*By\.cssSelector\s*\(\s*("[^"]*")\s*\)\s*\)/g,
    replacement: "this.page.locator($1)",
  },
  {
    pattern: /\bdriver\.findElement\s*\(\s*By\.xpath\s*\(\s*("[^"]*")\s*\)\s*\)/g,
    replacement: `this.page.locator("xpath=" + $1.replace(/^"|"$/g, ""))`,
  },
  // Bare-field reference: driver.findElement(usernameInput) → this.usernameInput
  // (where `usernameInput` is a Locator field on the same Page Object).
  // Lower precedence than the By.* rules above — those match the explicit
  // selector strings and would never overlap with this generic pattern.
  {
    pattern: /\bdriver\.findElement\s*\(\s*(\w+)\s*\)/g,
    replacement: "this.$1",
  },
  // Plural variants: driver.findElements(...) → page.locator(...).all().
  // Note: callers using .stream().map(...) on the result need a `for` loop
  // or Promise.all in TS; the body transform leaves that as-is and surfaces
  // a review note when it spots `.stream()`. Keeping the .locator() chain
  // keeps the rewrite local — only the surface call site changes.
  {
    pattern: /\bdriver\.findElements\s*\(\s*By\.cssSelector\s*\(\s*("[^"]*")\s*\)\s*\)/g,
    replacement: "await this.page.locator($1).all()",
  },
  {
    pattern: /\bdriver\.findElements\s*\(\s*By\.id\s*\(\s*("[^"]*")\s*\)\s*\)/g,
    replacement: `await this.page.locator("#" + $1.replace(/^"|"$/g, "")).all()`,
  },
  {
    pattern: /\bdriver\.findElements\s*\(\s*By\.xpath\s*\(\s*("[^"]*")\s*\)\s*\)/g,
    replacement: `await this.page.locator("xpath=" + $1.replace(/^"|"$/g, "")).all()`,
  },
  {
    pattern: /\bdriver\.findElements\s*\(\s*(\w+)\s*\)/g,
    replacement: "await this.$1.all()",
  },

  // ----- WebElement actions (called on a Locator field) -----
  // .click()
  {
    pattern: /\b(this\.\w+|\w+)\.click\s*\(\s*\)\s*;/g,
    replacement: "await $1.click();",
  },
  // .sendKeys("...") -> .fill(...)
  {
    pattern: /\b(this\.\w+|\w+)\.sendKeys\s*\(\s*([^)]+)\s*\)\s*;/g,
    replacement: "await $1.fill($2);",
  },
  // .clear()
  {
    pattern: /\b(this\.\w+|\w+)\.clear\s*\(\s*\)\s*;/g,
    replacement: "await $1.clear();",
  },
  // .submit()
  {
    pattern: /\b(this\.\w+|\w+)\.submit\s*\(\s*\)\s*;/g,
    replacement: "await $1.press('Enter');",
    note: "WebElement.submit() → press('Enter'); confirm form behaviour matches",
  },
  // .getText()
  {
    pattern: /\b(this\.\w+|\w+)\.getText\s*\(\s*\)/g,
    replacement: "await $1.innerText()",
  },
  // .getAttribute("...")
  {
    pattern: /\b(this\.\w+|\w+)\.getAttribute\s*\(\s*([^)]+)\s*\)/g,
    replacement: "await $1.getAttribute($2)",
  },
  // .isDisplayed()
  {
    pattern: /\b(this\.\w+|\w+)\.isDisplayed\s*\(\s*\)/g,
    replacement: "await $1.isVisible()",
  },
  // .isEnabled()
  {
    pattern: /\b(this\.\w+|\w+)\.isEnabled\s*\(\s*\)/g,
    replacement: "await $1.isEnabled()",
  },
  // .isSelected()
  {
    pattern: /\b(this\.\w+|\w+)\.isSelected\s*\(\s*\)/g,
    replacement: "await $1.isChecked()",
    note: "WebElement.isSelected() mapped to isChecked(); for non-checkbox elements review the assertion",
  },

  // ----- Waits — Playwright auto-waits, so most explicit waits become unnecessary. -----
  {
    // Both arg lists allow up to 3 levels of nested parens so calls like
    // `until(ExpectedConditions.visibilityOfElementLocated(By.xpath("…")))` match.
    pattern:
      /\bnew\s+WebDriverWait\s*\((?:[^()]|\([^()]*\))*\)\.until\s*\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*\)\s*;/g,
    replacement: "// removed: explicit wait — Playwright auto-waits on locators",
    note: "WebDriverWait removed (Playwright auto-waits). If a specific assertion was needed, add expect(locator).toBeVisible() etc.",
  },
  {
    // Field-style `wait.until(...)` — same intent as above, different shape.
    // Common when WebDriverWait is stored as a field on BaseTest.
    // Allows up to 3 levels of nested parens, which covers the typical
    // shape `wait.until(ExpectedConditions.visibilityOfElementLocated(By.xpath("…")))`.
    pattern:
      /\bwait\.until\s*\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*\)\s*;/g,
    replacement: "// removed: wait.until — Playwright auto-waits on locators",
    note: "Field-style wait.until() removed (Playwright auto-waits). For specific assertions, add expect(locator).toBeVisible() etc.",
  },
  {
    // Thread.sleep is almost always a Selenium-era hack — "I don't know why
    // this is flaky, waiting N ms fixes it." Playwright's auto-waits usually
    // eliminate the underlying timing issue, so the converted waitForTimeout
    // is often dead code that just slows down the test. We convert literally
    // (preserves behavior) but attach a TODO marker so the user remembers
    // to verify whether each one is actually needed. v0.11.1.
    pattern: /Thread\.sleep\s*\(\s*(\d+)\s*\)\s*;/g,
    replacement:
      "// TODO(sel2pw): Playwright auto-waits on the next action — this waitForTimeout is often unnecessary. Verify behavior; remove if redundant.\n    await this.page.waitForTimeout($1);",
    note: "Thread.sleep() → page.waitForTimeout(). Each one is flagged with a TODO — Playwright's auto-wait usually makes these redundant; verify and remove where possible.",
  },

  // ----- Java keywords / minor cleanups -----
  // Local Java declarations of user-defined types:
  //   HomePage homePage = new HomePage(driver, wait);
  //     → const homePage = new HomePage(driver, wait);
  // The backreference \1 ensures the type name on both sides matches —
  // avoids accidentally rewriting unrelated assignments.
  // We run this BEFORE the constructor-args rewrite below so the args end up
  // already cleaned (driver, wait → page).
  { pattern: /\b([A-Z]\w*)\s+(\w+)\s*=\s*new\s+\1\s*\(/g, replacement: "const $2 = new $1(" },
  // Page Object constructors: new XxxPage(driver, wait) → new XxxPage(page).
  // Selenium-style POMs take (driver) or (driver, wait); Playwright POMs take
  // (page). Inside an `async ({ page }) => { ... }` test body, `page` is the
  // fixture-provided variable.
  { pattern: /\bnew\s+(\w+Page)\s*\([^)]*\)/g, replacement: "new $1(page)" },
  { pattern: /\bString\s+(\w+)\s*=/g, replacement: "const $1 =" },
  { pattern: /\bint\s+(\w+)\s*=/g, replacement: "const $1 =" },
  { pattern: /\blong\s+(\w+)\s*=/g, replacement: "const $1 =" },
  { pattern: /\bdouble\s+(\w+)\s*=/g, replacement: "const $1 =" },
  { pattern: /\bfloat\s+(\w+)\s*=/g, replacement: "const $1 =" },
  { pattern: /\bboolean\s+(\w+)\s*=/g, replacement: "const $1 =" },
  // Generic-typed declarations: List<String>, Map<String, Foo>, ArrayList<X>, etc.
  // Match the type prefix conservatively (uppercase first char + balanced angle brackets
  // up to one level of nesting) and drop it. The TS side is happy with `const x = …`.
  {
    pattern: /\b(?:List|ArrayList|LinkedList|Set|HashSet|Map|HashMap|LinkedHashMap|Collection|Iterable|Optional)\s*<[^<>]*(?:<[^<>]*>[^<>]*)?>\s+(\w+)\s*=/g,
    replacement: "const $1 =",
  },
  // Numeric literals with Java type suffixes — drop the suffix.
  // 12_500L → 12_500, 3.14f → 3.14, etc. (TS supports underscore separators in numerics.)
  { pattern: /\b(\d[\d_]*)[Ll]\b/g, replacement: "$1" },
  { pattern: /\b(\d[\d_]*\.\d+)[fFdD]\b/g, replacement: "$1" },
];

/** Apply all rewrites in order. Returns rewritten body + notes that fired. */
export function applyApiRewrites(body: string): {
  body: string;
  notes: string[];
} {
  const notes: string[] = [];
  let out = body;
  for (const r of API_REWRITES) {
    if (r.pattern.test(out) && r.note) notes.push(r.note);
    // Reset lastIndex since regex literals with /g are stateful per-call
    out = out.replace(r.pattern, r.replacement);
  }
  return { body: out, notes };
}
