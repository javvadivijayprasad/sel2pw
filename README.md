[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20450292.svg)](https://doi.org/10.5281/zenodo.20450292)

# @vijaypjavvadi/sel2pw

> Selenium Java/TestNG → Playwright TypeScript scaffold converter (rule-based; Java via `java-parser` AST with regex fallback; C# via an experimental regex extractor)

[![npm version](https://img.shields.io/npm/v/@vijaypjavvadi/sel2pw.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw)
[![npm downloads](https://img.shields.io/npm/dm/@vijaypjavvadi/sel2pw.svg?logo=npm)](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw)
[![npm total downloads](https://img.shields.io/npm/dt/@vijaypjavvadi/sel2pw.svg)](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/javvadivijayprasad/sel2pw/blob/main/LICENSE)
[![Node](https://img.shields.io/node/v/@vijaypjavvadi/sel2pw.svg?logo=node.js)](https://nodejs.org/)
[![CI](https://github.com/javvadivijayprasad/sel2pw/actions/workflows/ci.yml/badge.svg)](https://github.com/javvadivijayprasad/sel2pw/actions/workflows/ci.yml)
[![codebases validated](https://img.shields.io/badge/codebases%20validated-15-brightgreen)](./STATUS.md)

Most teams are migrating off `selenium-java + TestNG` (and their BDD/Cucumber and C#/SpecFlow cousins) onto Playwright. The painful part isn't writing new tests — it's the *thousands of existing ones* you can't afford to throw away.

`sel2pw` is a command-line tool that takes a Java/Selenium/TestNG project and writes a Playwright TypeScript project, plus a review report listing everything a person still needs to look at. You don't need Java installed, only Node.js.

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
> **What the numbers mean.** On the 15-repository benchmark (409 Java files, LLM fallback off), 150 files (36.7%) converted with no stubs, 152 (37.2%) contain stubs with migration recipes, 96 (23.5%) need mixed cleanup and 11 (2.7%) were skipped as data-only classes. "0 failed conversions" means no crashes and no missing outputs — every file produced either a scaffold or an explicit skip record — not that the output compiles or is behaviourally equivalent. sel2pw removes the mechanical part of a migration (locators, assertions, lifecycle, file layout); the remaining human effort has not been measured against a manual-migration baseline, so no time-saving multiple is claimed.

## Quick start

**You need:** Node.js 18 or newer. Check with `node --version`.

Convert a project in one command. Point it at the root of your Selenium project, or at its `src/test/java` folder:

```bash
npx @vijaypjavvadi/sel2pw convert ./my-selenium-project --out ./my-playwright-project
```

Or install it once and use the short `sel2pw` command:

```bash
npm install -g @vijaypjavvadi/sel2pw
sel2pw convert ./my-selenium-project --out ./my-playwright-project
```

Want to see what would happen first? Add `--dry-run` to print the plan without writing any files, or run `sel2pw analyze ./my-selenium-project` for a summary.

### Run the converted project

```bash
cd my-playwright-project
npm install                 # installs @playwright/test and TypeScript
npx playwright install      # downloads the browsers (first time only)
npx tsc --noEmit            # the error count = how much cleanup is left
npx playwright test         # run the tests
npx playwright show-report  # open the HTML report
```

Then open these files in the output folder:

- `CONVERSION_REVIEW.md`: the to-do list, one line per item a person needs to check
- `FILE_MAPPING.md`: which Java file became which TypeScript file, and what was stubbed or skipped
- `MIGRATION_NOTES.md`: project-wide notes (config, fixtures, environment variables)

### Try it on a sample project

The repository includes two small Selenium projects you can convert in a minute:

| Sample | What it shows |
| --- | --- |
| `examples/selenium-testng-sample/` | A minimal TestNG suite with two page objects. Good for seeing what the output looks like. |
| `examples/functional-equivalence-target/` | A Selenium + TestNG login suite against the public demo site [saucedemo.com](https://www.saucedemo.com). The converted tests pass against the live site after two small hand edits, documented in [`examples/functional-equivalence-output/MANUAL_EDITS.md`](./examples/functional-equivalence-output/MANUAL_EDITS.md). |

```bash
git clone https://github.com/javvadivijayprasad/sel2pw.git
cd sel2pw
npx @vijaypjavvadi/sel2pw convert examples/functional-equivalence-target --out ./saucedemo-pw
cd saucedemo-pw
npm install && npx playwright install chromium
npx playwright test --project=chromium
```

With the published v2.0.10, the first run stops on a compile error in `tests/fixtures.ts`: a stray `}` left behind when sel2pw removes `driver.quit()`. This is fixed on `main` ([#26](https://github.com/javvadivijayprasad/sel2pw/pull/26)) and will ship in the next release; until then, delete the extra brace. The second edit, adding `.first()` to one locator, is described in `MANUAL_EDITS.md`.

> **Status — v2.0.x:** Validated against **15 real-world OSS Selenium codebases** (409 Java files; see [STATUS.md](./STATUS.md) for the per-repository matrix): no crashes, every file classified. Ships as an npm package (`@vijaypjavvadi/sel2pw`) and a standalone Windows `.exe`. Frontends: Selenium Java + TestNG/JUnit and Java + Cucumber BDD use the `java-parser` AST extractor with a per-file regex fallback; Selenium C# + NUnit/SpecFlow use a regex/balanced-brace extractor (experimental, validated on a small corpus only). Optional LLM fallback for constructs the rule catalogue does not cover (Anthropic / OpenAI / Gemini; off by default; `ai-governance` sanitisation before any model call). See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

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

## CLI reference

```
sel2pw convert <inputDir> --out <outputDir> [options]
sel2pw analyze <inputDir>
```

Most useful `convert` options:

| Option | What it does |
| --- | --- |
| `--dry-run` | Print the plan without writing files |
| `--dry-run --format=json` | Print machine-readable `conversion-result.json` to stdout without writing files. Default dry-run output remains Markdown; bare `--format` still enables Prettier. |
| `--diff` | Like `--dry-run`, but show diffs against an existing output folder |
| `--validate` | Run `tsc --noEmit` on the output and add the errors to the review report |
| `--format` | Run Prettier over the generated TypeScript |
| `--lang java\|csharp` | Force the source language (auto-detected by default) |
| `--bdd-mode preserve\|flatten` | Cucumber: keep `.feature` files with a playwright-bdd skeleton (default), or turn each scenario into a plain `test()` |
| `--pom-style instance\|factory` | Page objects as classes you create in each test (default) or as a fixture |
| `--no-todo-markers` | Don't add `// TODO(sel2pw):` comments to the output |
| `--llm-fallback` | Off by default. Sends constructs no rule covers to an LLM (`--llm-provider anthropic\|openai\|gemini`). Leave it off if your test code must not leave your machine. |

Run `sel2pw convert --help` for the full list.

### Programmatic API

```ts
import { convert } from "@vijaypjavvadi/sel2pw";

await convert({
  inputDir: "./my-selenium-project",
  outputDir: "./my-playwright-project",
});
```

### Running as a service (optional)

sel2pw can also run as an HTTP service (port 4200) inside a larger test-automation platform. Most users don't need this. See [INTEGRATION.md](./INTEGRATION.md) and the [deployment guide](./docs/Sel2pw_Deployment_Guide.md).

## Architecture

```
src/
├── cli.ts              # command-line entry point
├── index.ts            # public convert() / analyze() API
├── types.ts            # intermediate representation (IR) shared by all stages
├── scanner/            # walk the input folder, classify each file, detect the stack
├── parser/             # javaAst.ts (main Java parser), javaExtractor.ts (fallback),
│                       # csharpExtractor.ts (experimental), featureParser.ts (Cucumber)
├── transformers/       # the rewrite rules: apiMap, advancedApiMap, assertionMap,
│                       # hamcrestMap, javaIdiomMap, locatorMapper, bodyTransformer, ...
├── emitters/           # write page objects, specs, fixtures, enums, errors, stubs
├── reports/            # CONVERSION_REVIEW.md, FILE_MAPPING.md, MIGRATION_NOTES.md, JSON
├── post/               # optional passes: tsc / ESLint validation, Prettier, LLM fallback
├── server/ + server.ts # optional HTTP service
└── stretch/            # experimental features (BDD flattening, parity checks, C# design)

templates/              # package.json, playwright.config.ts, tsconfig.json for the output
examples/               # sample input projects and their converted output
tests/                  # unit, snapshot and real-world fixture tests (Vitest)
```

The IR boundary is deliberately clean. For Java, `parser/javaAst.ts` (a `java-parser`/Chevrotain CST walker) is the canonical extractor; `parser/javaExtractor.ts` is a regex+balanced-brace extractor used as a per-file fallback when the AST parse throws or `java-parser` is unavailable, and the run log records each fallback. For C#, `parser/csharpExtractor.ts` is regex+balanced-brace only — there is no C# AST parser yet, so C# support should be read as experimental.

## Known limitations

Everything below is flagged in `CONVERSION_REVIEW.md` when it shows up in your code.

- **Locators that match several elements.** Selenium's `findElement` quietly uses the first match; Playwright fails in strict mode. You may need to add `.first()` by hand ([#15](https://github.com/javvadivijayprasad/sel2pw/issues/15)).
- **Newer Java syntax** such as lambdas (`x -> ...`), method references (`::`), casts and try-with-resources is not rewritten yet, so it shows up as TypeScript compile errors ([#20](https://github.com/javvadivijayprasad/sel2pw/issues/20)).
- **`@DataProvider`** becomes a test with a `TODO(sel2pw)` comment pointing at Playwright's [parameterised-test pattern](https://playwright.dev/docs/test-parameterize). Finish the loop by hand.
- **`@Test(groups=...)`** becomes a comment; add Playwright [tags](https://playwright.dev/docs/test-annotations#tag-tests) by hand.
- **iframes** (`switchTo().frame(...)`) become comments suggesting `page.frameLocator(...)`; scope the following locators by hand.
- **Helper classes with no Playwright equivalent** (Excel readers, report managers, retry analyzers, listeners) become typed stubs in `tests/_legacy-stubs/`. Each call throws until you replace it.
- **C# / NUnit / SpecFlow** support is experimental: the project structure is produced, but many C# idioms are not rewritten yet ([#19](https://github.com/javvadivijayprasad/sel2pw/issues/19)).

## Roadmap

Open work is tracked in [GitHub issues](https://github.com/javvadivijayprasad/sel2pw/issues); the older punch list lives in [PRODUCTION_TASKS.md](./PRODUCTION_TASKS.md). Completed phases:

| Phase | Status | Headline |
| --- | --- | --- |
| 0 — Platform integration | ✅ Complete | HTTP service at `:4200`, gateway routes, governance sidecar, self-healing shim, shared types, Docker |
| 1 — Hardening | ✅ Complete | Real AST parser (`java-parser`) with regex fallback, unit + snapshot tests, error recovery, structured logger |
| 2 — Coverage gaps | ✅ Complete | `@DataProvider`, BaseTest → fixture, `testng.xml`, `Actions`, `executeScript`, iframe, alert, cookies, uploads, Hamcrest, JUnit 4/5, `.properties` → `.env` |
| 3 — Output quality | ✅ Complete | Prettier, `tsc` validate, TODO markers, `auth.setup.ts`, `MIGRATION_NOTES.md`, `--diff` |
| 4 — Distribution | ✅ Complete | LICENSE, CI matrix, release workflow, Dependabot, typedoc, Changesets, CONTRIBUTING |
| 5 — Stretch | ✅ Scaffolds | Cucumber BDD, **auto-fix loop**, hybrid AST+LLM, behaviour-parity verifier, C#/SpecFlow design |

## Contributing

Contributions are welcome, including first-timers. Issues labelled [good first issue](https://github.com/javvadivijayprasad/sel2pw/labels/good%20first%20issue) come with the files to look at and a "done when" checklist. Comment on one to claim it.

```bash
git clone https://github.com/javvadivijayprasad/sel2pw.git
cd sel2pw
npm install
npm run build
npm test                 # unit + snapshot tests
npm run lint             # ESLint + tsc
npm run convert:sample   # convert the bundled sample into examples/output-playwright/
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how the pipeline is organised and how to add a new rule.

## Citation

If you use `@vijaypjavvadi/sel2pw` in academic work, please cite:

> Javvadi, V. P. (2026). *@vijaypjavvadi/sel2pw: A Deterministic, Rule-Based Migration Toolkit from Selenium Test Suites to Playwright TypeScript Scaffolds* (Version 2.0.10) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.23437407 (concept DOI, all versions: https://doi.org/10.5281/zenodo.20450292)

A machine-readable [`CITATION.cff`](CITATION.cff) file is included in the repository root.

## License

MIT
