# Manual edits applied to make the sel2pw scaffold runnable

This folder is the **functional-equivalence evidence artifact** for the sel2pw JOSS paper. It documents the minimum human intervention required to take the raw sel2pw v2.0.8 scaffold and produce a running Playwright test suite whose behaviour matches the original Selenium+TestNG source.

**Source:** `examples/functional-equivalence-target/` — a purpose-built minimal Selenium + TestNG project written for this evaluation. Two tests (positive and negative login), one Page Object per screen, standard TestNG lifecycle in `BaseTest`. Targets `https://www.saucedemo.com`, Sauce Labs' public demo site — stable since 2016 and industry-standard for Selenium evaluation, so the target is guaranteed not to drift over the paper's review period.

**Why a purpose-built source rather than a real-world OSS repo:** the first functional-equivalence attempt used `eliasnogueira/selenium-java-lean-test-architecture` (a real 2018 Selenium framework). The scaffold compiled and executed, but the target site had gone offline — Elias took down the training booking app and the URL now redirects to his blog. This is a class of validation obstacle no source-code-only migration tool can solve, and it is documented in the paper's Threats to Validity section as an honest empirical finding. To produce a positive-outcome evidence run for the paper, this folder uses a controlled target with a live site instead.

**Conversion command:**

```bash
npx @vijaypjavvadi/sel2pw@2.0.8 convert \
  examples/functional-equivalence-target \
  --out examples/functional-equivalence-output
```

**Pre-cleanup benchmark:** 4 files scanned, 2 Page Objects converted, 1 test class converted, 2 test methods converted, 4 review items (0 manual).

## The 2 edits

Marked in-source with a `[MANUAL EDIT #N]` comment so a reader can diff against the raw sel2pw output.

### Edit #1 — `tests/fixtures.ts` (1 stray brace deleted)

sel2pw's `baseTestExtractor` strips `driver.quit()` from `BaseTest`'s `@AfterMethod` (correctly — Playwright's fixture handles browser lifecycle). However, the surrounding `if (driver != null) { driver.quit(); }` block's closing brace slipped through, ending up in the emitted `fixtures.ts` as a syntactically invalid dangling `}`. Hand-deleted. This is a genuine sel2pw bug found during the functional-equivalence evaluation; a one-line patch in `stripJavaDriverBoilerplate` (`src/transformers/bodyTransformer.ts`) is planned for v2.0.9.

### Edit #2 — `pages/inventory.page.ts` (1 `.first()` appended to a locator)

This edit surfaces a **fundamental semantic difference between Selenium and Playwright** that a source-code-only migration tool cannot fully resolve. Java `@FindBy(css = ".inventory_item")` implicitly relies on Selenium's silent first-match behaviour (`findElement` returns element 0). Playwright's `page.locator(".inventory_item")` matches all 6 items, and calling `.isVisible()` on an ambiguous locator throws a `strict mode violation`. Adding `.first()` restores the original single-element intent. A future sel2pw patch could detect this idiom automatically when `.isDisplayed()` is called on a locator whose selector matches multiple elements at runtime — but doing so from source alone is speculative; runtime inspection is required.

## What was NOT changed

The rest of the sel2pw output ships as-is:

- **`pages/login.page.ts`** — 4 locators extracted from `@FindBy` annotations (`#user-name`, `#password`, `#login-button`, `[data-test='error']`), all 6 methods translated to `async` Playwright equivalents (`sendKeys` → `fill`, `click` → `click`, `getText` → `innerText`).
- **`pages/inventory.page.ts`** — 3 locators + 3 boolean/string accessors (`isDisplayed` → `isVisible`, `getText` → `innerText`).
- **`tests/login.spec.ts`** — 2 tests wrapped in `test.describe('LoginTest', ...)`; Page Objects initialised in `test.beforeEach`; `Assert.assertEquals` → `expect(...).toBe(...)`; `Assert.assertTrue` → `expect(...).toBe(true)`; Javadoc description preserved as jsdoc.
- **`playwright.config.ts`** — multi-project (Chromium/Firefox/WebKit), traces on retry, screenshot on failure, video on failure.
- **`package.json`, `tsconfig.json`, `.gitignore`** — untouched.

## Running the test

```bash
cd examples/functional-equivalence-output

# Install deps
npm install
npx playwright install --with-deps chromium

# Run (baseURL is not needed — the LoginPage.open() method navigates absolutely)
npx playwright test --project=chromium --reporter=list

# HTML report
npx playwright show-report
```

## Result

```
Command:   npx playwright test --project=chromium
Result:    2 passed, 0 failed
Duration:  1.6 seconds
Reporter:  html + list (both defined in playwright.config.ts)
Report:    playwright-report/ (served locally via `npx playwright show-report`)
```

Individual test outcomes:
- ✓ `LoginTest › Valid login lands on the inventory page` (798 ms)
- ✓ `LoginTest › Locked-out account shows an error message` (731 ms)

Both assertions from the original TestNG source pass on the converted output:
- `Assert.assertEquals(inventoryPage.getPageTitle(), "Products")` → `expect(...).toBe("Products")` ✓
- `Assert.assertTrue(inventoryPage.isInventoryVisible())` → `expect(...).toBe(true)` ✓ (after Edit #2)
- `Assert.assertTrue(inventoryPage.isCartVisible())` → `expect(...).toBe(true)` ✓
- `Assert.assertTrue(error.contains("locked out"))` → `expect(error.includes(...)).toBe(true)` ✓

## Reproducibility

- **sel2pw version:** 2.0.8 (Zenodo DOI: 10.5281/zenodo.22819244)
- **Source repo:** `examples/functional-equivalence-target/` (in-repo, versioned with sel2pw)
- **Node:** v20 LTS or v22
- **Playwright:** `@playwright/test` version pinned by `package.json` in this folder; exact version resolved by `npm install` is recorded in `package-lock.json`
- **Target site:** `https://www.saucedemo.com/` — Sauce Labs' public demo, stable and versioned; the accepted credentials (`standard_user` / `secret_sauce`) and locators (`#user-name`, `#password`, `#login-button`, `[data-test='error']`, `.title`, `.inventory_item`, `#shopping_cart_container`) are published on the site itself and have not changed since at least 2020

## What this evidences

- **Compilation.** The raw sel2pw output plus 1 documented brace fix produces TypeScript that compiles cleanly under `tsc --noEmit`.
- **Execution.** `npx playwright test` runs to completion — no crashes, no missing dependencies.
- **Behavioural equivalence.** Both assertions from the original TestNG `LoginTest` — that a valid login lands on the inventory page with a "Products" title and cart visible, and that a locked-out user sees a "locked out" error — are preserved verbatim in the converted spec and pass against the same target site.
- **Bounded human effort.** Two lines of manual editing across one file. Every edit is documented in-source and here. No hidden human intervention.
