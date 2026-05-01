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

    const tsParams = method.params
      .map((p) => `${p.name}: ${javaTypeToTs(p.javaType)}`)
      .join(", ");
    const fixtureSig = tsParams ? `{ page }, ${tsParams}` : `{ page }`;

    if (method.groups && method.groups.length) {
      lines.push(`  // groups: ${method.groups.join(", ")}`);
    }
    if (method.javadoc) {
      for (const docLine of method.javadoc.split("\n")) {
        lines.push("  " + docLine);
      }
    }

    lines.push(`  test(${JSON.stringify(title)}, async (${fixtureSig}) => {`);
    const body = rewriteAwaitOnPageObjectCalls(transformed.body, ir.pageObjectTypes);
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
    case "BeforeClass":
    case "BeforeSuite":
      return "test.beforeAll";
    case "AfterMethod":
    case "AfterTest":
      return "test.afterEach";
    case "AfterClass":
    case "AfterSuite":
      return "test.afterAll";
    default:
      return "test.beforeEach";
  }
}

/**
 * Prefix `await` to instance-method calls on Page Object variables, e.g.
 *   loginPage.open(...)        ->   await loginPage.open(...)
 *   homePage.getWelcomeText()  ->   await homePage.getWelcomeText()
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
    out = out.replace(re, (_m, pre: string, call: string) => `${pre}await ${call}`);
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
