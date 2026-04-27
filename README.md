# sel2pw — Selenium Java/TestNG → Playwright TypeScript converter

Most teams are migrating off `selenium-java + TestNG` (and their BDD/Cucumber and C#/SpecFlow cousins) onto Playwright. The painful part isn't writing new tests — it's the *thousands of existing ones* you can't afford to throw away.

`sel2pw` is a CLI **and a platform service** that takes a Java/Selenium/TestNG project and emits an equivalent Playwright TypeScript project, plus a markdown review report listing everything a human still needs to look at.

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

| Selenium / TestNG | Playwright TypeScript |
| --- | --- |
| `driver.get(url)` | `await page.goto(url)` |
| `By.id("x")` | `page.locator('#x')` |
| `By.cssSelector("…")` | `page.locator('…')` |
| `By.xpath("…")` | `page.locator('xpath=…')` |
| `By.linkText("Sign out")` | `page.getByRole('link', { name: 'Sign out' })` |
| `By.name("q")` | `page.locator('[name="q"]')` |
| `@FindBy(id="x") WebElement el` | `readonly el: Locator;` (initialised in ctor) |
| `el.click()` | `await el.click()` |
| `el.sendKeys("…")` | `await el.fill('…')` |
| `el.getText()` | `await el.innerText()` |
| `el.isDisplayed()` | `await el.isVisible()` |
| `Assert.assertEquals(a, b)` | `expect(a).toBe(b)` |
| `Assert.assertTrue(x)` | `expect(x).toBe(true)` |
| `@Test` | `test('name', async ({ page }) => { ... })` |
| `@BeforeMethod` | `test.beforeEach(...)` |
| `@BeforeClass` | `test.beforeAll(...)` |
| `WebDriverWait...until(...)` | _removed — Playwright auto-waits on locators_ |
| `Thread.sleep(ms)` | `await page.waitForTimeout(ms)` _(flagged: prefer waiting on a real condition)_ |
| Page Object class | TS class with `page: Page` + `Locator` fields |
| `BaseTest` (lifecycle in superclass) | Flagged → port to Playwright fixture |

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

## License

MIT
