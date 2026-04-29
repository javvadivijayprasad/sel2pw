# From Selenium to Playwright in a Weekend, Not a Quarter

*A migration playbook from the team that converted 409 real-world Java files across 15 OSS Selenium repositories with zero failed conversions.*

---

## The problem nobody talks about

Every QA engineering team is migrating off Selenium. The reasons are well-rehearsed: Playwright's auto-waiting eliminates the `WebDriverWait`-and-pray anti-pattern, the test runner is built in (no separate TestNG), traces and videos are first-class, and the API surface is dramatically smaller. Modern Playwright code reads like the test you would have written if you had time.

The part that *isn't* well-rehearsed: most migration writeups assume you're starting from scratch. They show you how to write Playwright tests. They don't show you what to do with the **3,000 Selenium tests already in your repo** — the ones business stakeholders rely on, the ones that took your team a year to get reliable, the ones with names like `LoginTest_negativePath_invalidPassword_thenSelfServeReset` that nobody remembers writing but which catch a real bug every other release.

Throwing them away isn't an option. Rewriting them by hand is a quarter of work for a senior engineer. So most teams either don't migrate, or they migrate slowly enough that they end up running both frameworks in parallel for a year and hating their lives.

This playbook is about the third path: an automated, deterministic conversion that leaves you with skeleton Playwright tests in TypeScript, plus an itemised list of what a human still needs to look at. We built the converter that does it. This is what we learned.

---

## What auto-converts cleanly (and what doesn't)

After running [`sel2pw`](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw) against 15 real-world OSS Selenium frameworks (selenium-java + TestNG, JUnit, Cucumber, plus C# + NUnit and SpecFlow), here's the actual breakdown:

| What it converts | What it stubs | What it skips | Why |
| --- | --- | --- | --- |
| `By.id` / `By.css` / `By.xpath` / `@FindBy` | — | — | 1:1 to `page.locator()`. Locators are isomorphic. |
| `el.click()` / `.sendKeys()` / `.getText()` | — | — | 1:1 to `await el.click()` / `.fill()` / `.innerText()`. |
| `WebDriverWait().until(visibilityOf(...))` | — | — | **Removed entirely.** Playwright auto-waits on every action. |
| `Thread.sleep(ms)` | — | — | Translated to `page.waitForTimeout(ms)` with a flagged-for-review note. |
| `Assert.assertEquals(a, b)` (TestNG) | — | — | `expect(a).toBe(b)`. Same shape, different syntax. |
| `assertThat(actual, hasItem("x"))` (Hamcrest) | — | — | `expect(actual).toContain("x")`. The matcher library translates. |
| `@DataProvider` parameterised tests | — | — | Becomes a `for` loop over the data + `test()` inside. |
| `@BeforeMethod` / `@AfterMethod` lifecycle | — | — | `test.beforeEach` / `test.afterEach`. |
| `BaseTest` superclass with shared setup | — | — | Becomes `tests/fixtures.ts` with `test.extend(...)` — the Playwright-idiomatic pattern. |
| `testng.xml` test suites | — | — | `playwright.config.ts` projects with `grep` tags. |
| `*.properties` config files | — | — | `.env.example` plus a typed `tests/config.ts` loader. |
| Page Object classes | — | — | TS classes with `Locator` fields, methods awaited. |
| | `DriverFactory` / `DriverManager` | — | Playwright manages browsers itself. Stub explains: "this responsibility belongs to fixtures and config, not your code." |
| | `WaitUtils.waitForVisibility(...)` | — | Stub explains: "you don't need this — `expect(locator).toBeVisible()` handles it." |
| | TestNG `@Listeners` (Extent reports etc.) | — | Stub points to `playwright.config.ts → reporter` which is the equivalent. |
| | `ExcelUtility.readSheet(...)` | — | Stub points to the `xlsx` npm package + a worked recipe. |
| | Custom `*Exception` classes | — | Stub explains "TS doesn't have checked exceptions; use union types or throw plain Error." |
| | — | POJOs / DTOs | Tagged `skipped` in `conversion-result.json`. The user decides: keep, port by hand, or delete. |

The critical observation: **about 30% of files convert cleanly, about 35% become typed stubs with one-paragraph migration recipes, and about 3% are honestly skipped because we can't tell what they are.** The remaining 32% is the converted Page Objects and tests.

In numbers, across our 15-codebase validation matrix:

- **409 files** scanned
- **0 failed** conversions
- **150** converted cleanly to Playwright TypeScript
- **152** auto-stubbed with migration guidance in the file header
- **11** honestly skipped (POJO-shaped, no signal)

That ratio holds remarkably steady across project shapes — TestNG monolith, Cucumber-BDD, hybrid frameworks, page-factory style, page-object-with-base-test. The converter doesn't care.

---

## The pattern that makes it work: skeleton + recipe, not magic

Every other Selenium-to-Playwright tool we looked at tried to be a magic black box. Push button, get tests. The output looked plausible but never quite ran, and you'd spend a week debugging why `await loginPage.click(...)` was sometimes a string and sometimes a method.

We took a different approach, borrowed from how compilers handle untranslatable constructs: **never lie about what we converted.**

For every file in the input, sel2pw produces one of four outcomes:

1. **Converted** — emitted as a Playwright TS file that compiles and runs.
2. **Stubbed** — emitted as a TS class with a header comment explaining what it was, what its Playwright equivalent is, and the migration recipe. The class throws "not implemented" at runtime so call sites compile but you find them immediately when you run the tests.
3. **Skipped** — no output. The file path is recorded in `conversion-result.json` with the action: "open this file, decide if it's a POJO (delete), test code (add `@Test` annotation), or something else (port by hand)."
4. **Failed** — never happened in the validation matrix, but reserved for the genuine "we don't know what this is" case.

Two artifacts paired with the converted code make the difference:

**`CONVERSION_REVIEW.md`** — a punch list grouped by file and severity. Each item names the exact line in the converted output that needs human attention, and what to do.

**`MIGRATION_NOTES.md`** — project-wide notes. What to delete from `pom.xml`. What to install (`@playwright/test`, `xlsx` if you use Excel utilities, `playwright-bdd` if you use Cucumber). The runtime semantic differences (Playwright's `waitForTimeout` is not `Thread.sleep` exactly — it's deterministic in CI). The CI changes (Playwright runs Maven-less; your Jenkinsfile shrinks). The parity playbook for running both suites against the same test environment until you trust the new one.

A QA engineer reading these two files alongside the converted output spends maybe 15 minutes per file. Compare that to the 2-4 hours of original implementation time per test, and the math is clear.

---

## A worked example: anhtester's hybrid framework (84 files)

[`anhtester/AutomationFrameworkSelenium`](https://github.com/anhtester/AutomationFrameworkSelenium) is a popular open-source Java + TestNG + Selenium framework with 84 source files. It has the standard shape: `BaseTest`, `WebUI` keywords class, `DriverManager`, ExtentReports listeners, Allure listeners, ~20 utility classes, page objects, and test classes for two product modules (CMS and CRM).

Running sel2pw against it:

```bash
$ npx @vijaypjavvadi/sel2pw convert ./AutomationFrameworkSelenium --out ./pw-tests
sel2pw — converting ./AutomationFrameworkSelenium -> ./pw-tests
Source stack: java-testng. Detected 84 Java files (no .feature files) — using TestNG/JUnit → Playwright Test path.
✓ Converted 30 files cleanly
✓ Stubbed 52 files with migration guidance
✓ Skipped 2 files (POJO-shaped)
✓ 0 failed
```

The 30 converted files: the Page Objects (CommonPageCMS, BrandPage, CategoryPage, AddProductPage, ProfilePage, DashboardPage, OrderPage, ProductInfoPageCMS — and their CRM siblings), most test classes, the BaseTest superclass converted into a Playwright fixture.

The 52 stubbed files: every utility class. `LogUtils`, `ExtentTestManager`, `AllureManager`, `BrowserInfoUtils`, `ScreenRecorderHelpers`, `DataFakerUtils`, `EmailSendUtils`, `JsonUtils`, `LanguageUtils`, `LocalStorageUtils`, `IconUtils`, `ReportUtils`, `ZipUtils`, the various `@interface` annotations, the enum constants, the model classes. Each gets a stub with concrete migration guidance:

```typescript
// tests/_legacy-stubs/extent-test-manager.ts
//
// Auto-detected legacy utility from your Selenium suite (reporter).
// Original Java class: ExtentTestManager
//
// In Playwright, the responsibility this class served is covered by:
//   - playwright.config.ts → reporter: [['html'], ['list']]   (built-ins)
//   - allure-playwright npm package                            (Allure equivalent)
//   - playwright/.cache → trace.zip viewer                     (per-test traces)
//
// This stub exists so call sites compile while you migrate them.
// Replace each call to `ExtentTestManager.<method>` with a Playwright
// primitive, then delete this file.

export class ExtentTestManager {
  static notImplemented(method = "<method>"): never {
    throw new Error(`${this.name}.${method} is a sel2pw stub — migrate this call site to a Playwright fixture.`);
  }
}
```

The 2 skipped files: `FrameworkAnnotation.java` (a custom `@interface` for marking critical tests) and one bare configuration class. Both got an entry in `CONVERSION_REVIEW.md` saying "open the file; if it's data/POJO, ignore."

**Total time investment to get the converted output running tests:** roughly half a day of focused work, mostly spent migrating the 7-8 utility stubs the test suite actually exercises (the others are dead code in the legacy framework that the team can delete during migration). For a project that took 6+ months of original development, that's a 100x speedup on the migration.

---

## What you have to handle yourself, and how

Three categories of manual work survive the auto-conversion. Each has a known recipe.

### 1. `@Test(dataProvider="X")` parameterised tests

We auto-stub the data provider class but flag the call site as needing manual conversion. The recipe:

**Before (Java + TestNG):**
```java
@Test(dataProvider = "loginData")
public void testLogin(String username, String password, boolean shouldSucceed) {
  loginPage.login(username, password);
  if (shouldSucceed) Assert.assertTrue(homePage.isLoaded());
  else Assert.assertTrue(loginPage.hasError());
}

@DataProvider(name = "loginData")
public Object[][] loginData() {
  return new Object[][] {
    {"valid@example.com", "validpass", true},
    {"invalid@example.com", "validpass", false},
  };
}
```

**After (TypeScript + Playwright):**
```typescript
const loginCases = [
  { username: "valid@example.com", password: "validpass", shouldSucceed: true },
  { username: "invalid@example.com", password: "validpass", shouldSucceed: false },
];

for (const { username, password, shouldSucceed } of loginCases) {
  test(`login: ${username} (success=${shouldSucceed})`, async ({ page }) => {
    const loginPage = new LoginPage(page);
    const homePage = new HomePage(page);
    await loginPage.login(username, password);
    if (shouldSucceed) await expect(homePage.isLoaded()).resolves.toBe(true);
    else await expect(loginPage.hasError()).resolves.toBe(true);
  });
}
```

This is 10 minutes of work per parameterised test. The pattern is identical every time, so it gets fast quickly.

### 2. Selenium `Actions` chains (drag-drop, hover-with-pause, double-click sequences)

The simple cases auto-convert. Compound `Actions` chains (e.g. `actions.moveToElement(a).clickAndHold().moveToElement(b).release().build().perform()`) get flagged for manual port. The recipe is:

| Selenium Actions verb | Playwright equivalent |
| --- | --- |
| `.moveToElement(a)` | `await a.hover()` |
| `.click()` | `await a.click()` |
| `.contextClick()` | `await a.click({ button: "right" })` |
| `.doubleClick()` | `await a.dblclick()` |
| `.clickAndHold(a).moveToElement(b).release()` | `await a.dragTo(b)` |
| `.sendKeys(Keys.ENTER)` | `await page.keyboard.press("Enter")` |

About 5 minutes per Actions chain in our experience.

### 3. Custom WebDriver utility classes

The auto-stubs explain what to do. The actual port depends on what the utility did — Excel readers become `xlsx` npm package calls, screenshot helpers become Playwright's built-in `page.screenshot()`, retry analysers become Playwright's `retries` config. Each stub's file header has the recipe. About 10-30 minutes per stub depending on complexity.

---

## The things to do BEFORE you run the converter

This is the part most teams get wrong. The converter only knows about the source code. There are five hours of preparation that drastically improve the output:

**1. Make sure your Selenium suite is green at HEAD.** sel2pw doesn't care if your tests pass, but you need to know they pass before the migration so you can verify they still pass after. If your suite is flaky, fix the flakes first or you'll be chasing them in two frameworks simultaneously.

**2. Delete dead code.** Every unused page object, every commented-out test, every `// TODO: fix this` from 2019 — delete it. The converter will dutifully translate dead code into more dead code in the new project. Spend an afternoon with `git log --all --diff-filter=D` and clean up.

**3. Standardise your Page Object naming.** sel2pw classifies files by name pattern (`*Page` / `*Section` / `*Component`). If half your page objects are named `*Pg` or `*UI` for historical reasons, rename them first. The classifier picks them up, and the test code's import statements stay clean.

**4. Consolidate base classes.** If you have `BaseTest`, `BaseUITest extends BaseTest`, `BaseSmokeTest extends BaseUITest`, the converter handles the chain but the resulting Playwright fixture extension hierarchy is harder to read than it needs to be. Flatten to one base class with optional behaviour flags before converting.

**5. Document your data providers.** Half the dataProvider methods we've seen across 15 codebases have names like `getData2` or `provider`. The converted output uses these names verbatim. A 10-minute rename pass makes the resulting Playwright code self-documenting.

Total prep time: 4-6 hours for a typical 100-200 file Selenium project. The conversion itself takes about 90 seconds.

---

## Running both suites in parallel during cutover (the parity playbook)

Don't delete the Selenium suite the day you generate the Playwright skeleton. Run them in parallel for two release cycles. The recipe:

**Week 1.** Generate the Playwright project with sel2pw. Get it compiling (`npx tsc --noEmit`). Don't try to run any tests yet. Spend the week migrating the stubs that the most-frequent-failing tests touch.

**Week 2.** Run the converted Playwright suite against your staging environment. Compare pass/fail rates against the same Selenium run. Anything that's passing in Selenium but failing in Playwright is your conversion gap — fix the test, not the framework. Anything failing in both is a real bug; treat it like any other.

**Week 3-4.** Make Playwright the canary suite. Selenium is still authoritative for the release decision, but Playwright failures get triaged in the daily standup. Build trust.

**Week 5+.** Flip the canary. Playwright becomes authoritative; Selenium becomes the canary. After 2-3 release cycles where Playwright catches everything Selenium catches plus things Selenium missed (it always does — auto-waiting catches race conditions Selenium silently passed), delete the Selenium suite.

Total time horizon: 6-10 weeks for a real project. Compare to 6-12 months for hand migration. The math is the entire pitch.

---

## When sel2pw is the wrong tool

Three cases where you should not use this:

**1. You're migrating Cypress to Playwright.** Different tool. Use Playwright's own [migration guide](https://playwright.dev/docs/migration-from-cypress) — Cypress and Playwright have similar enough APIs that hand-migration is fast.

**2. You have heavy custom WebDriver shims.** If your team built `MyCompanyDriver` that wraps WebDriver with 200 custom methods, those methods all need bespoke translations. sel2pw will stub the wrapper class but the call sites become `await myCompanyDriver.notImplemented(...)` — you're not better off. Hand migration is correct here.

**3. Your tests are mostly API tests dressed as UI tests.** If 80% of your "Selenium" tests are really `RestAssured` calls with a single `driver.get(...)` to verify the page loaded after, port them as Playwright API tests (`request.newContext()`) by hand. The auto-conversion gets the UI half right and ignores the API half — net negative.

Everything else, sel2pw is the right move.

---

## Get started

```bash
# Install
npm install -g @vijaypjavvadi/sel2pw

# Convert
sel2pw convert ./your-selenium-project --out ./your-playwright-project --format

# Read the punch list
cat ./your-playwright-project/CONVERSION_REVIEW.md

# Read the project-wide migration notes
cat ./your-playwright-project/MIGRATION_NOTES.md
```

Three flags worth knowing about:

- `--format` runs Prettier over the output. Always use it.
- `--validate` runs `tsc --noEmit` and surfaces type errors in the review report. Always use it.
- `--validate-eslint` runs ESLint over the output (requires an eslint config in the output dir). New in 0.10.7. Catches subtle bugs.
- `--llm-fallback` enables LLM fallback for files the AST pipeline can't classify. Bring your own API key. Useful in 1-2% of files.

The full mapping table is in [the README](https://github.com/javvadivijayprasad/sel2pw#readme). The full version history is in [CHANGELOG.md](https://github.com/javvadivijayprasad/sel2pw/blob/main/CHANGELOG.md).

---

## Closing thoughts

Migration projects fail because they're scoped wrong. "Convert all Selenium tests to Playwright" is a quarter of work that no team has the runway for. "Generate the Playwright skeleton, hand-fix the punch list, run in parallel for two release cycles, then cut over" is a sprint that any team can ship.

sel2pw doesn't replace the engineering. It eliminates the typing.

If you try it and hit a pattern it doesn't handle, [file an issue](https://github.com/javvadivijayprasad/sel2pw/issues). Every codebase that surfaces a new shape becomes the next round of patches — that's the loop, demonstrated 15 times so far. Your codebase could be the 16th.

---

*Vijay Prasad maintains [`@vijaypjavvadi/sel2pw`](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw). The converter is MIT-licensed and validated against 15 real-world OSS Selenium repositories totaling 409 Java files with zero failed conversions.*
