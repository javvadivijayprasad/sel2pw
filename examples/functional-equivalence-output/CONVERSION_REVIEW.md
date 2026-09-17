# Conversion Review

Source: `/sessions/blissful-stoic-mendel/mnt/Converter/examples/functional-equivalence-target`
Output: `/sessions/blissful-stoic-mendel/mnt/Converter/examples/functional-equivalence-output`

## Summary

- Files scanned: **4**
- Page Objects converted: **2**
- Test classes converted: **1**
- Test methods converted: **2**
- Review items: **4**
  - manual: 0
  - warning: 0
  - info: 4

## Severity legend

- **manual** — auto-conversion not possible; you must rewrite this section.
- **warning** — converted but please double-check semantics.
- **info** — heads-up about a non-trivial mapping (e.g. WebDriverWait removed).

## Items by file

### Project-wide

| Severity | Note |
| --- | --- |
| info | Source stack: java-testng. Detected 4 Java files (no .feature files) — using TestNG/JUnit → Playwright Test path. |

### `BaseTest.java`

| Severity | Line | Note |
| --- | --- | --- |
| info | - | Stripped WebDriver creation (`new ChromeDriver()` etc.) — Playwright fixtures provide `page` directly. If you need a non-Chromium browser, configure it in playwright.config.ts → projects. |
| info | - | Generated tests/fixtures.ts from `BaseTest`. Update converted spec files to `import { test, expect } from '../fixtures'` instead of '@playwright/test' to inherit shared setup. |

### `LoginTest.java`

| Severity | Line | Note |
| --- | --- | --- |
| info | - | Java standard-library idioms rewritten to TypeScript (.size, .get, .equals, .length, Integer.parseInt, etc). Verify any complex inline expressions in the converted output — see docs/CONVERSION_PATTERNS.md for the full mapping table. |

## Cheatsheet — Selenium → Playwright

| Selenium / TestNG | Playwright TS |
| --- | --- |
| `driver.get(url)` | `await page.goto(url)` |
| `driver.findElement(By.id("x")).click()` | `await page.locator('#x').click()` |
| `element.sendKeys("...")` | `await locator.fill('...')` |
| `element.getText()` | `await locator.innerText()` |
| `Assert.assertEquals(a, b)` | `expect(a).toBe(b)` |
| `@Test` | `test('...', async ({ page }) => { ... })` |
| `@BeforeMethod` | `test.beforeEach(...)` |
| `@DataProvider` | parameterised loop over rows |
| `WebDriverWait.until(...)` | _removed — Playwright auto-waits_ |
| `JavascriptExecutor.executeScript(js)` | `await page.evaluate(() => js)` |
| `Actions(driver).moveToElement(el).perform()` | `await locator.hover()` |
