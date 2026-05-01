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
  const re = /\b(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|static\s+)*(?:class|enum|interface)\s+(\w[\w$]*)/g;
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

  // Base classes: name pattern OR (lifecycle methods but no @Test)
  if (/^(BaseTest|TestBase|.*Base)$/.test(className) && !hasTestAnnotation) {
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

  return "unknown";
}
