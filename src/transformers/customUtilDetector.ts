/**
 * Detect custom WebDriver utility classes (DriverFactory, DriverManager,
 * custom Wait helpers, etc.) and decide what to do with them.
 *
 * In v1 we don't try to translate them — most are project-specific
 * boilerplate around `WebDriverManager` or thread-local driver pools that
 * have no Playwright equivalent (Playwright's fixtures and projects already
 * cover the same use cases). The right outcome is: detect, classify, emit a
 * stub TS file so the user has a single grep target, and surface a manual
 * review item explaining why.
 *
 * We detect by class name pattern + by the shape of fields/methods:
 *
 *   class DriverFactory   { static WebDriver get() { … } }
 *   class DriverManager   { ThreadLocal<WebDriver> pool; … }
 *   class WaitUtils       { static void waitForVisibility(WebDriver, By) { … } }
 *
 * The stub looks like:
 *
 *   // tests/_legacy-stubs/driver-factory.ts
 *   //
 *   // sel2pw detected DriverFactory in your Selenium suite. In Playwright
 *   // this responsibility belongs to fixtures (tests/fixtures.ts) and
 *   // playwright.config.ts → projects. This stub exists so callers of
 *   // DriverFactory.get() compile while you migrate them to use `page`
 *   // from the test fixture instead.
 */

import { ConvertedFile, JavaFile, ReviewItem } from "../types";

export interface DetectedUtility {
  className: string;
  kind:
    | "driver-factory"
    | "driver-manager"
    | "wait-utils"
    | "event-listener"
    | "reporter"
    | "test-util"
    | "unknown";
  reason: string;
}

const NAME_PATTERNS: { pattern: RegExp; kind: DetectedUtility["kind"] }[] = [
  // Driver / Browser factories and managers (wider — also covers BrowserFactory).
  { pattern: /^(Driver|WebDriver|Browser)Factory$/, kind: "driver-factory" },
  { pattern: /^(Driver|WebDriver|Browser)Manager$/, kind: "driver-manager" },
  // Wait helpers.
  { pattern: /^(Wait|WaitHelper|WaitUtil|WaitUtils|CustomWait)$/, kind: "wait-utils" },
  // Selenium event listeners (WebDriverEventListener, AbstractWebDriverEventListener,
  // ListenerImpl, custom suffixed variants).
  { pattern: /(?:Web|WebDriver|Event)Listener(?:Impl)?$/, kind: "event-listener" },
  { pattern: /^[A-Z]\w*Listener$/, kind: "event-listener" },
  // TestNG / Extent reporters.
  { pattern: /^Extent\w*$/, kind: "reporter" },
  { pattern: /Report(er)?(Manager)?$/, kind: "reporter" },
  // Driver / Element / Browser wrapper hierarchies — base classes + decorators
  // + loggers + interceptors. Common shape in advanced frameworks (decorator
  // pattern over Selenium primitives).
  {
    pattern: /^(Driver|Element|Browser)(Base|Decorator|Wrapper|Logger|Interceptor)?$/,
    kind: "test-util",
  },
  // Bare logger / method-interceptor types.
  { pattern: /^(Log|Logger|MethodInterceptor)$/, kind: "test-util" },
  // Constants / global config containers.
  { pattern: /(Constants?|GlobalConfig|Settings|Config)$/, kind: "test-util" },
  // Anything ending in a recognised utility suffix — Utility, Util, Utils,
  // Helper, Reader, Writer, Loader, Builder, Adapter, Factory (when not a
  // driver factory above), Decorator, Wrapper, Logger, Interceptor, Library,
  // Suite, Service, Manager (last-resort).
  // Also: prefix-qualified Driver / Action(s) wrappers such as
  // `ActionDriver`, `CustomDriver`, `LoginActions`, `CommonActions`.
  // The earlier `^(Driver|Element|Browser)(Base|...)?$` rule catches the
  // bare forms; this catches everything else ending in those suffixes.
  {
    pattern: /(Utility|Utils|Util|Helper|Reader|Writer|Loader|Builder|Adapter|Factory|Decorator|Wrapper|Logger|Interceptor|Library|Suite|Service|Driver|Actions?)$/,
    kind: "test-util",
  },
  // Java enums and POJO/model/data classes — these don't translate to
  // executable test code; they're typically TS interfaces or constants.
  // Until we have a proper `model` kind, emit as test-util stubs with
  // appropriate guidance.
  {
    pattern: /(Type|Model|Dto|Bean|Parameters|Param|Details|Info|Data|Properties|Config|Result|Response|Request|Payload)$/,
    kind: "test-util",
  },
  // Read* / Write* / Parse* prefixes — Excel/JSON/Property readers.
  {
    pattern: /^(Read|Write|Parse|Load|Save|Import|Export|Convert)\w+$/,
    kind: "test-util",
  },
  // DataProvider-named helpers (return Object[][] for @Test(dataProvider=...)).
  // Common pattern: `DataProviderForLogin`, `LoginDataProvider`, `TestDataXyz`.
  {
    pattern: /^(DataProvider\w*|TestData\w*|\w*DataProvider)$/,
    kind: "test-util",
  },
  // Screenshot-on-* / Log-on-* utility classes — TestNG listener-shaped
  // helpers that don't necessarily implement a Listener interface.
  {
    pattern: /^([A-Z]\w*OnFailure|[A-Z]\w*OnError|Screenshot\w*)$/,
    kind: "event-listener",
  },
  // Entry-point / runner classes (Main*, Run*, Execute*).
  {
    pattern: /^(Main|Run|Execute)\w*$/,
    kind: "test-util",
  },
  // Original narrow root-word matches (kept as last resort for short names).
  {
    pattern: /^(Test|Common|File|Json|Xml|Excel|Db|Database|Selenium|String|Date|Property|Properties)(Util|Utils|Helper|Reader|Loader|Manager)?$/,
    kind: "test-util",
  },
  // Custom Java exception classes (FrameworkException, InvalidPathException,
  // HeadlessNotSupportedException, etc.). selenium13 has 8 of these.
  // They're not test code — emit as test-util stubs with appropriate guidance.
  { pattern: /Exception$/, kind: "test-util" },
  // Pluralised helper / manager / util suffixes (CaptureHelpers, ExcelHelpers,
  // FileHelpers, AllureManager, TelegramManager). The earlier broad rule
  // covers the singular `Helper` but not `Helpers`. Same for the bare
  // `Manager` suffix without a Driver/Browser/Wait prefix.
  { pattern: /Helpers$/, kind: "test-util" },
  { pattern: /Manager$/, kind: "test-util" },
  // Annotation classes (@interface FrameworkAnnotation { ... }) — not
  // executable test code; user-defined annotations have no Playwright
  // analogue and almost always need to be deleted or converted to a
  // TS decorator manually.
  { pattern: /Annotation$/, kind: "test-util" },
  // RetryAnalyzer / Retry — TestNG's IRetryAnalyzer interface. Not
  // executable test code; emit as event-listener stub with guidance to
  // use Playwright's `retries` config instead.
  { pattern: /^Retry(Analyzer)?$/, kind: "event-listener" },
  // Annotation transformers (TestNG IAnnotationTransformer). Generic name
  // pattern that doesn't end in *Listener but lives in the listener bag.
  { pattern: /^[A-Z]\w*Transformer$/, kind: "reporter" },
];

const SHAPE_PATTERNS: { pattern: RegExp; kind: DetectedUtility["kind"] }[] = [
  {
    pattern: /\bThreadLocal<\s*WebDriver\s*>/,
    kind: "driver-manager",
  },
  {
    pattern: /\bWebDriverManager\.\w+driver\(\)\.setup\(\)/,
    kind: "driver-factory",
  },
  {
    pattern: /\bnew\s+WebDriverWait\s*\([^)]+\)\.until\b/,
    kind: "wait-utils",
  },
  // Implements a Selenium event listener interface.
  {
    pattern: /\bimplements\s+(?:Abstract)?WebDriverEventListener\b/,
    kind: "event-listener",
  },
  // Extent Reports usage — strong signal of a reporter helper.
  {
    pattern: /\bcom\.aventstack\.extentreports\b/,
    kind: "reporter",
  },
  // ITestListener / IReporter / IAnnotationTransformer / IInvokedMethodListener from TestNG.
  {
    pattern: /\bimplements\s+(?:I(?:Test)?Listener|IReporter|ITestListener|ISuiteListener|IAnnotationTransformer|IInvokedMethodListener|IExecutionListener|IConfigurationListener)\b/,
    kind: "reporter",
  },
  // Java enum keyword — these are clearly not page objects or tests.
  {
    pattern: /\benum\s+\w+\b/,
    kind: "test-util",
  },
  // Class with `public static void main` — entry-point runner.
  {
    pattern: /\bpublic\s+static\s+void\s+main\s*\(\s*String/,
    kind: "test-util",
  },
  // Overrides any of TestNG's ITestListener callbacks — strong signal of a
  // listener even if the `implements` clause was elsewhere or missing.
  {
    pattern: /\b(?:public|protected)\s+void\s+(onTestFailure|onTestSuccess|onTestStart|onTestSkipped|onFinish|onStart|onConfigurationFailure|onConfigurationSuccess)\s*\(\s*ITestResult\b/,
    kind: "event-listener",
  },
];

export function detectCustomUtilities(file: JavaFile): DetectedUtility | null {
  // Skip files we already classify (test classes / page objects / base test).
  if (file.kind !== "unknown" && file.kind !== "base") return null;

  for (const { pattern, kind } of NAME_PATTERNS) {
    if (pattern.test(file.className)) {
      return {
        className: file.className,
        kind,
        reason: `class name matches \`${pattern}\``,
      };
    }
  }
  for (const { pattern, kind } of SHAPE_PATTERNS) {
    if (pattern.test(file.source)) {
      return {
        className: file.className,
        kind,
        reason: `body matches \`${pattern.source}\``,
      };
    }
  }
  return null;
}

export function emitUtilityStub(util: DetectedUtility): {
  converted: ConvertedFile;
  warning: ReviewItem;
} {
  const fileName =
    util.className.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".ts";
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * Auto-detected legacy utility from your Selenium suite (${util.kind}).`);
  lines.push(` * Original Java class: ${util.className}`);
  lines.push(` *`);
  lines.push(` * In Playwright, the responsibility this class served is covered by:`);
  switch (util.kind) {
    case "driver-factory":
    case "driver-manager":
      lines.push(` *   - tests/fixtures.ts          (per-test page setup)`);
      lines.push(` *   - playwright.config.ts        (browser project config)`);
      lines.push(` *   - WebDriverManager → Playwright manages browsers itself.`);
      break;
    case "wait-utils":
      lines.push(` *   - locator auto-waits          (await locator.click() etc)`);
      lines.push(` *   - expect(locator).toBeVisible() / .toHaveText() / .toHaveCount()`);
      lines.push(` *   - page.waitForLoadState(...) for navigation barriers.`);
      break;
    case "event-listener":
      lines.push(` *   - playwright.config.ts → reporter            (use html / list / json reporters)`);
      lines.push(` *   - test.beforeEach / test.afterEach hooks      (for per-test instrumentation)`);
      lines.push(` *   - page.on('console' | 'pageerror' | 'request') (for browser-side events)`);
      break;
    case "reporter":
      lines.push(` *   - playwright.config.ts → reporter: [['html'], ['list']]   (built-ins)`);
      lines.push(` *   - allure-playwright npm package                            (Allure equivalent)`);
      lines.push(` *   - playwright/.cache → trace.zip viewer                     (per-test traces)`);
      break;
    case "test-util":
      lines.push(` *   - port pure helper functions to plain TS modules under tests/helpers/.`);
      lines.push(` *   - file/Excel/JSON loaders → use 'fs/promises', 'xlsx', or fixture-data.`);
      lines.push(` *   - String/Date helpers → standard JS APIs or 'date-fns'.`);
      break;
    default:
      lines.push(` *   - rewrite call sites to use Playwright primitives directly.`);
  }
  lines.push(` *`);
  lines.push(` * This stub exists so call sites compile while you migrate them.`);
  lines.push(` * Replace each call to \`${util.className}.<method>\` with a Playwright`);
  lines.push(` * primitive, then delete this file.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`export class ${util.className} {`);
  lines.push(`  /** @deprecated Migrate call sites — see file header. */`);
  lines.push(`  static notImplemented(method = "<method>"): never {`);
  lines.push("    throw new Error(`${this.name}.${method} is a sel2pw stub — migrate this call site to a Playwright fixture.`);");
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);

  return {
    converted: {
      relPath: `tests/_legacy-stubs/${fileName}`,
      source: lines.join("\n"),
      warnings: [],
      kind: "config",
    },
    warning: {
      file: util.className,
      severity: "manual",
      message: `Detected legacy utility \`${util.className}\` (${util.kind}, ${util.reason}). Generated a stub at \`tests/_legacy-stubs/${fileName}\`. Migrate each call site to Playwright primitives, then delete the stub.`,
    },
  };
}
