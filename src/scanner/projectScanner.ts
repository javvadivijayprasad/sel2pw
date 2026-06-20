import * as path from "path";
import * as fs from "fs-extra";
import fg from "fast-glob";
import { JavaFile, SourceKind } from "../types";

/**
 * Walk an input directory, find all .java files, and classify each.
 *
 * Classification heuristics (cheap and fast — full classification happens
 * after extraction):
 *   - contains "@Test"                              -> test-class
 *   - extends BaseTest / TestBase                   -> test-class
 *   - has WebDriver field + By./@FindBy             -> page-object
 *   - class name ends in "Page"                     -> page-object
 *   - class name matches BaseTest|TestBase|*Base    -> base
 *   - otherwise                                     -> unknown
 */
export async function scanProject(inputDir: string): Promise<JavaFile[]> {
  const absInput = path.resolve(inputDir);
  if (!(await fs.pathExists(absInput))) {
    throw new Error(`Input directory does not exist: ${absInput}`);
  }

  const javaFiles = await fg(["**/*.java", "**/*.cs"], {
    cwd: absInput,
    absolute: true,
    ignore: [
      "**/target/**",
      "**/build/**",
      "**/bin/**",
      "**/obj/**",
      "**/.idea/**",
      "**/node_modules/**",
    ],
  });

  const results: JavaFile[] = [];
  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, "utf8");
    const packageName = extractPackageName(source);
    const className = extractClassName(source) ?? path.basename(filePath, ".java");
    const kind = classify(className, source);
    results.push({
      path: filePath,
      relPath: path.relative(absInput, filePath).replace(/\\/g, "/"),
      packageName,
      className,
      source,
      kind,
    });
  }

  return results;
}

function extractPackageName(source: string): string {
  const m = source.match(/^\s*package\s+([\w.]+)\s*;/m);
  return m ? m[1] : "";
}

// Java reserved words — these cannot be class names. If the regex below
// captures one of these (most commonly happens when a Javadoc says
// "class for handling X" — matching `class for` literally), reject and
// fall through to the next match (or fall back to the file basename).
const JAVA_RESERVED = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new", "null",
  "package", "private", "protected", "public", "return", "short", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "true", "false", "try", "void", "volatile", "while", "yield",
  "record", "sealed", "permits", "var",
]);

function extractClassName(source: string): string | null {
  // Strip block comments (Javadoc) and line comments before pattern-matching.
  // Javadocs frequently contain phrases like "class for handling X" which
  // would falsely match the class-declaration regex below, returning "for"
  // as the class name (selenium12/13 made this bug visible — fix in 0.10.4).
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")  // block / Javadoc comments
    .replace(/\/\/[^\n]*/g, "");       // line comments

  // Find ALL declarations and return the first one whose captured name is
  // not a Java reserved word. Belt-and-suspenders on top of the comment
  // strip — strings like `"class for X"` could still sneak through, but
  // the reserved-word filter catches the common cases.
  const re = /^\s*(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|static\s+)*(?:class|enum|interface|record)\s+(\w[\w$]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1];
    if (!JAVA_RESERVED.has(name)) return name;
  }
  return null;
}

function classify(className: string, source: string): SourceKind {
  // Java annotations OR C# attributes — same conceptual signals.
  const hasTestAnnotation =
    /@Test\b/.test(source) || /\[(Test|TestCase|TestMethod|Fact|Theory)\b/.test(source);
  const hasFindBy = /@FindBy\b/.test(source) || /\[FindsBy\b/.test(source);
  const hasByStatic =
    /\bBy\.(id|cssSelector|xpath|name|linkText|partialLinkText|tagName|className)\s*\(/.test(source) ||
    /\bBy\.(Id|CssSelector|XPath|Name|LinkText|PartialLinkText|TagName|ClassName)\s*\(/.test(source);
  const hasWebDriverField =
    /\bWebDriver\s+\w+\s*[;=]/.test(source) || /\bIWebDriver\s+\w+\s*[;=]/.test(source);
  const hasLifecycle =
    /@(Before|After)(Suite|Class|Method|Test)\b/.test(source) ||
    /\[(SetUp|TearDown|OneTimeSetUp|OneTimeTearDown|TestInitialize|TestCleanup|ClassInitialize|ClassCleanup|BeforeScenario|AfterScenario|BeforeFeature|AfterFeature)\b/.test(source);
  const hasSpecFlowBinding =
    /\[Binding\b/.test(source) ||
    /\[(Given|When|Then|And|But)\b/.test(source);
  // Java Cucumber step defs — the canonical signal is `import io.cucumber.*`
  // OR Java annotations matching the BDD step set. We need a SEPARATE check
  // from `hasLifecycle` because a step-def class with a `WebDriver driver`
  // field would otherwise fall into the page-object branch and lose its
  // annotated methods (page-object extraction skips annotated methods).
  const hasJavaSteps =
    /\bimport\s+io\.cucumber\b/.test(source) ||
    /@(Given|When|Then|And|But)\s*\(/.test(source);

  // Shared driver-instantiation predicates — used by both the v2.0 Phase 1
  // data-type checks below AND the v1.0.8 infrastructure check further down.
  const hasThreadLocalDriver =
    /\bThreadLocal\s*<\s*(?:WebDriver|IWebDriver|RemoteWebDriver|EventFiringWebDriver|AppiumDriver)\b/.test(source);
  const instantiatesConcreteDriver =
    /\bnew\s+(?:ChromeDriver|FirefoxDriver|EdgeDriver|SafariDriver|InternetExplorerDriver|OperaDriver|RemoteWebDriver|AndroidDriver|IOSDriver|AppiumDriver)\s*\(/.test(source);

  // ============================================================
  // Phase 1 (v2.0) — richer Java type detection
  // ============================================================
  // Five new kinds that v1.x silently dropped or stubbed:
  //   1. java-enum       -> types/enums.ts (proper TS enum)
  //   2. java-record     -> data/models.ts (TS interface + optional Builder)
  //   3. java-exception  -> types/errors.ts (class X extends Error)
  //   4. owner-config    -> types/config.ts + tests/config.ts (Owner @Config interface)
  //   5. pojo            -> data/models.ts (TS interface from private-fields-with-getters)
  //
  // These must fire BEFORE the listener / page-object branches so that:
  //   - HeadlessNotSupportedException doesn't get stubbed as a "test-util"
  //   - Configuration (Owner @Config interface) doesn't get silently dropped
  //   - Booking record doesn't fall into "unknown" with no review note
  //
  // They DO fire after the infrastructure check so DriverManager etc. still skip
  // (a class can theoretically extend RuntimeException AND be infra; infra wins).

  // 1) Java enum — explicit `enum Name {` keyword on a class-declaration line.
  //    Inner enums inside other classes are intentionally not caught here; they
  //    are handled at emit time when the parent is processed.
  const isJavaEnum =
    /^\s*(?:public\s+|protected\s+|private\s+)?enum\s+\w+\s*(?:implements\s+[\w.,<>\s[\]]+)?\s*\{/m.test(source);

  // 2) Java record (Java 14+) — `public record X(...) { ... }`. Tolerate
  //    `final` and modifier ordering, and tolerate a trailing `implements`.
  const isJavaRecord =
    /^\s*(?:public\s+|protected\s+|private\s+)?(?:final\s+|abstract\s+)?record\s+\w+\s*\(/m.test(source);

  // 3) Java exception — class extends *Exception / *Error / Throwable. We also
  //    catch the canonical "FooException" / "FooError" suffix so projects that
  //    extend their own base exception (BaseException extends RuntimeException)
  //    still classify correctly.
  const extendsThrowable =
    /^\s*public\s+(?:abstract\s+|final\s+)?class\s+\w+\s+extends\s+\w*(?:Exception|Error|Throwable)\b/m.test(source);
  const hasExceptionSuffix =
    /(?:Exception|Error|Throwable)$/.test(className);
  const isJavaException = extendsThrowable || (hasExceptionSuffix && /^\s*public\s+class\b/m.test(source));

  // 4) Owner-library config interface — Aeonbits Owner is the canonical Java
  //    config library. Distinctive signals are `import org.aeonbits.owner.*` +
  //    `interface X extends Config` + `@Key(...)` annotated methods. Any two
  //    of these is enough to be confident.
  const usesOwnerLib = /\borg\.aeonbits\.owner\b/.test(source);
  const isConfigInterface =
    /^\s*(?:public\s+)?interface\s+\w+\s+extends\s+(?:[\w.]+\.)?Config\b/m.test(source);
  const hasOwnerKey = /@Key\s*\(/.test(source);
  const isOwnerConfig =
    (usesOwnerLib && isConfigInterface) ||
    (isConfigInterface && hasOwnerKey) ||
    (usesOwnerLib && hasOwnerKey);

  // 5) POJO — private fields + public getters, no test/locator/driver pollution.
  //    Deliberately conservative: must have at least one `private TYPE name;`
  //    field AND at least one `public TYPE getX()` getter AND no test/page
  //    annotations. We allow @JsonProperty / Lombok-style annotations on fields.
  const hasPrivateField = /^\s*private\s+(?:final\s+)?[\w.<>,\s[\]]+\s+\w+\s*[=;]/m.test(source);
  const hasPublicGetter = /^\s*public\s+[\w.<>,\s[\]]+\s+get[A-Z]\w*\s*\(\s*\)\s*\{/m.test(source);
  const isPojo =
    hasPrivateField &&
    hasPublicGetter &&
    !hasTestAnnotation &&
    !hasFindBy &&
    !hasByStatic &&
    !hasWebDriverField &&
    !hasLifecycle;

  // Guard: pure data types never instantiate a WebDriver. If a class IS
  // declared as enum/record/etc but ALSO has `new ChromeDriver()` style code
  // (eliasnogueira's BrowserFactory is the canonical example — a "factory enum"
  // that constructs drivers), let infrastructure detection below claim it.
  const looksLikeDataType = !instantiatesConcreteDriver && !hasThreadLocalDriver;

  if (isJavaEnum && looksLikeDataType) return "java-enum";
  if (isJavaRecord && looksLikeDataType) return "java-record";
  if (isOwnerConfig && looksLikeDataType) return "owner-config";
  if (isJavaException && looksLikeDataType) return "java-exception";

  // ============================================================
  // (existing v1.x detection follows — listener interfaces, infra, base, etc.)
  // ============================================================

  // Java TestNG listener / utility interfaces. These classes commonly hold
  // a `WebDriver` reference (for screenshot-on-failure) which would
  // otherwise route them through the page-object branch. We want them to
  // fall through to "unknown" so the customUtilDetector can emit typed
  // stubs with reporter / event-listener guidance.
  const hasJavaListenerInterface =
    /\bimplements\s+(?:I(?:Test|Suite|Configuration|Execution|InvokedMethod)?Listener|IReporter|IAnnotationTransformer|IRetryAnalyzer|IRetry|IAlterSuiteListener)\b/.test(source) ||
    /\bextends\s+(?:Tests?Listener|EventFiringWebDriver|AbstractWebDriverEventListener|TestListenerAdapter)\b/.test(source);

  // ActionDriver / ElementAction / WebActions — classes whose name ends in
  // a Selenium-helper suffix BUT that aren't real Page Objects. They wrap
  // a `WebDriver` field plus convenience methods like `clickElement(...)`.
  // Routing them to "unknown" lets customUtilDetector emit a wrapper stub.
  const isWebDriverWrapperShape =
    /^(Action|Element|Web|Custom|Common|Selenium)?(Driver|Actions?|Helper|Utils?)$/.test(className) &&
    className !== "WebDriver" &&
    className !== "IWebDriver" &&
    className !== "By";

  // ============================================================
  // INFRASTRUCTURE detection (v1.0.8) — skip classes that only exist to
  // manage Selenium driver lifecycle. Playwright handles this via fixtures.
  // ============================================================
  // Signals (any one is enough):
  //   - Class name matches DriverManager/DriverFactory/BrowserFactory/WebDriverFactory
  //   - Source uses ThreadLocal<WebDriver> (the canonical thread-local driver pattern)
  //   - Source instantiates a concrete WebDriver (ChromeDriver/FirefoxDriver/etc.)
  //     AND has no @Test method AND no @FindBy locator
  //   - Class name matches *OptionsBuilder / CapabilitiesBuilder
  // These files emit a note in CONVERSION_REVIEW.md but produce NO .ts output.
  // Without this check they would emit broken bodies referencing `driver.get()`,
  // `driver.set()`, `driver.remove()` that have no Playwright equivalent.
  const isInfrastructureName =
    /^(?:DriverManager|WebDriverManager|DriverFactory|WebDriverFactory|BrowserFactory|BrowserManager|DriverProvider|WebDriverProvider|BrowserProvider|SeleniumDriverManager|DriverInitializer|DriverConfiguration|BrowserConfiguration|DriverContext|WebDriverContext)$/.test(className);
  const isPureDriverSetup =
    instantiatesConcreteDriver && !hasTestAnnotation && !hasFindBy;
  const isOptionsBuilder =
    /^(?:ChromeOptionsBuilder|FirefoxOptionsBuilder|EdgeOptionsBuilder|BrowserOptionsBuilder|CapabilitiesBuilder|DesiredCapabilitiesBuilder)$/.test(className);

  // Guard against false positives. Classes that ALSO look like base test
  // classes (BaseTest, TestBase, *Base) or have lifecycle methods are
  // routed to "base" instead — they need fixture emission, not skipping.
  // Same for classes that hold a WebDriver field via dependency injection
  // (constructor-injected DriverManager wrappers used by Page Objects).
  const looksLikeBase =
    /^(?:BaseTest|TestBase|.*Base|.*BaseTest|AbstractTest|AbstractBaseTest|Base\w*|\w*Base|Base\w*Test|Base\w*Spec|Base\w*Web|\w*BaseWeb)$/.test(className) ||
    hasLifecycle;
  if (
    (isInfrastructureName || hasThreadLocalDriver || isPureDriverSetup || isOptionsBuilder) &&
    !looksLikeBase
  ) {
    return "infrastructure";
  }

  // Base classes: name pattern OR (lifecycle methods but no @Test)
  if (/^(?:BaseTest|TestBase|.*Base|Base\w*|\w*Base|AbstractTest|AbstractBaseTest|Base\w*Test|Base\w*Spec|Base\w*Web|\w*BaseWeb)$/.test(className) && !hasTestAnnotation) {
    return "base";
  }

  // Listener/utility interfaces win over page-object — even when they hold
  // a WebDriver field. Falls through to "unknown" so customUtilDetector
  // promotes it to a typed stub with reporter/listener guidance.
  if (hasJavaListenerInterface || isWebDriverWrapperShape) {
    return "unknown";
  }

  // Step-def classes win over page-object even when they have WebDriver
  // fields — their annotated methods need the test-class extractor.
  if (hasTestAnnotation || hasLifecycle || hasSpecFlowBinding || hasJavaSteps) {
    return "test-class";
  }

  // Page-object name patterns. `*Page` is the textbook convention; `*Section`
  // / `*Elements` / `*Component` / `*Locators` show up in larger frameworks
  // that split a page into reusable sub-areas (header section, side menu,
  // etc.). `*PageObject(s)` is a common explicit convention in Selenium
  // codebases that namespace their POs under a `pageobjects/` folder
  // (added in 0.11.1 from real-user feedback). `*Screen` / `*View` show up
  // in projects that came from mobile testing conventions. Anything with
  // @FindBy, By.* or a WebDriver field is also POM-shaped.
  if (
    hasFindBy ||
    hasByStatic ||
    hasWebDriverField ||
    /(?:Page|PageObject|PageObjects|Section|Component|Locators|Elements|Screen|View)$/.test(className)
  ) {
    return "page-object";
  }

  // POJO check fires LAST so it doesn't shadow base/test/page detection above.
  // A class with private fields + getters that also has @Test or @FindBy is a
  // test or page object, not a pojo — those branches above already returned.
  if (isPojo) return "pojo";

  return "unknown";
}
