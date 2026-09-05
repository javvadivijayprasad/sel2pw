[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20450292.svg)](https://doi.org/10.5281/zenodo.20450292)

# @vijaypjavvadi/sel2pw

> Selenium Java/TestNG → Playwright TypeScript converter

[![npm version](https://img.shields.io/npm/v/@vijaypjavvadi/sel2pw.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw)
[![npm downloads](https://img.shields.io/npm/dm/@vijaypjavvadi/sel2pw.svg?logo=npm)](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw)
[![npm total downloads](https://img.shields.io/npm/dt/@vijaypjavvadi/sel2pw.svg)](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/javvadivijayprasad/sel2pw/blob/main/LICENSE)
[![Node](https://img.shields.io/node/v/@vijaypjavvadi/sel2pw.svg?logo=node.js)](https://nodejs.org/)
[![CI](https://github.com/javvadivijayprasad/sel2pw/actions/workflows/ci.yml/badge.svg)](https://github.com/javvadivijayprasad/sel2pw/actions/workflows/ci.yml)
[![codebases validated](https://img.shields.io/badge/codebases%20validated-15-brightgreen)](./STATUS.md)

Most teams are migrating off `selenium-java + TestNG` (and their BDD/Cucumber and C#/SpecFlow cousins) onto Playwright. The painful part isn't writing new tests — it's the *thousands of existing ones* you can't afford to throw away.

`sel2pw` is a CLI **and a platform service** that takes a Java/Selenium/TestNG project and emits an equivalent Playwright TypeScript project, plus a markdown review report listing everything a human still needs to look at.

> ## What sel2pw is and isn't
>
> sel2pw produces a **skeleton** for human cleanup — not a finished, runnable test suite. Validated against 15 real-world OSS Selenium codebases, the converter produces output where:
>
> - **Small clean Page Objects** (under ~100 lines, standard naming conventions, no exotic generics): output usually compiles with **0–10 TypeScript errors** that take minutes to fix. Validated end-to-end on Playwright — tests launched in 3 browsers (Chromium / Firefox / WebKit) successfully.
> - **Medium-complexity Page Objects** (100–500 lines, some custom helpers): output typically has **20–80 TypeScript errors** that take 15-60 min per file to clean up. Mostly project-specific helper imports + a few unsupported Java idioms.
> - **Large complex utility classes** (1,000+ lines, deep generics, project-specific reporting layers): output has hundreds to thousands of TS errors. **For these files, plan a manual port** — the converter saves typing on locators and assertions but the heavy logic still needs human attention.
>
> The README's "what it converts" table below is honest about coverage. The 240-pattern reference at [`docs/CONVERSION_PATTERNS.md`](./docs/CONVERSION_PATTERNS.md) lists every pattern with its current support status. Run `npx tsc --noEmit` against the output before committing — the error count tells you exactly how much manual cleanup remains.
>
> **The pitch is "saves a month, not 100% automated."** A typical 100-200 file Selenium project converts in 90 seconds and takes 5-15 hours of human cleanup, vs 200-400 hours of hand-migration. That math holds even when individual files have lots of TS errors.

## Where this fits in the platform

`sel2pw` is the **Migrate** stage of the modern automation platform, alongside three sibling services:

| Stage | Service | What it does |
| --- | --- | --- |
| 1. Generate | `test-case-generation-service` (FastAPI, port 4100) | Author new tests from requirements |
| 2. **Migrate** | **`sel2pw` / Converter (this repo, port 4200)** | Lift legacy Selenium suites to Playwright |
| 3. Stabilise | `self-healing-stage-services` (FastAPI, port 8003) | Heal broken locators at runtime |
| 4. Govern | `ai-governance` (Python lib + sidecar) | Sanitise every payload before any LLM call |
| Orchestrate | `modern-automation-platform` (Express gateway, port 3000) | Auth, jobs, UI, artifact storage |

Everything is reachable through the platform gateway at `/api/v1/converter/*`, with the same auth, governance config, and provenance shape as the other services. See [INTEGRATION.md](./INTEGRATION.md) for the API contract, gateway wiring, and cross-service flows.

> **Status — v0.10.3:** Validated end-to-end against **8 real-world OSS Selenium codebases** (selenium1–8 in the test matrix), 0 failed conversions, 0 unclassified files. 45/45 unit + snapshot tests green. Ships as both an npm package (`@vijaypjavvadi/sel2pw`) and a standalone Windows `.exe` distributed via the platform downloads endpoint. Stack: Selenium Java/TestNG, Selenium Java + Cucumber BDD, Selenium C# + NUnit, Selenium C# + SpecFlow — all auto-detected. Optional LLM fallback for genuinely-unknown shapes (Anthropic / OpenAI / Gemini, with `ai-governance` sanitisation enforced before any model call). SQLite failure telemetry so recurring patterns become one-line patches. See [CHANGELOG.md](./CHANGELOG.md) for the full version history (0.1.0 → 0.10.3) and [STATUS.md](./STATUS.md) for the current verified state.

## What it converts

The migration is organised as a rule-based AST + regex pipeline. Every mapping below is applied automatically; nothing here requires configuration. See `CONVERSION_REVIEW.md` in your output folder for the per-file record of which rules fired on which lines.

### Navigation and page-level actions

| Selenium (Java) | Playwright (TypeScript) |
| --- | --- |
| `driver.get(url)` | `await page.goto(url)` |
| `driver.navigate().to(url)` | `await page.goto(url)` |
| `driver.navigate().back()` | `await page.goBack()` |
| `driver.navigate().forward()` | `await page.goForward()` |
| `driver.navigate().refresh()` | `await page.reload()` |
| `driver.getCurrentUrl()` | `page.url()` |
| `driver.getTitle()` | `await page.title()` |
| `driver.getPageSource()` | `await page.content()` |
| `driver.close()` / `driver.quit()` | _removed — Playwright's `page` fixture handles lifecycle_ |

### Locators

| Selenium (Java) | Playwright (TypeScript) |
| --- | --- |
| `By.id("username")` | `page.locator('#username')` |
| `By.cssSelector(".btn")` | `page.locator('.btn')` |
| `By.xpath("//div[@id='x']")` | `page.locator("xpath=//div[@id='x']")` |
| `By.linkText("Sign out")` | `page.getByRole('link', { name: 'Sign out' })` |
| `By.partialLinkText("out")` | `page.getByRole('link', { name: /out/ })` |
| `By.name("q")` | `page.locator('[name="q"]')` |
| `By.className("btn")` | `page.locator('.btn')` |
| `By.tagName("button")` | `page.locator('button')` |
| `driver.findElement(By.id("x"))` | `page.locator('#x')` |
| `driver.findElements(By.css("li"))` | `page.locator('li')` _(a locator is a collection)_ |
| `@FindBy(id="x") WebElement el` | `readonly el: Locator;` _(initialised in constructor)_ |
| `@FindBys` / `@FindAll` | Chained `.locator(...).locator(...)` |

### Element interactions

| Selenium (Java) | Playwright (TypeScript) |
| --- | --- |
| `el.click()` | `await el.click()` |
| `el.sendKeys("hello")` | `await el.fill('hello')` |
| `el.clear()` | `await el.clear()` |
| `el.submit()` | `await el.press('Enter')` |
| `el.getText()` | `await el.innerText()` |
| `el.getAttribute("value")` | `await el.getAttribute('value')` |
| `el.getCssValue("color")` | `await el.evaluate(e => getComputedStyle(e).color)` |
| `el.isDisplayed()` | `await el.isVisible()` |
| `el.isEnabled()` | `await el.isEnabled()` |
| `el.isSelected()` | `await el.isChecked()` |
| `new Select(el).selectByVisibleText("EN")` | `await el.selectOption({ label: 'EN' })` |
| `new Actions(driver).moveToElement(el).perform()` | `await el.hover()` |
| `new Actions(driver).dragAndDrop(a, b).perform()` | `await a.dragTo(b)` |
| `new Actions(driver).sendKeys(el, "x").perform()` | `await el.fill('x')` |
| `((JavascriptExecutor)driver).executeScript(js)` | `await page.evaluate(() => { … })` |

### Waiting

| Selenium (Java) | Playwright (TypeScript) |
| --- | --- |
| `new WebDriverWait(driver, 10).until(...)` | _removed — Playwright auto-waits on every locator action_ |
| `ExpectedConditions.visibilityOf(el)` | Implicit in `el.click()` / `el.fill(...)` / etc |
| `ExpectedConditions.elementToBeClickable(el)` | Implicit in `el.click()` |
| `Thread.sleep(ms)` | `await page.waitForTimeout(ms)` _(flagged as `warning` — prefer waiting on a real condition)_ |
| `driver.manage().timeouts().implicitlyWait(...)` | _removed — configure via `use: { actionTimeout: ... }` in `playwright.config.ts`_ |

### Assertions

| TestNG / JUnit / Hamcrest / AssertJ | Playwright (TypeScript) |
| --- | --- |
| `Assert.assertEquals(a, b)` | `expect(a).toBe(b)` |
| `Assert.assertNotEquals(a, b)` | `expect(a).not.toBe(b)` |
| `Assert.assertTrue(x)` | `expect(x).toBe(true)` |
| `Assert.assertFalse(x)` | `expect(x).toBe(false)` |
| `Assert.assertNull(x)` / `assertNotNull(x)` | `expect(x).toBeNull()` / `expect(x).not.toBeNull()` |
| `assertThat(x, is("y"))` _(Hamcrest)_ | `expect(x).toBe('y')` |
| `assertThat(x, contains("y"))` | `expect(x).toContain('y')` |
| `assertThat(actual).isEqualTo(x)` _(AssertJ)_ | `expect(actual).toBe(x)` |
| `assertThat(actual).contains(x)` | `expect(actual).toContain(x)` |
| `assertThat(actual).isTrue()` / `isFalse()` | `expect(actual).toBe(true)` / `.toBe(false)` |

### Test lifecycle (TestNG)

| Selenium / TestNG | Playwright (TypeScript) |
| --- | --- |
| `@Test public void x() { … }` | `test('x', async ({ page }) => { … })` |
| `@Test(description="…")` | Description becomes the `test()` title |
| `@Test(groups={"smoke"})` | Emitted as `// groups: smoke` comment (Playwright uses [tags](https://playwright.dev/docs/test-annotations#tag-tests) — apply manually) |
| `@Test(dataProvider="rows")` | Emitted with a `TODO(sel2pw)` comment pointing at the [parameterised-loop pattern](https://playwright.dev/docs/test-parameterize) |
| `@BeforeMethod` / `@BeforeEach` | `test.beforeEach(async ({ page }) => { … })` |
| `@AfterMethod` / `@AfterEach` | `test.afterEach(...)` |
| `@BeforeClass` / `@BeforeAll` | `test.beforeAll(...)` |
| `@AfterClass` / `@AfterAll` | `test.afterAll(...)` |
| `BaseTest` (superclass with driver lifecycle) | Emitted as `tests/fixtures.ts` — a Playwright fixture the specs consume |
| Test class body | Wrapped in `test.describe('ClassName', () => { … })` |

### Page Object Model

| Selenium (Java) | Playwright (TypeScript) |
| --- | --- |
| Page Object class extending base | TS class with `page: Page` + typed `Locator` fields |
| Constructor: `PageFactory.initElements(driver, this)` | `constructor(page: Page) { this.page = page; }` |
| Inheritance: `class ChildPage extends ParentPage` | Preserved: `extends ParentPage` + `super(page)` in constructor |
| Field/method name collision (e.g. field `next` + method `next()`) | Field auto-renamed to `nextLocator`; body references rewritten |
| `this.driver.X` | Normalised to bare `driver.X` before rewrite (v2.0.5 — avoids `this.await` and `this.// comment` leaks) |

### Infrastructure that Playwright replaces (skipped, not translated)

These classes have no Playwright equivalent because Playwright's `page` fixture and `playwright.config.ts` `projects` array replace the whole layer. sel2pw detects them and skips emission, with the replacement noted in `FILE_MAPPING.md`:

| Selenium infrastructure | Playwright replacement |
| --- | --- |
| `DriverManager` / `ThreadLocal<WebDriver>` | Playwright `page` fixture (per-test isolation is built-in) |
| `BrowserFactory` (Chrome/Firefox/Edge switcher) | `projects` array in `playwright.config.ts` |
| `TargetFactory` (local / Grid / TestContainers switcher) | Same — `projects` config |
| `WebDriverManager.chromedriver().setup()` | _removed — Playwright bundles browsers via `npx playwright install`_ |
| `@Config` interface + `@Key(...)` _(Aeonbits Owner library)_ | `.env` file + `tests/config.ts` env loader |
| Sauce Labs cloud harness (`SauceOptions`, `SauceSession`, `MutableCapabilities`, `RemoteWebDriver`, `driver.executeScript("sauce:...")`) | _stripped from lifecycle hooks_ — Playwright Cloud runners (Sauce, BrowserStack, LambdaTest) integrate via `playwright.config.ts` `projects` + env vars |
| `System.setProperty("webdriver.chrome.driver", …)` | _removed_ |
| `driver.manage().window().maximize()` | Configure viewport in `use: { viewport: ... }` |

### Aggregated shared files (v2.0+)

Java types that repeat across the codebase get collected into one output file instead of one file per source. See `types/` and `data/` in the output.

| Java source kind | Landing file | Example |
| --- | --- | --- |
| `enum X { … }` | `types/enums.ts` | `RoomType`, `Target` → single `export enum` block per input |
| `class X extends Exception` (or `Error` / `Throwable`) | `types/errors.ts` | `HeadlessNotSupportedException` → `class HeadlessNotSupportedException extends Error` (all hierarchies collapse to TS `Error`) |
| `record X(a, b, c) { }` / plain POJO | `data/models.ts` | `Booking` record → TS interface + optional builder |
| Custom utility with no equivalent (`ConfigurationManager`, `AllureManager`, `BookingDataFactory`, `BrowserData`) | `tests/_legacy-stubs/<name>.ts` | Typed stub with `notImplemented()` calls — user migrates each call site, then deletes the stub |

### CLI outputs (per conversion)

| File | Purpose |
| --- | --- |
| `FILE_MAPPING.md` | Human-readable table of source Java → output TS, grouped by status (converted / aggregated / skipped / stubbed) |
| `CONVERSION_REVIEW.md` | Per-item warnings and manual action list |
| `MIGRATION_NOTES.md` | High-level notes about the migration (what to configure in `playwright.config.ts`, how to wire the fixture, etc.) |
| `conversion-result.json` | Machine-readable version of the same data — for CI pipelines and downstream tooling |

Preview any of these without writing files by adding `--dry-run` to the `convert` command.

## Pipeline

```
Java source files
       │
       ▼
  ┌─────────┐
  │ scanner │  walk dir, classify each .java as test-class / page-object / base / unknown
  └────┬────┘
       ▼
  ┌─────────┐
  │ parser  │  extract IR: locator fields, methods + bodies, @Test/lifecycle annotations
  └────┬────┘
       ▼
  ┌──────────────┐
  │ transformers │  locatorMapper · apiMap · assertionMap · bodyTransformer
  └────┬─────────┘
       ▼
  ┌─────────┐
  │ emitters│  pageObjectEmitter · testClassEmitter · projectEmitter (templates)
  └────┬────┘
       ▼
output/
  pages/login.page.ts
  tests/login.spec.ts
  playwright.config.ts
  package.json
  CONVERSION_REVIEW.md   ← every warning + manual TODO
```

## Install & run

```bash
npm install
npm run build

# convert
node dist/cli.js convert <input-java-project> --out <output-playwright-project>

# or dry-run analysis (no writes)
node dist/cli.js analyze <input-java-project>

# end-to-end demo on the bundled sample
npm run convert:sample
```

CLI commands:

```
sel2pw convert <inputDir> --out <outputDir> [--templates <dir>] [--dry-run]
sel2pw analyze <inputDir>
```

Programmatic API:

```ts
import { convert } from "sel2pw";
await convert({
  inputDir: "./my-selenium-project",
  outputDir: "./my-playwright-project",
});
```

## Architecture

```
src/
├── cli.ts                    # commander CLI entry
├── index.ts                  # public convert() / analyze() API
├── types.ts                  # IR — JavaFile, PageObjectIR, TestClassIR, ReviewItem, etc.
├── scanner/projectScanner.ts # walk + classify .java files
├── parser/javaExtractor.ts   # extract IR from raw Java (regex + balanced braces)
├── transformers/
│   ├── locatorMapper.ts      # By.* → page.locator/getByRole
│   ├── apiMap.ts             # WebDriver/WebElement → Playwright async
│   ├── assertionMap.ts       # TestNG Assert → expect()
│   └── bodyTransformer.ts    # orchestrates per-method-body rewrites + warnings
├── emitters/
│   ├── pageObjectEmitter.ts  # POM IR → TS class
│   ├── testClassEmitter.ts   # TestClass IR → spec file
│   └── projectEmitter.ts     # writes templates + converted files
├── reports/reviewReport.ts   # CONVERSION_REVIEW.md
└── utils/naming.ts           # PascalCase / kebab-case / Java→TS type mapping

templates/                    # scaffolded into the output project
├── package.json.tmpl
├── playwright.config.ts.tmpl
├── tsconfig.json.tmpl
└── gitignore.tmpl

examples/selenium-testng-sample/   # input fixture for the demo
└── src/test/java/com/example/...
```

The IR boundary in `parser/javaExtractor.ts` is deliberately clean: today it's a regex+balanced-brace extractor (which works fine for conventional TestNG/POM shapes), but a real AST parser (e.g. `java-parser` on Chevrotain, or a JVM-side `JavaParser` sidecar) can be slotted in without changing scanner, transformers, or emitters.

## What's not yet handled (flagged in `CONVERSION_REVIEW.md`)

- **`@DataProvider` parameterisation** — emitted as a warning; convert manually to a `for (const row of rows()) { test(...) }` loop.
- **`BaseTest` superclass lifecycle** — flagged; port shared setup into a [Playwright fixture](https://playwright.dev/docs/test-fixtures) in `tests/fixtures.ts`.
- **`Actions` chains** — `Actions(driver).moveToElement(el).click().perform()` → `await locator.hover()` + `.click()` (semantics differ; review).
- **`JavascriptExecutor.executeScript(...)`** — flagged; convert to `await page.evaluate(() => ...)`.
- **iframe `switchTo().frame(...)`** — flagged; use `page.frameLocator(...)`.
- **Alert handling** — flagged; use `page.on('dialog', d => d.accept())`.
- **Cucumber `.feature` + step defs** — not in MVP. Roadmap below.
- **C# / SpecFlow** — not in MVP. Roadmap below.

## Roadmap

The full punch list lives in [PRODUCTION_TASKS.md](./PRODUCTION_TASKS.md). Headline:

| Phase | Status | Headline |
| --- | --- | --- |
| 0 — Platform integration | ✅ Complete | HTTP service at `:4200`, gateway routes, governance sidecar, self-healing shim, shared types, Docker |
| 1 — Hardening | ✅ Complete | Real AST parser (`java-parser`) with regex fallback, unit + snapshot tests, error recovery, structured logger |
| 2 — Coverage gaps | ✅ Complete | `@DataProvider`, BaseTest → fixture, `testng.xml`, `Actions`, `executeScript`, iframe, alert, cookies, uploads, Hamcrest, JUnit 4/5, `.properties` → `.env` |
| 3 — Output quality | ✅ Complete | Prettier, `tsc` validate, TODO markers, `auth.setup.ts`, `MIGRATION_NOTES.md`, `--diff` |
| 4 — Distribution | ✅ Complete | LICENSE, CI matrix, release workflow, Dependabot, typedoc, Changesets, CONTRIBUTING |
| 5 — Stretch | ✅ Scaffolds | Cucumber BDD, **auto-fix loop**, hybrid AST+LLM, behaviour-parity verifier, C#/SpecFlow design |

## Development

```bash
npm install
npm run dev -- convert ./examples/selenium-testng-sample --out ./examples/output-playwright
npm test
```
## Citation

If you use `@vijaypjavvadi/sel2pw` in academic work, please cite:

> Javvadi, V. P. (2026). *@vijaypjavvadi/sel2pw: A Deterministic, AST-Based Migration Toolkit from Selenium Test Suites to Playwright TypeScript* (Version 1.0.1) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.20450292

A machine-readable [`CITATION.cff`](CITATION.cff) file is included in the repository root.

## License

MIT
