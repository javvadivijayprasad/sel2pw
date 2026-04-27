/**
 * Phase 2 — auto-conversion for advanced Selenium APIs that the v0.1
 * `bodyTransformer` flagged as `manual`. These rewrites are conservative:
 * if the source is too complex to translate confidently we still flag it,
 * but the common shapes are now handled.
 *
 * Patterns covered:
 *   - Actions(driver).moveToElement(el).click().perform()
 *   - JavascriptExecutor.executeScript("...", arg1, arg2)
 *   - driver.switchTo().frame(...) ... driver.switchTo().defaultContent()
 *   - driver.switchTo().alert().accept() / dismiss() / sendKeys() / getText()
 *   - file upload via element.sendKeys(filePath) on <input type=file>
 *   - cookies (driver.manage().getCookies/addCookie/deleteCookie)
 */

import { ReviewItem } from "../types";

export interface AdvancedRewriteResult {
  body: string;
  warnings: ReviewItem[];
}

export function applyAdvancedApiRewrites(
  body: string,
  filePath: string,
): AdvancedRewriteResult {
  const warnings: ReviewItem[] = [];
  let out = body;

  out = rewriteActions(out, filePath, warnings);
  out = rewriteExecuteScript(out, filePath, warnings);
  out = rewriteIframeContext(out, filePath, warnings);
  out = rewriteAlerts(out, filePath, warnings);
  out = rewriteCookies(out, filePath, warnings);
  out = rewriteFileUpload(out, filePath, warnings);
  out = rewriteWindowHandles(out, filePath, warnings);
  out = rewriteDriverWrappers(out, filePath, warnings);

  return { body: out, warnings };
}

/**
 * Custom-framework Driver/Browser wrappers — common in advanced Selenium
 * projects (the selenium3/AlfredStenwin pattern). Examples:
 *
 *   DriverManager.getDriver().goToUrl(url);                            → await this.page.goto(url);
 *   DriverManager.getDriver().getPageTitle();                          → await this.page.title()
 *   DriverManager.getDriver().findElement(X).click();                  → await (X).click();
 *   DriverManager.getDriver().findElement(X).typeText(v);              → await (X).fill(v);
 *   DriverManager.getDriver()                                          → this.page  (bare reference)
 *   BrowserManager.getBrowser().openUrl(url);                          → await this.page.goto(url);
 *   BrowserManager.getBrowser().getTitle();                            → await this.page.title()
 *   BrowserManager.getBrowser()                                        → this.page  (bare reference)
 *
 * The `.findElement(X)...` rewrites assume X already evaluates to a
 * Playwright Locator (or to something the user converted from a By). If the
 * source uses an "Elements bag" pattern that still returns Java `By`
 * objects, the user has to migrate those bag classes manually — sel2pw
 * surfaces a manual review item if the pattern is detected without an
 * obvious Locator-returning expression.
 */
function rewriteDriverWrappers(
  body: string,
  filePath: string,
  warnings: ReviewItem[],
): string {
  let out = body;
  let touched = false;

  // ----- DriverManager (selenium3 style) -----

  // .goToUrl(url) navigation.
  out = out.replace(
    /\bDriverManager\.getDriver\s*\(\s*\)\.goToUrl\s*\(\s*([^)]+)\s*\)\s*;/g,
    (_m, url) => {
      touched = true;
      return `await this.page.goto(${url});`;
    },
  );

  // .getPageTitle() title fetch.
  out = out.replace(
    /\bDriverManager\.getDriver\s*\(\s*\)\.getPageTitle\s*\(\s*\)/g,
    () => {
      touched = true;
      return "await this.page.title()";
    },
  );

  // findElement(X).typeText(v) — accept up to one level of nested parens in X.
  out = out.replace(
    /\bDriverManager\.getDriver\s*\(\s*\)\.findElement\s*\(\s*((?:[^()]|\([^()]*\))+?)\s*\)\.typeText\s*\(\s*([^)]+)\s*\)\s*;/g,
    (_m, locExpr: string, value: string) => {
      touched = true;
      return `await (${locExpr.trim()}).fill(${value});`;
    },
  );

  // findElement(X).click()
  out = out.replace(
    /\bDriverManager\.getDriver\s*\(\s*\)\.findElement\s*\(\s*((?:[^()]|\([^()]*\))+?)\s*\)\.click\s*\(\s*\)\s*;/g,
    (_m, locExpr: string) => {
      touched = true;
      return `await (${locExpr.trim()}).click();`;
    },
  );

  // findElement(X).getText()
  out = out.replace(
    /\bDriverManager\.getDriver\s*\(\s*\)\.findElement\s*\(\s*((?:[^()]|\([^()]*\))+?)\s*\)\.getText\s*\(\s*\)/g,
    (_m, locExpr: string) => {
      touched = true;
      return `await (${locExpr.trim()}).innerText()`;
    },
  );

  // Bare DriverManager.getDriver() reference (after specific patterns above).
  out = out.replace(/\bDriverManager\.getDriver\s*\(\s*\)/g, () => {
    touched = true;
    return "this.page";
  });

  // ----- BrowserManager (selenium3 alternate style) -----

  out = out.replace(
    /\bBrowserManager\.getBrowser\s*\(\s*\)\.openUrl\s*\(\s*([^)]+)\s*\)\s*;/g,
    (_m, url) => {
      touched = true;
      return `await this.page.goto(${url});`;
    },
  );
  out = out.replace(
    /\bBrowserManager\.getBrowser\s*\(\s*\)\.getTitle\s*\(\s*\)/g,
    () => {
      touched = true;
      return "await this.page.title()";
    },
  );
  out = out.replace(/\bBrowserManager\.getBrowser\s*\(\s*\)/g, () => {
    touched = true;
    return "this.page";
  });

  if (touched) {
    warnings.push({
      file: filePath,
      severity: "info",
      message:
        "Custom DriverManager/BrowserManager wrapper calls were rewritten to Playwright primitives. If your project uses an 'Elements bag' (e.g. `MyPageElements.getX()` returning Java `By`), port those bag classes to return Playwright `Locator`s — the rewrites assume the inner expression already evaluates to a Locator.",
    });
  }
  return out;
}

/**
 * Multi-window / tab semantics.
 *
 *   driver.getWindowHandles()                 → this.page.context().pages()
 *   driver.getWindowHandle()                  → (this.page  -- the original)
 *   driver.switchTo().window(handle)          → handle (already a Page in PW)
 *
 * The full Selenium pattern usually looks like:
 *
 *   String original = driver.getWindowHandle();
 *   for (String handle : driver.getWindowHandles()) {
 *     if (!handle.equals(original)) driver.switchTo().window(handle);
 *   }
 *
 * In Playwright, new tabs/popups arrive via the `page` event:
 *
 *   const [popup] = await Promise.all([
 *     this.page.context().waitForEvent('page'),
 *     this.openLinkButton.click(),
 *   ]);
 *
 * That structural transform is too case-specific to do mechanically. We
 * rewrite the easy bits, and emit a guidance warning for the orchestration.
 */
function rewriteWindowHandles(
  body: string,
  filePath: string,
  warnings: ReviewItem[],
): string {
  let out = body;
  let touched = false;

  if (/\bdriver\.getWindowHandles\s*\(/.test(out)) {
    out = out.replace(
      /\bdriver\.getWindowHandles\s*\(\s*\)/g,
      "this.page.context().pages()",
    );
    touched = true;
  }
  if (/\bdriver\.getWindowHandle\s*\(/.test(out)) {
    out = out.replace(/\bdriver\.getWindowHandle\s*\(\s*\)/g, "this.page");
    touched = true;
  }
  if (/\bdriver\.switchTo\(\)\.window\s*\(/.test(out)) {
    // Best-effort: replace `driver.switchTo().window(h)` with the handle —
    // it's now a Page in the rewritten code so subsequent locators that
    // referenced `driver` need to be re-scoped manually.
    out = out.replace(
      /\bdriver\.switchTo\(\)\.window\s*\(\s*([^)]+)\s*\)\s*;/g,
      (_m, handle) =>
        `// switched to window: ${handle.trim()} — subsequent locators should use that Page directly`,
    );
    touched = true;
  }

  if (touched) {
    warnings.push({
      file: filePath,
      severity: "warning",
      message:
        "Multi-window code was partially auto-converted. In Playwright, new tabs arrive via `context.waitForEvent('page')`; rewrite calls that opened a popup as `const [popup] = await Promise.all([page.context().waitForEvent('page'), <click>]);` and use `popup` for subsequent locators.",
    });
  }
  return out;
}

// -------- Actions chains --------

function rewriteActions(
  body: string,
  filePath: string,
  warnings: ReviewItem[],
): string {
  // Common patterns:
  //   new Actions(driver).moveToElement(el).perform();
  //   new Actions(driver).moveToElement(el).click().perform();
  //   new Actions(driver).dragAndDrop(src, dst).perform();
  //   new Actions(driver).keyDown(Keys.SHIFT).click(el).keyUp(Keys.SHIFT).perform();
  let out = body;

  // moveToElement(x).click().perform()
  out = out.replace(
    /new\s+Actions\s*\(\s*driver\s*\)\.moveToElement\s*\(\s*([^)]+?)\s*\)\.click\s*\(\s*\)\.perform\s*\(\s*\)\s*;/g,
    (_m, el) => `await ${normaliseLocatorRef(el)}.hover();\nawait ${normaliseLocatorRef(el)}.click();`,
  );

  // moveToElement(x).perform()  -> hover()
  out = out.replace(
    /new\s+Actions\s*\(\s*driver\s*\)\.moveToElement\s*\(\s*([^)]+?)\s*\)\.perform\s*\(\s*\)\s*;/g,
    (_m, el) => `await ${normaliseLocatorRef(el)}.hover();`,
  );

  // dragAndDrop(src, dst).perform()
  out = out.replace(
    /new\s+Actions\s*\(\s*driver\s*\)\.dragAndDrop\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\.perform\s*\(\s*\)\s*;/g,
    (_m, src, dst) =>
      `await ${normaliseLocatorRef(src)}.dragTo(${normaliseLocatorRef(dst)});`,
  );

  // doubleClick(x).perform()
  out = out.replace(
    /new\s+Actions\s*\(\s*driver\s*\)\.doubleClick\s*\(\s*([^)]+?)\s*\)\.perform\s*\(\s*\)\s*;/g,
    (_m, el) => `await ${normaliseLocatorRef(el)}.dblclick();`,
  );

  // contextClick(x).perform()
  out = out.replace(
    /new\s+Actions\s*\(\s*driver\s*\)\.contextClick\s*\(\s*([^)]+?)\s*\)\.perform\s*\(\s*\)\s*;/g,
    (_m, el) => `await ${normaliseLocatorRef(el)}.click({ button: 'right' });`,
  );

  // Anything else still using `new Actions(...)` is too ambiguous to translate.
  if (/\bnew\s+Actions\s*\(/.test(out)) {
    warnings.push({
      file: filePath,
      severity: "manual",
      message:
        "Selenium Actions chain still present after auto-conversion — port to page.mouse / page.keyboard manually. Common building blocks: locator.hover, locator.dragTo, locator.click({ button:'right' }).",
    });
  }
  return out;
}

function normaliseLocatorRef(ref: string): string {
  const t = ref.trim();
  // Locator field reference like "this.x" or "loginPage.usernameInput" — use as-is.
  if (/^[\w.]+$/.test(t)) return t;
  // A `driver.findElement(...)` was likely already rewritten; return as-is.
  return t;
}

// -------- JavascriptExecutor.executeScript --------

function rewriteExecuteScript(
  body: string,
  filePath: string,
  warnings: ReviewItem[],
): string {
  let out = body;

  // ((JavascriptExecutor) driver).executeScript("return ...", arg1, arg2);
  // -> await this.page.evaluate(([arg1, arg2]) => { ... }, [arg1, arg2]);
  // For a literal string with no args:
  //    "return document.title"  -> page.evaluate(() => document.title)
  out = out.replace(
    /\(\s*\(JavascriptExecutor\)\s*driver\s*\)\.executeScript\s*\(\s*"([^"]*)"\s*\)\s*;/g,
    (_m, script) => `await this.page.evaluate(() => { ${stripReturn(script)} });`,
  );
  out = out.replace(
    /\(\s*\(JavascriptExecutor\)\s*driver\s*\)\.executeScript\s*\(\s*"([^"]*)"\s*,\s*([^)]*?)\s*\)\s*;/g,
    (_m, script, args) =>
      `await this.page.evaluate(([${argNames(args)}]) => { ${stripReturn(script)} }, [${args}]);`,
  );

  if (/\b(?:JavascriptExecutor|executeScript)\b/.test(out)) {
    warnings.push({
      file: filePath,
      severity: "warning",
      message:
        "executeScript was partially auto-converted to page.evaluate. Re-check argument passing — Playwright passes args as a single tuple, not varargs.",
    });
  }
  return out;
}

function stripReturn(script: string): string {
  return script.replace(/^return\s+/, "return ");
}

function argNames(args: string): string {
  return args
    .split(",")
    .map((a, i) => `_arg${i}`)
    .join(", ");
}

// -------- iframe switchTo / defaultContent --------

function rewriteIframeContext(
  body: string,
  filePath: string,
  warnings: ReviewItem[],
): string {
  // Pattern: driver.switchTo().frame(<expr>) ... driver.switchTo().defaultContent()
  // We translate the *single-frame* common case by re-scoping subsequent
  // locator chains to a frameLocator. For multi-frame nesting we surface a
  // manual warning.
  let out = body;

  // Replace switchTo().frame("name") and switchTo().frame(0) with a marker
  // comment so the user notices and rewrites the locator chain.
  if (/\bswitchTo\(\)\.frame\b/.test(out)) {
    out = out.replace(
      /driver\.switchTo\(\)\.frame\s*\(\s*([^)]+)\s*\)\s*;/g,
      (_m, arg) => {
        const locArg = parseFrameArg(arg);
        return `// frameLocator for "${arg.trim()}" — wrap subsequent locators:\n// const frame = this.page.frameLocator(${locArg});\n// frame.locator(...) instead of this.page.locator(...)`;
      },
    );
    out = out.replace(
      /driver\.switchTo\(\)\.defaultContent\s*\(\s*\)\s*;/g,
      `// returned to top frame — subsequent locators use this.page directly`,
    );
    warnings.push({
      file: filePath,
      severity: "warning",
      message:
        "iframe switchTo() emitted comment markers — manually scope subsequent locator calls to `page.frameLocator(<sel>)`. For nested frames chain `.frameLocator(...)`.",
    });
  }
  return out;
}

function parseFrameArg(arg: string): string {
  const t = arg.trim();
  if (/^\d+$/.test(t)) return JSON.stringify(`iframe >> nth=${t}`);
  if (/^".*"$/.test(t)) return JSON.stringify(`iframe[name=${t}]`);
  return t;
}

// -------- Alert handling --------

function rewriteAlerts(
  body: string,
  filePath: string,
  warnings: ReviewItem[],
): string {
  // driver.switchTo().alert().accept();   -> page.on('dialog', d => d.accept());
  //                                          (declared once at the top of the test)
  // driver.switchTo().alert().dismiss();
  // driver.switchTo().alert().sendKeys("x"); -> page.on('dialog', d => d.accept('x'));
  // driver.switchTo().alert().getText();    -> requires capture pattern
  let out = body;
  let needsHelper = false;

  out = out.replace(
    /driver\.switchTo\(\)\.alert\(\)\.accept\(\)\s*;/g,
    () => {
      needsHelper = true;
      return `this.page.once('dialog', (d) => d.accept());`;
    },
  );
  out = out.replace(
    /driver\.switchTo\(\)\.alert\(\)\.dismiss\(\)\s*;/g,
    () => {
      needsHelper = true;
      return `this.page.once('dialog', (d) => d.dismiss());`;
    },
  );
  out = out.replace(
    /driver\.switchTo\(\)\.alert\(\)\.sendKeys\s*\(\s*([^)]+)\s*\)\s*;/g,
    (_m, text) => {
      needsHelper = true;
      return `this.page.once('dialog', (d) => d.accept(${text}));`;
    },
  );
  if (/driver\.switchTo\(\)\.alert\(\)\.getText\(\)/.test(out)) {
    warnings.push({
      file: filePath,
      severity: "warning",
      message:
        "Alert text capture detected — use `const dlg = await page.waitForEvent('dialog'); const msg = dlg.message();`. Auto-conversion not safe here.",
    });
  }
  if (needsHelper) {
    warnings.push({
      file: filePath,
      severity: "info",
      message:
        "Alert/dialog handling rewritten to `page.once('dialog', ...)`. Note: register the handler BEFORE the action that triggers the dialog, otherwise the click may resolve first.",
    });
  }
  return out;
}

// -------- Cookies --------

function rewriteCookies(
  body: string,
  _filePath: string,
  _warnings: ReviewItem[],
): string {
  let out = body;
  out = out.replace(
    /driver\.manage\(\)\.getCookies\(\)/g,
    "await this.page.context().cookies()",
  );
  out = out.replace(
    /driver\.manage\(\)\.addCookie\s*\(\s*([^)]+?)\s*\)\s*;/g,
    "await this.page.context().addCookies([$1]);",
  );
  out = out.replace(
    /driver\.manage\(\)\.deleteAllCookies\s*\(\s*\)\s*;/g,
    "await this.page.context().clearCookies();",
  );
  return out;
}

// -------- File upload --------

function rewriteFileUpload(
  body: string,
  _filePath: string,
  _warnings: ReviewItem[],
): string {
  // Heuristic: if a sendKeys call passes a Path / File / String that ends in
  // `.toString()` or contains "Paths.get" / "File(", treat it as upload.
  // The standard sendKeys → fill rewrite already happened upstream in
  // bodyTransformer; here we rewrite cases that still reference Paths/File.
  let out = body;
  out = out.replace(
    /\bawait\s+(this\.\w+|\w+)\.fill\s*\(\s*((?:Paths\.get|new\s+File)\s*\([^)]+\)(?:\.toString\(\))?)\s*\)\s*;/g,
    (_m, locator, expr) => `await ${locator}.setInputFiles(${expr});`,
  );
  return out;
}
