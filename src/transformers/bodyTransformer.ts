import { applyApiRewrites } from "./apiMap";
import { applyAssertionRewrites } from "./assertionMap";
import { applyAdvancedApiRewrites } from "./advancedApiMap";
import { applyHamcrestRewrites } from "./hamcrestMap";
import { applyJavaIdiomRewrites } from "./javaIdiomMap";
import { ReviewItem } from "../types";

/**
 * Transform a raw Java method body into TypeScript-flavoured Playwright code.
 *
 * Steps:
 *   1) Strip Java-specific noise (final, throws clauses on inner try/catch).
 *   2) Apply API rewrites (driver.*, WebElement.*, waits).
 *   3) Apply assertion rewrites (Assert.* → expect()).
 *   4) Cosmetic conversions (System.out.println → console.log, etc.).
 *
 * Emits warnings for patterns we knowingly couldn't fully resolve.
 */
export function transformMethodBody(
  rawBody: string,
  filePath: string,
): { body: string; warnings: ReviewItem[] } {
  const warnings: ReviewItem[] = [];
  let body = rawBody;

  // 1) Strip noise.
  body = body.replace(/\bfinal\s+/g, "");
  body = body.replace(/\bthrows\s+[\w.,\s]+(?=\{|\))/g, "");

  // 1a) Remove Page Object re-init lines that the test class emitter
  //     synthesises in beforeEach itself. Two shapes appear in real codebases:
  //       loginPage = new LoginPage(driver);                 (bare assignment)
  //       LoginPage loginPage = new LoginPage(driver, wait); (typed declaration)
  //     Otherwise the converted spec ends up with duplicated initialisers.
  body = body.replace(
    /^[\t ]*(?:[A-Z]\w*\s+)?\w+\s*=\s*new\s+\w+Page\s*\([^)]*\)\s*;[\t ]*\r?\n?/gm,
    "",
  );

  // 1b) Strip Java-specific driver setup lines that have no Playwright
  //     equivalent. These often live inside @BeforeMethod bodies of test
  //     classes that don't extend BaseTest (so the BaseTest extractor's
  //     own stripper doesn't touch them). Playwright's `page` fixture
  //     provides everything Selenium needed driver setup for.
  body = stripJavaDriverBoilerplate(body);

  // 2) API rewrites — basic mappings.
  const api = applyApiRewrites(body);
  body = api.body;
  for (const note of api.notes) {
    warnings.push({ file: filePath, severity: "info", message: note });
  }

  // 2b) Advanced API rewrites — Actions, executeScript, iframe, alerts, cookies, file uploads.
  const adv = applyAdvancedApiRewrites(body, filePath);
  body = adv.body;
  warnings.push(...adv.warnings);

  // 2c) Java standard-library idioms — `.size()` / `.get(i)` / `.equals()` /
  // `.length()` / `.contains()` / `Integer.parseInt`, type-position rewrites
  // (`String[]` / `WebElement` / `List<WebElement>`), Select-dropdown
  // idiom (`new Select(el).selectByVisibleText(...)`), and custom-helper
  // call sites (`clickElement`, `verifyEquals`, `elementExists` — common
  // in TestNG-style Java frameworks). Added in 0.10.8 — see
  // `docs/CONVERSION_PATTERNS.md` for the full mapping table.
  const idiom = applyJavaIdiomRewrites(body, filePath);
  body = idiom.body;
  warnings.push(...idiom.warnings);

  // 3) Assertions: TestNG/JUnit `Assert.*` then Hamcrest `assertThat(...)`.
  body = applyAssertionRewrites(body);
  body = applyHamcrestRewrites(body);

  // 4) Java -> TS cosmetic.
  body = body.replace(/\bSystem\.out\.println\s*\(/g, "console.log(");
  body = body.replace(/\bSystem\.err\.println\s*\(/g, "console.error(");
  body = body.replace(/\.equals\s*\(\s*([^)]+?)\s*\)/g, " === $1");
  // String.format("foo %s", x) -> `foo ${x}`  (best effort, single placeholder)
  body = body.replace(
    /String\.format\s*\(\s*"([^"]*)"\s*,\s*([^)]+)\)/g,
    (_m, fmt: string, arg: string) => {
      // very crude: replace %s/%d/%f with ${arg} positionally — only safe for one arg
      const args = arg.split(",").map((s) => s.trim());
      let i = 0;
      const out = fmt.replace(/%[sdf]/g, () =>
        i < args.length ? "${" + args[i++] + "}" : "${unknown}",
      );
      return "`" + out + "`";
    },
  );

  // Note: detection-only manual warnings for Actions/JavascriptExecutor/iframe/alert
  // were removed in Phase 2 — the advanced API rewriter (step 2b above) now
  // handles those patterns and emits its own targeted warnings only when the
  // input is too ambiguous to convert.

  // (helpers below)
  // Phase 7 cleanup: when an `if (cond) <stmt>;` had its single statement
  // replaced by a `// comment`, the result is `if (cond) // comment` — TS
  // syntactically requires a body. Wrap the comment in `{ … }` so the output
  // still compiles. Same for `else <comment>`.
  body = body.replace(
    /\b(if|else)\s*\((?:[^)(]|\([^)(]*\))*\)\s*(\/\/[^\n]*)/g,
    (m) => m.replace(/(\/\/[^\n]*)$/, "{ $1 }"),
  );
  // Bare `else //comment` (no parens) — `else` keyword followed by a comment.
  body = body.replace(/\belse\s+(\/\/[^\n]*)/g, "else { $1 }");

  return { body, warnings };
}

/**
 * Strip Java driver-setup lines that have no Playwright equivalent.
 *
 * Patterns covered:
 *   - System.setProperty("webdriver.<browser>.driver", "...");
 *   - WebDriver driver = new ChromeDriver(...);    (declaration form)
 *   - driver = new ChromeDriver(...);              (assignment form)
 *   - JavascriptExecutor js = (JavascriptExecutor) driver;
 *   - js = (JavascriptExecutor) driver;            (bare assignment)
 *   - WebDriverManager.chromedriver().setup();
 *   - driver.manage().window().maximize();
 *   - driver.manage().timeouts().implicitlyWait(...);
 *   - if (driver != null) driver.quit();           (already covered by quit rewrite)
 *
 * These typically appear inside @BeforeMethod / @AfterMethod hooks of test
 * classes that do their own driver lifecycle (rather than inheriting from
 * BaseTest). Playwright's `page` fixture handles all of this.
 */
function stripJavaDriverBoilerplate(body: string): string {
  const stripPatterns: RegExp[] = [
    /^\s*System\.setProperty\s*\(\s*"webdriver\..*"\s*,.*\)\s*;\s*$/,
    /^\s*driver\s*=\s*new\s+(?:Chrome|Firefox|Edge|Safari|Remote|InternetExplorer)Driver\s*\([^)]*\)\s*;\s*$/,
    /^\s*WebDriver\s+driver\s*=\s*new\s+\w+Driver\s*\([^)]*\)\s*;\s*$/,
    /^\s*JavascriptExecutor\s+\w+\s*=\s*\(\s*JavascriptExecutor\s*\)\s*driver\s*;\s*$/,
    /^\s*\w+\s*=\s*\(\s*JavascriptExecutor\s*\)\s*driver\s*;\s*$/,
    /^\s*WebDriverManager\.[a-zA-Z]+\(\)\.setup\(\)\s*;\s*$/,
    /^\s*driver\.manage\(\)\.window\(\)\.maximize\(\)\s*;\s*$/,
    /^\s*driver\.manage\(\)\.timeouts\(\)\.\w+\([^)]*\)(?:\.\w+\([^)]*\))*\s*;\s*$/,
    /^\s*if\s*\(\s*driver\s*!=\s*null\s*\)\s*driver\.quit\(\)\s*;\s*$/,
    /^\s*driver\.manage\(\)\.window\(\)\.fullscreen\(\)\s*;\s*$/,
  ];
  return body
    .split("\n")
    .filter((line) => !stripPatterns.some((re) => re.test(line)))
    .join("\n");
}
