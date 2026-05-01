import { ReviewItem } from "../types";

/**
 * Java standard-library idiom rewrites.
 *
 * Where `apiMap` handles Selenium → Playwright (driver/element/locator API)
 * and `advancedApiMap` handles the Selenium long-tail (Actions, JS execute,
 * iframe, alert, cookies, file upload, multi-window), this module covers
 * the **Java standard library** patterns that compile in Java but break in
 * TypeScript without rewriting.
 *
 * Order of application (matters):
 *   1) Custom-helper call sites (`clickElement(el)` → `await el.click()`)
 *      so subsequent passes see the rewritten Playwright primitives.
 *   2) Select-dropdown idiom (`new Select(el).selectByVisibleText(x)`).
 *   3) Java type-position rewrites in declarations (`String[]` → `string[]`,
 *      `WebElement` → `Locator`, `List<WebElement>` → `Locator`).
 *   4) Java collection-method calls (`.size()` → `.length`/`.count()`,
 *      `.get(i)` → `[i]`/`.nth(i)`, `.add` / `.remove` / `.put` / etc).
 *   5) Java string-method calls (`.length()` → `.length`, `.contains` →
 *      `.includes`, `.equalsIgnoreCase`, etc).
 *   6) Java exception-instance methods (`e.getMessage()` →
 *      `(e as Error).message`).
 *   7) Numeric parsers (`Integer.parseInt`, `String.valueOf`).
 *
 * Each rewrite is a regex over the body string. The regexes are deliberately
 * conservative — patterns that could generate ambiguous TS get a
 * `// TODO(sel2pw): verify` marker rather than a confident rewrite.
 */

export interface IdiomMapResult {
  body: string;
  warnings: ReviewItem[];
}

export function applyJavaIdiomRewrites(
  raw: string,
  filePath: string,
): IdiomMapResult {
  const warnings: ReviewItem[] = [];
  let body = raw;

  // ============================================================
  // -3) Chained <expr>.sendKeys / .getText / .clear (v0.11.3 Patch W)
  // ============================================================
  // apiMap's rules anchor on `<word>.sendKeys` (single bare or this.field
  // identifier). Real-world code chains: `someExpr().sendKeys(x)`,
  // `this.page.locator(x).sendKeys(y)`, `el.findElement(by).getText()`.
  // Catch the chain forms here (post-apiMap) so they convert too.

  // <chain>.sendKeys(<expr>) → await <chain>.fill(<expr>)
  // The `(?<!await\s)` prevents double-awaiting if apiMap already caught
  // the simple case.
  body = body.replace(
    /(?<!await\s)([\w.]+\([^)]*\)|[\w.]+(?:\([^)]*\))*)\.sendKeys\s*\(\s*((?:[^)(]|\([^)(]*\))+)\s*\)\s*;/g,
    "await $1.fill($2);",
  );
  // <chain>.getText() → await <chain>.innerText()
  body = body.replace(
    /(?<!await\s)([\w.]+\([^)]*\)|[\w.]+(?:\([^)]*\))*)\.getText\s*\(\s*\)/g,
    "await $1.innerText()",
  );
  // <chain>.click() with await prefix
  body = body.replace(
    /(?<!await\s)([\w.]+\([^)]*\))\.click\s*\(\s*\)\s*;/g,
    "await $1.click();",
  );

  // ============================================================
  // -2) WebDriverWait + ExpectedConditions chains (v0.11.3 Patch V)
  // ============================================================
  // These can appear ANYWHERE — Page Object methods, test bodies, helper
  // classes — not just BaseTest fixtures (where Patch J already strips
  // them). When found inside a method body, replace the whole chain with
  // a `// TODO(sel2pw)` comment so the user knows to use Playwright
  // auto-waits / `expect().toBeVisible()` instead.

  // `const wait = new WebDriverWait(<anything-with-nested-parens>, <args>);` → comment
  // Patch Y: argument matcher allows TWO levels of nested parens so calls
  // like `new WebDriverWait(this.page, Duration.ofSeconds(30))` match.
  // Replacement uses plain quotes (no backticks) to avoid Patch U
  // protect-and-restore drama in pageObjectEmitter.
  body = body.replace(
    /(?:const|let|var|final)?\s*\w+\s*=\s*new\s+WebDriverWait\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*;?/g,
    "// TODO(sel2pw): WebDriverWait removed - Playwright auto-waits handle visibility/clickability. Use 'await expect(locator).toBeVisible()' or locator.waitFor() for specific assertions.",
  );
  // Bare `new WebDriverWait(...)` (assigned to a chain or used inline)
  body = body.replace(
    /\bnew\s+WebDriverWait\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g,
    "/* WebDriverWait removed */",
  );
  // `wait.until(ExpectedConditions.X(...))` chains — rewrite to
  // `await locator.waitFor()` if we can identify the locator, otherwise
  // a TODO comment.
  body = body.replace(
    /\b\w+\.until\s*\(\s*ExpectedConditions\.visibilityOf(?:Element|AllElements|ElementLocated)?\s*\(\s*([^)]+?)\s*\)\s*\)\s*;?/g,
    "await $1.waitFor({ state: 'visible' });",
  );
  body = body.replace(
    /\b\w+\.until\s*\(\s*ExpectedConditions\.invisibilityOf(?:Element|ElementLocated)?\s*\(\s*([^)]+?)\s*\)\s*\)\s*;?/g,
    "await $1.waitFor({ state: 'hidden' });",
  );
  body = body.replace(
    /\b\w+\.until\s*\(\s*ExpectedConditions\.elementToBeClickable\s*\(\s*([^)]+?)\s*\)\s*\)\s*;?/g,
    "await $1.waitFor({ state: 'visible' });",
  );
  body = body.replace(
    /\b\w+\.until\s*\(\s*ExpectedConditions\.textToBePresentInElement\w*\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*\)\s*;?/g,
    "await expect($1).toHaveText($2);",
  );
  body = body.replace(
    /\b\w+\.until\s*\(\s*ExpectedConditions\.urlContains\s*\(\s*([^)]+?)\s*\)\s*\)\s*;?/g,
    "await page.waitForURL(new RegExp($1));",
  );
  // Generic catch-all for any other ExpectedConditions chain
  body = body.replace(
    /\b\w+\.until\s*\(\s*ExpectedConditions\.[\w$]+\s*\([^)]*\)\s*\)\s*;?/g,
    "// TODO(sel2pw): ExpectedConditions chain - use Playwright's auto-waits or expect(locator).<assertion>()",
  );

  // v0.11.3 Patch CC: orphan `.until(ExpectedConditions...)` chains —
  // when Patch V removed `new WebDriverWait(...)` it left a dangling
  // `.until(...)` chain that doesn't match the `<word>.until` pattern
  // above. Two shapes to catch:
  //   `/* WebDriverWait removed */\n  .until(ExpectedConditions...)`
  //   `// TODO(sel2pw): ...\n  .until(ExpectedConditions...)`
  body = body.replace(
    /(?:\/\*\s*WebDriverWait removed\s*\*\/|\/\/\s*TODO\(sel2pw\)[^\n]*WebDriverWait[^\n]*)\s*[\r\n]+\s*\.until\s*\(\s*ExpectedConditions\.\w+\s*\([^)]*\)\s*\)\s*;?/g,
    "// TODO(sel2pw): WebDriverWait + ExpectedConditions chain removed - use `await expect(locator).toBeVisible()` etc.",
  );

  // Also catch the bare orphan form `.until(...)` at the start of a line
  // (which can happen after a multi-line WebDriverWait removal)
  body = body.replace(
    /^\s*\.until\s*\(\s*ExpectedConditions\.\w+\s*\([^)]*\)\s*\)\s*;?/gm,
    "// TODO(sel2pw): orphan .until() chain - removed (Playwright auto-waits)",
  );

  // Standalone Thread.sleep(<expr>) — apiMap handles `Thread.sleep(\d+)`
  // (literal int) but real codebases use `Thread.sleep(timeoutVar)` or
  // `Thread.sleep(seconds * 1000)`. Catch the variable / expression form.
  body = body.replace(
    /\bThread\.sleep\s*\(\s*([^)]+?)\s*\)\s*;/g,
    "await page.waitForTimeout($1); // TODO(sel2pw): Playwright auto-waits often make this unnecessary",
  );

  // ============================================================
  // -1) Standalone By.X(...) → string selector (v0.11.3 Patch T)
  // ============================================================
  // When `By.id("user")` etc. appear OUTSIDE a `driver.findElement(...)`
  // wrapper (e.g. as an argument to a custom helper like
  // `BrowserUtils.waitForClickability(By.id("user"), 7)`), apiMap doesn't
  // catch them — its rules anchor on `findElement`. Translate the bare
  // By.* call to its CSS / XPath string equivalent so downstream
  // helpers (now Locator-aware after Patch B / I) receive a string.

  // By.id("x") → "#x"
  body = body.replace(/\bBy\.id\s*\(\s*"([^"]*)"\s*\)/g, '"#$1"');
  // By.id(varOrExpr) → `#${varOrExpr}` (template literal so dynamic values still work)
  body = body.replace(/\bBy\.id\s*\(\s*([^)"][^)]*?)\s*\)/g, "`#${$1}`");

  // By.name("x") → '[name="x"]'
  body = body.replace(/\bBy\.name\s*\(\s*"([^"]*)"\s*\)/g, '\'[name="$1"]\'');
  body = body.replace(/\bBy\.name\s*\(\s*([^)"][^)]*?)\s*\)/g, '`[name="${$1}"]`');

  // By.cssSelector("x") / By.css("x") → "x" (CSS is the default in
  // page.locator)
  body = body.replace(/\bBy\.(?:cssSelector|css)\s*\(\s*("[^"]*")\s*\)/g, "$1");

  // By.xpath("x") → "xpath=x"
  body = body.replace(/\bBy\.xpath\s*\(\s*"([^"]*)"\s*\)/g, '"xpath=$1"');
  // Patch X (extended in v0.11.3 patch Z): concatenated xpath strings —
  // `By.xpath("//tr[" + name + "]")` becomes a template literal. We grab
  // everything inside the outer parens. Three levels of nested-paren
  // support so XPath expressions like `//a[contains(text(),'X')]` (2
  // levels: contains, text) AND deeper ones (`//a[contains(normalize-space(text()),'X')]`)
  // are handled.
  body = body.replace(
    /\bBy\.xpath\s*\(\s*((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))+)\s*\)/g,
    (_m, expr: string) => {
      // If it's already a single quoted literal, the rule above handled it.
      if (/^"[^"]*"$/.test(expr.trim())) return _m;
      // Otherwise wrap the runtime-built xpath with the `xpath=` prefix.
      return `("xpath=" + (${expr.trim()}))`;
    },
  );

  // By.linkText("x") / By.partialLinkText("x") — best translated as a
  // CSS-like attribute selector since Playwright's getByRole would need
  // page context. We emit a literal text-matching selector.
  body = body.replace(/\bBy\.linkText\s*\(\s*"([^"]*)"\s*\)/g, '"a:has-text(\\"$1\\")"');
  body = body.replace(/\bBy\.partialLinkText\s*\(\s*"([^"]*)"\s*\)/g, '"a:has-text(\\"$1\\")"');

  // By.tagName("x") → "x" (tag selector in CSS)
  body = body.replace(/\bBy\.tagName\s*\(\s*"([^"]*)"\s*\)/g, '"$1"');

  // By.className("x") → ".x"
  body = body.replace(/\bBy\.className\s*\(\s*"([^"]*)"\s*\)/g, '".$1"');
  body = body.replace(/\bBy\.className\s*\(\s*([^)"][^)]*?)\s*\)/g, "`.${$1}`");

  // ============================================================
  // 0) Project-specific reporter wrappers (v0.11.1 Patch F)
  // ============================================================
  // Real-world Java frameworks wrap test reporting in a custom helper
  // class — `objHTMLFunctions.ReportPassFail(...)`, `Reporter.log(...)`,
  // `extentTest.log(...)`, `LogStatus.PASS`, etc. These calls have no
  // direct Playwright equivalent; they're project-specific reporting
  // layers. Convert each to a `// TODO(sel2pw)` comment so the call
  // site doesn't break the conversion but the user knows to wire to
  // Playwright's built-in reporter (or `allure-playwright`).

  // objHTMLFunctions.ReportPassFail(returnDriver(), ...) → comment
  body = body.replace(
    /\bobj\w*Functions?\.\w*(?:Report|Log|Status)\w*\s*\([^)]*(?:\([^)]*\)[^)]*)*\)\s*;/g,
    "// TODO(sel2pw): project-specific reporter call — wire to Playwright reporter (playwright.config.ts → reporter or allure-playwright)",
  );
  // Reporter.log(...) / Reporter.report(...) (TestNG Reporter API)
  body = body.replace(
    /\bReporter\.(log|report)\s*\([^)]*\)\s*;/g,
    "// TODO(sel2pw): TestNG Reporter call — replace with Playwright test.info().attach() or use allure-playwright steps",
  );
  // extentTest.log(LogStatus.PASS, "...") / extentTest.pass("...") etc.
  body = body.replace(
    /\b(?:extentTest|test)\.(log|pass|fail|info|warn|error|skip)\s*\([^)]*\)\s*;/g,
    "// TODO(sel2pw): ExtentReports call — replace with Playwright reporter or allure-playwright",
  );

  // returnDriver() / getDriver() / driverInstance() — accessors for the
  // current WebDriver. In Playwright the `page` fixture is the equivalent.
  body = body.replace(
    /\b(?:returnDriver|getDriver|getWebDriver|driverInstance|currentDriver)\s*\(\s*\)/g,
    "this.page",
  );

  // v0.11.3 Patch M: static-style Driver accessor — `Driver.get()` /
  // `Driver.getDriver()` / `DriverManager.getDriver()` etc. These wrap a
  // ThreadLocal<WebDriver> and return the current driver instance.
  // Playwright's `page` fixture is the equivalent.
  body = body.replace(
    /\b(?:Driver|DriverManager|DriverFactory|BrowserDriver|WebDriverManager|DriverPool)\s*\.\s*(?:get|getDriver|getInstance|currentDriver|driver)\s*\(\s*\)/g,
    "this.page",
  );

  // SLF4J / Logback / Log4j placeholder-style logging:
  //   logger.info("PASS {} | Expected: {}", desc, value)
  // → logger.info(`PASS ${desc} | Expected: ${value}`)
  // We rewrite for the common 1-arg and 2-arg shapes; complex multi-arg
  // calls fall through and the user can fix them.
  body = body.replace(
    /\b(logger|log)\.(info|warn|error|debug|trace)\s*\(\s*"([^"]*)"\s*,\s*([^,)]+)\s*\)\s*;/g,
    (_m, log: string, level: string, fmt: string, arg: string) => {
      const tplFmt = fmt.replace(/\{\s*\}/, `\${${arg.trim()}}`);
      return `${log}.${level}(\`${tplFmt}\`);`;
    },
  );
  body = body.replace(
    /\b(logger|log)\.(info|warn|error|debug|trace)\s*\(\s*"([^"]*)"\s*,\s*([^,)]+)\s*,\s*([^,)]+)\s*\)\s*;/g,
    (_m, log: string, level: string, fmt: string, a1: string, a2: string) => {
      let i = 0;
      const args = [a1.trim(), a2.trim()];
      const tplFmt = fmt.replace(/\{\s*\}/g, () => `\${${args[i++] ?? "unknown"}}`);
      return `${log}.${level}(\`${tplFmt}\`);`;
    },
  );
  body = body.replace(
    /\b(logger|log)\.(info|warn|error|debug|trace)\s*\(\s*"([^"]*)"\s*,\s*([^,)]+)\s*,\s*([^,)]+)\s*,\s*([^,)]+)\s*\)\s*;/g,
    (_m, log: string, level: string, fmt: string, a1: string, a2: string, a3: string) => {
      let i = 0;
      const args = [a1.trim(), a2.trim(), a3.trim()];
      const tplFmt = fmt.replace(/\{\s*\}/g, () => `\${${args[i++] ?? "unknown"}}`);
      return `${log}.${level}(\`${tplFmt}\`);`;
    },
  );

  // ============================================================
  // 1) Custom helper call sites (project-specific but very common)
  // ============================================================
  // These are conventions in TestNG-style frameworks. The helper class
  // itself is auto-stubbed by customUtilDetector; here we rewrite the
  // CALL SITES so the converted test code uses Playwright primitives
  // directly instead of `await Helpers.notImplemented(...)`.

  // verifyEquals(true, elementExists(el), msg) → await expect(el).toBeVisible()
  body = body.replace(
    /\bverifyEquals\s*\(\s*true\s*,\s*elementExists\s*\(\s*([\w.]+)\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "await expect($1).toBeVisible()",
  );
  body = body.replace(
    /\bverifyEquals\s*\(\s*false\s*,\s*elementExists\s*\(\s*([\w.]+)\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "await expect($1).not.toBeVisible()",
  );
  // verifyEquals("text", el.getText(), msg) → await expect(el).toHaveText("text")
  body = body.replace(
    /\bverifyEquals\s*\(\s*("[^"]*")\s*,\s*([\w.]+)\.getText\s*\(\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "await expect($2).toHaveText($1)",
  );
  // verifyEquals(expected, list.size(), msg) → expect(await list.count()).toBe(expected)
  body = body.replace(
    /\bverifyEquals\s*\(\s*([^,]+?)\s*,\s*([\w.]+)\.size\s*\(\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "expect(await $2.count()).toBe($1)",
  );
  // verifyEquals(expected, actual, msg) → expect(actual).toBe(expected)  (general fallback)
  body = body.replace(
    /\bverifyEquals\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*[^)]+\)/g,
    "expect($2).toBe($1)",
  );
  // verifyEquals(expected, actual)  (2-arg variant)
  body = body.replace(
    /\bverifyEquals\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g,
    "expect($2).toBe($1)",
  );

  // elementExists(el) → await el.isVisible()
  // Only fires on bare expression usage (e.g. `if (elementExists(x))`).
  body = body.replace(
    /\belementExists\s*\(\s*([\w.]+)\s*\)/g,
    "await $1.isVisible()",
  );

  // clickElement(el, ...) → await el.click()
  // The trailing args (label, page name, etc) are descriptive — drop them.
  // v0.11.3 Patch L: leading `(?:\w+\.)?` absorbs static-prefix forms like
  // `BrowserUtils.clickElement(...)` or `Helpers.safeClick(...)`. Without
  // this, those rewrites left the static prefix in place and broke output.
  body = body.replace(
    /\b(?:\w+\.)?clickElement\s*\(\s*([\w.]+)\s*(?:,\s*[^)]*)?\)/g,
    "await $1.click()",
  );
  body = body.replace(
    /\b(?:\w+\.)?(?:safeClick|clickWithRetry|waitAndClick|robustClick|forceClick|jsClick|doubleClickElement)\s*\(\s*([\w.]+)\s*(?:,\s*[^)]*)?\)/g,
    "await $1.click()",
  );

  // enterText(el, text) → await el.fill(text)
  // Static-prefix-aware (Patch L).
  body = body.replace(
    /\b(?:\w+\.)?enterText\s*\(\s*([\w.]+)\s*,\s*([^)]+?)\s*\)/g,
    "await $1.fill($2)",
  );
  // typeText / sendText / inputText / clearAndSendKeys / clearAndType /
  // clearAndFill — same fill-family. clearAndSendKeys works because
  // Playwright's fill() clears the field before typing.
  body = body.replace(
    /\b(?:\w+\.)?(?:typeText|sendText|inputText|fillText|clearAndSendKeys|clearAndType|clearAndFill|clearAndSetText|setText)\s*\(\s*([\w.]+)\s*,\s*([^)]+?)\s*\)/g,
    "await $1.fill($2)",
  );

  // selectFromDropdown(el, "value") / selectByText(el, "text") family
  body = body.replace(
    /\b(?:\w+\.)?(?:selectFromDropdown|selectByText|selectOption|selectByVisibleTextHelper)\s*\(\s*([\w.]+)\s*,\s*([^)]+?)\s*\)/g,
    "await $1.selectOption({ label: $2 })",
  );

  // hoverOver(el) / mouseHover(el) / scrollTo(el) — common helpers
  body = body.replace(
    /\b(?:\w+\.)?(?:hoverOver|mouseHover|hoverOnElement)\s*\(\s*([\w.]+)\s*(?:,\s*[^)]*)?\)/g,
    "await $1.hover()",
  );
  body = body.replace(
    /\b(?:\w+\.)?(?:scrollTo|scrollToElement|scrollIntoView)\s*\(\s*([\w.]+)\s*(?:,\s*[^)]*)?\)/g,
    "await $1.scrollIntoViewIfNeeded()",
  );

  // getText(el) (custom wrapper, not the WebElement method) →
  // await el.innerText().
  // Conservative — only rewrites when called as a free function with one
  // argument that is a known locator-shaped name.
  body = body.replace(
    /\bgetText\s*\(\s*([a-z]\w*Page\.\w+|this\.\w+|el|element|locator|loc|\w+Btn|\w+Field|\w+Link|\w+Input)\s*\)/g,
    "await $1.innerText()",
  );

  // ============================================================
  // 2) Select-dropdown idiom (new Select(el).select*)
  // ============================================================

  // new Select(el).selectByVisibleText("opt") → await el.selectOption({ label: "opt" })
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.selectByVisibleText\s*\(\s*([^)]+?)\s*\)/g,
    "await $1.selectOption({ label: $2 })",
  );
  // new Select(el).selectByValue("v") → await el.selectOption({ value: "v" })
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.selectByValue\s*\(\s*([^)]+?)\s*\)/g,
    "await $1.selectOption({ value: $2 })",
  );
  // new Select(el).selectByIndex(2) → await el.selectOption({ index: 2 })
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.selectByIndex\s*\(\s*([^)]+?)\s*\)/g,
    "await $1.selectOption({ index: $2 })",
  );
  // new Select(el).getFirstSelectedOption().getText() → await el.inputValue()
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.getFirstSelectedOption\s*\(\s*\)\s*\.getText\s*\(\s*\)/g,
    "await $1.inputValue()",
  );
  // new Select(el).getOptions() → await el.locator('option').all()
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.getOptions\s*\(\s*\)/g,
    "await $1.locator('option').all()",
  );
  // new Select(el).deselectAll() → await el.selectOption([])
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.deselectAll\s*\(\s*\)/g,
    "await $1.selectOption([])",
  );

  // ============================================================
  // 3) Type-position rewrites (declarations)
  // ============================================================

  // String[] / int[] / boolean[] / double[] → string[] / number[] / boolean[] / number[]
  // Only fires in declaration positions: after `let`, `const`, `:`, `(` (param), or `,` (multi-decl).
  body = body.replace(/\bString\[\]/g, "string[]");
  body = body.replace(/\bint\[\]|\blong\[\]|\bshort\[\]|\bdouble\[\]|\bfloat\[\]|\bInteger\[\]|\bLong\[\]|\bDouble\[\]/g, "number[]");
  body = body.replace(/\bboolean\[\]|\bBoolean\[\]/g, "boolean[]");

  // List<WebElement> / List<IWebElement> in declarations → Locator (Playwright
  // Locator IS the list — no separate "list of elements" type).
  body = body.replace(/\bList<\s*WebElement\s*>/g, "Locator");
  body = body.replace(/\bList<\s*IWebElement\s*>/g, "Locator");

  // Bare WebElement in declaration → Locator. Restricted to type positions
  // (after `let`/`const`/`:`/`(`/`,`/`;`) so we don't accidentally rewrite
  // a class name inside a string literal.
  body = body.replace(
    /\b(let|const|var|public|private|protected|readonly|:|\()\s+WebElement\b/g,
    "$1 Locator",
  );

  // Promise<WebElement> / Promise<By> return types → Locator (sync handle).
  body = body.replace(/\bPromise<\s*WebElement\s*>/g, "Locator");
  body = body.replace(/\bPromise<\s*By\s*>/g, "Locator");

  // ============================================================
  // 4) Java collection-method calls
  // ============================================================

  // <expr>.size() — context-sensitive:
  //   - If <expr> ends in *Elements / *Items / *Cells / *Locators OR is `elements`
  //     / `items` / `cells` / `locators` / `results` (Locator-shaped names),
  //     rewrite to `await <expr>.count()`.
  //   - Otherwise rewrite to `<expr>.length` (Java List → JS array).
  body = body.replace(
    /\b((?:[a-z]\w*)?(?:Elements|Items|Cells|Locators|Rows|Buttons|Links|Fields|Inputs))\.size\s*\(\s*\)/g,
    "await $1.count()",
  );
  body = body.replace(
    /\b(elements|items|cells|locators|results|rows|buttons|links|fields|inputs|tableCells|matches|webElements)\.size\s*\(\s*\)/g,
    "await $1.count()",
  );
  // Anything else: assume it's a List<String> / List<Integer> → array.length.
  body = body.replace(/\b([\w.]+)\.size\s*\(\s*\)/g, "$1.length");

  // <expr>.get(i) — same heuristic.
  body = body.replace(
    /\b((?:[a-z]\w*)?(?:Elements|Items|Cells|Locators|Rows|Buttons|Links|Fields|Inputs))\.get\s*\(\s*(\d+|\w+)\s*\)/g,
    "$1.nth($2)",
  );
  body = body.replace(
    /\b(elements|items|cells|locators|results|rows|buttons|links|fields|inputs|tableCells|matches|webElements)\.get\s*\(\s*(\d+|\w+)\s*\)/g,
    "$1.nth($2)",
  );
  // Otherwise List.get(i) → array[i]
  body = body.replace(/\b([\w.]+)\.get\s*\(\s*(\d+|\w+)\s*\)/g, "$1[$2]");

  // List.add(item) → list.push(item)
  body = body.replace(/\b([\w.]+)\.add\s*\(\s*([^)]+?)\s*\)/g, "$1.push($2)");
  // List.remove(i) where i is integer index → splice(i, 1)
  body = body.replace(
    /\b([\w.]+)\.remove\s*\(\s*(\d+|\w+)\s*\)/g,
    "$1.splice($2, 1)",
  );
  // List.contains(item) → list.includes(item)
  body = body.replace(
    /\b([\w.]+)\.contains\s*\(\s*([^)]+?)\s*\)/g,
    "$1.includes($2)",
  );
  // List.isEmpty() → list.length === 0
  body = body.replace(/\b([\w.]+)\.isEmpty\s*\(\s*\)/g, "$1.length === 0");
  // List.indexOf is the same in JS — no rewrite needed.

  // Map.put(k, v) → map[k] = v  (only when in statement position, not chained)
  body = body.replace(
    /\b([\w.]+)\.put\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g,
    "$1[$2] = $3",
  );
  // Map.get(k) → map[k]  (only when arg is a string literal or simple identifier
  // — the .get(i) numeric form is handled above)
  body = body.replace(
    /\b([\w.]+)\.get\s*\(\s*("[^"]+"|'[^']+'|[a-zA-Z_]\w*)\s*\)/g,
    "$1[$2]",
  );
  // Map.containsKey(k) → k in map
  body = body.replace(
    /\b([\w.]+)\.containsKey\s*\(\s*([^)]+?)\s*\)/g,
    "$2 in $1",
  );
  // Map.keySet() → Object.keys(map)
  body = body.replace(/\b([\w.]+)\.keySet\s*\(\s*\)/g, "Object.keys($1)");
  // Map.values() → Object.values(map)
  body = body.replace(/\b([\w.]+)\.values\s*\(\s*\)/g, "Object.values($1)");
  // Map.entrySet() → Object.entries(map)
  body = body.replace(/\b([\w.]+)\.entrySet\s*\(\s*\)/g, "Object.entries($1)");

  // Arrays.asList(a, b, c) → [a, b, c]
  body = body.replace(/\bArrays\.asList\s*\(\s*([^)]*)\)/g, "[$1]");
  // Collections.sort(list) → list.sort()
  body = body.replace(
    /\bCollections\.sort\s*\(\s*([\w.]+)\s*\)/g,
    "$1.sort()",
  );
  // Collections.reverse(list) → list.reverse()
  body = body.replace(
    /\bCollections\.reverse\s*\(\s*([\w.]+)\s*\)/g,
    "$1.reverse()",
  );

  // v0.11.3 Patch N: Java collection literals.
  // `new ArrayList<>()` / `new ArrayList<String>()` / `new LinkedList<>()` → `[]`
  // `new HashMap<>()` / `new HashMap<String,String>()` → `{}`
  // `new HashSet<>()` / `new TreeSet<>()` → `new Set()`
  body = body.replace(
    /\bnew\s+(?:ArrayList|LinkedList|Vector|Stack|CopyOnWriteArrayList)\s*<[^>]*>\s*\(\s*\)/g,
    "[]",
  );
  body = body.replace(
    /\bnew\s+(?:ArrayList|LinkedList|Vector|Stack|CopyOnWriteArrayList)\s*\(\s*\)/g,
    "[]",
  );
  body = body.replace(
    /\bnew\s+(?:HashMap|LinkedHashMap|TreeMap|ConcurrentHashMap|Hashtable)\s*<[^>]*>\s*\(\s*\)/g,
    "{}",
  );
  body = body.replace(
    /\bnew\s+(?:HashMap|LinkedHashMap|TreeMap|ConcurrentHashMap|Hashtable)\s*\(\s*\)/g,
    "{}",
  );
  body = body.replace(
    /\bnew\s+(?:HashSet|LinkedHashSet|TreeSet|CopyOnWriteArraySet)\s*<[^>]*>\s*\(\s*\)/g,
    "new Set()",
  );
  body = body.replace(
    /\bnew\s+(?:HashSet|LinkedHashSet|TreeSet|CopyOnWriteArraySet)\s*\(\s*\)/g,
    "new Set()",
  );

  // v0.11.3 Patch O: Java enhanced-for loops.
  // `for (WebElement el : elems)` → `for (const el of await elems.all())`
  //    (assumes `elems` is a Locator — Playwright Locator needs `.all()`
  //    to iterate as Locator[] in for-of).
  // `for (String s : list)` → `for (const s of list)` (already TS-valid).
  // `for (Type var : iterable)` → `for (const var of iterable)` for any
  // non-WebElement type.
  body = body.replace(
    /\bfor\s*\(\s*WebElement\s+(\w+)\s*:\s*([\w.]+)\s*\)/g,
    "for (const $1 of await $2.all())",
  );
  body = body.replace(
    /\bfor\s*\(\s*(?:final\s+)?[\w<>[\],\s?]+?\s+(\w+)\s*:\s*([\w.()]+?)\s*\)/g,
    "for (const $1 of $2)",
  );

  // ============================================================
  // 5) String-method calls
  // ============================================================

  // .length() → .length  (Java has parens; JS doesn't on strings)
  // Only on identifier-shaped receivers — don't touch method calls that
  // have side effects.
  body = body.replace(/\b([\w.]+)\.length\s*\(\s*\)/g, "$1.length");

  // .contains("x") → .includes("x")
  // (already done above for collection .contains; for strings the same
  // rewrite applies — both end up as .includes, which works on both.)
  // Already covered.

  // .equalsIgnoreCase("x") → .toLowerCase() === "x".toLowerCase()
  body = body.replace(
    /\b([\w.]+)\.equalsIgnoreCase\s*\(\s*([^)]+?)\s*\)/g,
    "$1.toLowerCase() === ($2).toLowerCase()",
  );

  // .replaceAll("regex", "b") → .replace(/regex/g, "b")
  body = body.replace(
    /\b([\w.]+)\.replaceAll\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g,
    "$1.replace(/$2/g, '$3')",
  );

  // .matches("regex") → /regex/.test(<receiver>)
  body = body.replace(
    /\b([\w.]+)\.matches\s*\(\s*"([^"]*)"\s*\)/g,
    "/$2/.test($1)",
  );

  // ============================================================
  // 6) Exception-instance methods
  // ============================================================

  // e.getMessage() → (e as Error).message
  // Conservative — only on bare `e.` / `ex.` / `error.` / `err.` shapes.
  body = body.replace(
    /\b(e|ex|err|error|exception)\.getMessage\s*\(\s*\)/g,
    "($1 as Error).message",
  );
  body = body.replace(
    /\b(e|ex|err|error|exception)\.getStackTrace\s*\(\s*\)/g,
    "($1 as Error).stack",
  );
  body = body.replace(
    /\b(e|ex|err|error|exception)\.printStackTrace\s*\(\s*\)/g,
    "console.error($1)",
  );

  // ============================================================
  // 7) Numeric parsers / type coercion
  // ============================================================

  body = body.replace(/\bInteger\.parseInt\s*\(\s*([^)]+?)\s*\)/g, "parseInt($1, 10)");
  body = body.replace(/\bLong\.parseLong\s*\(\s*([^)]+?)\s*\)/g, "parseInt($1, 10)");
  body = body.replace(/\bDouble\.parseDouble\s*\(\s*([^)]+?)\s*\)/g, "parseFloat($1)");
  body = body.replace(/\bFloat\.parseFloat\s*\(\s*([^)]+?)\s*\)/g, "parseFloat($1)");
  body = body.replace(
    /\bBoolean\.parseBoolean\s*\(\s*([^)]+?)\s*\)/g,
    "(($1) || '').toString().toLowerCase() === 'true'",
  );
  body = body.replace(/\bString\.valueOf\s*\(\s*([^)]+?)\s*\)/g, "String($1)");
  // Integer.toString(n) / String.valueOf are equivalent here.
  body = body.replace(/\bInteger\.toString\s*\(\s*([^)]+?)\s*\)/g, "String($1)");

  // ============================================================
  // 8) Misc Java constructs
  // ============================================================

  // str instanceof String → typeof str === 'string'
  body = body.replace(
    /\b(\w+)\s+instanceof\s+String\b/g,
    "typeof $1 === 'string'",
  );
  body = body.replace(
    /\b(\w+)\s+instanceof\s+Integer\b/g,
    "typeof $1 === 'number'",
  );
  body = body.replace(
    /\b(\w+)\s+instanceof\s+Boolean\b/g,
    "typeof $1 === 'boolean'",
  );

  // System.currentTimeMillis() → Date.now()
  body = body.replace(/\bSystem\.currentTimeMillis\s*\(\s*\)/g, "Date.now()");

  // throw new RuntimeException(e) → throw e
  body = body.replace(
    /\bthrow\s+new\s+RuntimeException\s*\(\s*(\w+)\s*\)/g,
    "throw $1",
  );
  // throw new IllegalArgumentException("msg") → throw new Error("msg")
  body = body.replace(
    /\bthrow\s+new\s+(?:IllegalArgumentException|IllegalStateException|RuntimeException)\s*\(\s*([^)]*)\)/g,
    "throw new Error($1)",
  );

  // ============================================================
  // 9) Surface a single info note if we did anything substantial.
  // ============================================================

  if (body !== raw) {
    warnings.push({
      file: filePath,
      severity: "info",
      message:
        "Java standard-library idioms rewritten to TypeScript (.size, .get, .equals, .length, Integer.parseInt, etc). Verify any complex inline expressions in the converted output — see docs/CONVERSION_PATTERNS.md for the full mapping table.",
    });
  }

  return { body, warnings };
}
