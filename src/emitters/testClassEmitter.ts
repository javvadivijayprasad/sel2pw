import { ConvertedFile, ReviewItem, TestClassIR } from "../types";
import { transformMethodBody } from "../transformers/bodyTransformer";
import { javaTypeToTs, testFileName, toCamelCase } from "../utils/naming";
import { dedentAndIndent } from "../utils/indent";

/**
 * Render a TestNG test class IR as a Playwright spec file.
 *
 *   import { test, expect } from '@playwright/test';
 *   import { LoginPage } from '../pages/login.page';
 *
 *   test.describe('LoginTest', () => {
 *     let loginPage: LoginPage;
 *     test.beforeEach(async ({ page }) => {
 *       loginPage = new LoginPage(page);
 *       ...
 *     });
 *     test('valid login', async ({ page }) => { ... });
 *   });
 */
export function emitTestClass(
  ir: TestClassIR,
  sourceFilePath: string,
): ConvertedFile {
  const warnings: ReviewItem[] = [];
  const lines: string[] = [];

  // Imports
  lines.push(`import { test, expect } from '@playwright/test';`);
  for (const pageType of ir.pageObjectTypes) {
    const file = `../pages/${pageObjectImportPath(pageType)}`;
    lines.push(`import { ${pageType} } from '${file}';`);
  }
  lines.push("");

  lines.push(`test.describe('${ir.className}', () => {`);

  // Page Object instance vars
  for (const pageType of ir.pageObjectTypes) {
    lines.push(`  let ${toCamelCase(pageType)}: ${pageType};`);
  }
  if (ir.pageObjectTypes.length > 0) lines.push("");

  // Lifecycle hooks. We inject Page Object init into the FIRST source-defined
  // hook that maps to test.beforeEach (regardless of whether that's
  // @BeforeMethod, @BeforeTest, or @BeforeEach in the source). If no
  // source hook maps to beforeEach, we synthesise a fresh one below.
  let beforeEachInjected = false;
  for (const hook of ir.lifecycle) {
    const transformed = transformMethodBody(hook.rawBody, sourceFilePath);
    warnings.push(...transformed.warnings);
    const tsHook = mapLifecycle(hook.kind);
    lines.push(`  ${tsHook}(async ({ page }) => {`);
    if (
      tsHook === "test.beforeEach" &&
      !beforeEachInjected &&
      ir.pageObjectTypes.length > 0
    ) {
      for (const pageType of ir.pageObjectTypes) {
        lines.push(`    ${toCamelCase(pageType)} = new ${pageType}(page);`);
      }
      beforeEachInjected = true;
    }
    const body = rewriteAwaitOnPageObjectCalls(transformed.body, ir.pageObjectTypes);
    lines.push(dedentAndIndent(body, "    "));
    lines.push(`  });`);
    lines.push("");
  }

  // If no source hook mapped to beforeEach but we have page objects to
  // initialise, synthesise a dedicated beforeEach.
  if (!beforeEachInjected && ir.pageObjectTypes.length > 0) {
    lines.push(`  test.beforeEach(async ({ page }) => {`);
    for (const pageType of ir.pageObjectTypes) {
      lines.push(`    ${toCamelCase(pageType)} = new ${pageType}(page);`);
    }
    lines.push(`  });`);
    lines.push("");
  }

  // Test methods
  for (const method of ir.testMethods) {
    if (method.dataProvider) {
      warnings.push({
        file: sourceFilePath,
        severity: "manual",
        message: `@Test(dataProvider="${method.dataProvider}") on ${method.name} — convert to a parameterised loop: \`for (const row of ${method.dataProvider}()) { test('...', async ...) }\`. Auto-conversion not yet supported.`,
      });
    }

    const title = method.description || method.name;
    const transformed = transformMethodBody(method.rawBody, sourceFilePath);
    warnings.push(...transformed.warnings);

    // v2.0.2 — when the Java test method has positional params (TestNG
    // @DataProvider, parametrised tests), Playwright's test() callback only
    // takes a fixtures bag, not arbitrary positional args. Leaving the Java
    // params in the signature produced TS2345 ("Expected 4 or more, but got
    // 2") on every parametrised test. Drop them from the signature and emit
    // a TODO comment so the user knows what was elided.
    const tsParams = method.params
      .map((p) => `${p.name}: ${javaTypeToTs(p.javaType)}`)
      .join(", ");
    const fixtureSig = "{ page }";
    const droppedParamsComment =
      tsParams.length > 0
        ? `  // TODO(sel2pw): Java test had positional params (${tsParams}). ` +
          "Playwright tests are functional — convert to a parameterised loop: " +
          "`for (const row of dataProvider()) { test(`name [${row.x}]`, async ({ page }) => { ... }) }`."
        : "";

    if (method.groups && method.groups.length) {
      lines.push(`  // groups: ${method.groups.join(", ")}`);
    }
    if (droppedParamsComment) {
      lines.push(droppedParamsComment);
    }
    if (method.javadoc) {
      for (const docLine of method.javadoc.split("\n")) {
        lines.push("  " + docLine);
      }
    }

    lines.push(`  test(${JSON.stringify(title)}, async (${fixtureSig}) => {`);
    let body = rewriteAwaitOnPageObjectCalls(transformed.body, ir.pageObjectTypes);
    // v2.0.2 — late-pass `this.page` → `page` inside test bodies. Spec files
    // are functional, not class-based, so `this` doesn't exist here. Also
    // catch the `this.page.navigate().to(url)` / `this.page.getTitle()`
    // Selenium-idiom shapes that the apiMap-then-idiomMap order leaves
    // behind (driver -> this.page in idiomMap, then apiMap's navigate/title
    // rules already fired). Single pass, applied AFTER the page-object
    // await-rewrite so we don't accidentally collapse `this.<page>.method()`
    // PageObject-method references.
    body = rewriteThisPageInSpecBody(body);
    lines.push(dedentAndIndent(body, "    "));
    lines.push(`  });`);
    lines.push("");
  }

  lines.push(`});`);
  lines.push("");

  return {
    relPath: `tests/${testFileName(ir.className)}`,
    source: lines.join("\n"),
    warnings,
    kind: "test",
  };
}

function mapLifecycle(kind: string): string {
  switch (kind) {
    case "BeforeMethod":
    case "BeforeTest":
      return "test.beforeEach";
    case "AfterMethod":
    case "AfterTest":
      return "test.afterEach";
    case "BeforeClass":
    case "BeforeAll":
      return "test.beforeAll";
    case "AfterClass":
    case "AfterAll":
      return "test.afterAll";
    default:
      return "test.beforeEach";
  }
}

/**
 * v2.0.2 â rewrite `this.page.X` shapes that leak into test spec bodies.
 *
 * Why this lives at the testClassEmitter level (not in bodyTransformer):
 *   bodyTransformer is also called for Page Object methods, where
 *   `this.page` is a legitimate class field. Only in test-spec bodies is
 *   `this` undefined (Playwright tests are functional). Keeping this
 *   rewrite at the emitter level scopes it correctly.
 *
 * Shapes covered (each was a real error class in the saucelabs-training/
 * demo-java validation run on v2.0.1):
 *   - `this.page.navigate().to(X)`     -> `await page.goto(X)`
 *   - `this.page.getTitle()`           -> `await page.title()`
 *   - any other `this.page.<rest>`     -> `page.<rest>`  (catches
 *                                          `this.page.locator(...)`,
 *                                          `this.page.click(...)`, etc.)
 */
function rewriteThisPageInSpecBody(body: string): string {
  let out = body;
  // Specific shapes first â they emit `await` so we run them before the
  // generic `this.page` strip.
  out = out.replace(
    /this\.page\.navigate\(\)\.to\(([^)]*)\)/g,
    "await page.goto($1)",
  );
  out = out.replace(
    /this\.page\.getTitle\(\s*\)/g,
    "await page.title()",
  );
  // Then strip the bare `this.` prefix from anything that's left.
  out = out.replace(/(?<![\w$.])this\.page(?![\w$])/g, "page");
  return out;
}

/**
 * Prepend `await ` to bare page-object method calls (e.g. `loginPage.go()` ->
 * `await loginPage.go()`) so the emitted spec doesn't leak un-awaited promises.
 *
 * Skips calls already preceded by `await ` to avoid double-await.
 */
function rewriteAwaitOnPageObjectCalls(
  body: string,
  pageObjectTypes: string[],
): string {
  let out = body;
  for (const pt of pageObjectTypes) {
    const inst = toCamelCase(pt);
    const re = new RegExp(`(^|[^\\w.])(?<!await\\s)(${inst}\\.\\w+\\s*\\()`, "gm");
    out = out.replace(re, (_m, pre, call) => `${pre}await ${call}`);
  }
  return out;
}

function pageObjectImportPath(className: string): string {
  // LoginPage / LoginPages              -> login.page
  // LoginPageObject / LoginPageObjects  -> login.page  (added 0.11.1)
  // LoginScreen / LoginView             -> login.page  (mobile/alt convention)
  // (must mirror pageObjectFileName in src/utils/naming.ts)
  return className
    .replace(/(?:PageObjects?|Pages?|Screens?|Views?)$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .concat(".page");
}
