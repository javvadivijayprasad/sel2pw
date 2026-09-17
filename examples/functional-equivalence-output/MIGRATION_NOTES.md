# Migration Notes

Source: `/sessions/blissful-stoic-mendel/mnt/Converter/examples/functional-equivalence-target`
Output: `/sessions/blissful-stoic-mendel/mnt/Converter/examples/functional-equivalence-output`

## Stats

- Files scanned: **4**
- Page Objects converted: **2**
- Test classes converted: **1**
- Test methods converted: **2**

## What to install in the new project

```bash
npm install
npx playwright install
```

## What you can delete from your old project

Once the converted suite is green, the following Maven dependencies are no longer needed:

- `org.seleniumhq.selenium:selenium-java`
- `org.testng:testng`
- `io.cucumber:cucumber-java` (if you used Cucumber)
- `org.hamcrest:hamcrest` (assertions handled by `expect()`)
- `io.github.bonigarcia:webdrivermanager` (Playwright manages browsers itself)

The old `pom.xml` and `testng.xml` can be archived once you verify the Playwright suite covers the same behaviour.

## What changed in your test runtime

- **Auto-waits.** Playwright auto-waits on locators before acting; explicit `WebDriverWait` and `ExpectedConditions` were removed throughout. Every `locator.click()` / `.fill()` / `.innerText()` waits up to `actionTimeout` (default 30s) for the element to become attached, visible, stable, and able to receive events. You almost never need to write a wait yourself for an element-action.
- **`Thread.sleep` was kept (mapped to `page.waitForTimeout`) but flagged with TODO markers.** Each one is a Selenium-era hack that often becomes redundant under Playwright's auto-waits. Search the converted output for `TODO(sel2pw)` near `waitForTimeout` calls and verify whether each one is still needed — most can be removed without changing behavior, and tests run faster afterward.
- **Real conditional waits** (URL changes, network responses, custom predicates) — use `await page.waitForURL(...)`, `await page.waitForResponse(...)`, or `await page.waitForFunction(() => ...)` rather than `Thread.sleep`.
- **Implicit waits** (`driver.manage().timeouts().implicitlyWait(...)`) were removed — set `use.actionTimeout` and `use.navigationTimeout` in `playwright.config.ts` instead.
- **Async everywhere.** Every action is `await`ed. Page Object methods return `Promise<T>`.
- **Browser management.** Configured via `playwright.config.ts → projects`. Use `BASE_URL` env to point at staging vs prod.
- **Parallelism.** `fullyParallel: true` by default. `testng.xml`'s thread-count was preserved as a comment in the generated config.
- **Reporting.** HTML reporter emits to `playwright-report/`; run `npm run report` to view.

## CI changes

Replace your Maven test stage:

```yaml
# before
- run: mvn test

# after
- run: npm ci
- run: npx playwright install --with-deps
- run: npx playwright test
```

## Verifying behavioural parity

The recommended approach: run *both* suites against the same staging environment for one or two sprints. Watch for tests that pass in Selenium but fail in Playwright (or vice versa). Common causes:

- Implicit waits in Selenium that masked race conditions — Playwright's stricter timing exposes them.
- `getText()` returning visible text in Playwright vs full text content in Selenium — use `textContent()` if you need the latter.
- Locator semantics: `By.linkText` is fuzzy in Selenium; we mapped it to `getByRole('link', { name })` which is stricter.

## See also

- [`CONVERSION_REVIEW.md`](./CONVERSION_REVIEW.md) — line-level review punch list.
- [`README.md`](./README.md) — how to run and configure the project.
- Playwright docs: <https://playwright.dev/docs/intro>
