/**
 * Intermediate Representation (IR) for the Selenium → Playwright converter.
 *
 * The pipeline:
 *   scan    -> JavaFile[]                  (raw + classified)
 *   parse   -> JavaFile[] with extracted   PageObjectIR | TestClassIR
 *   transform -> ConvertedFile[]            (TS source + warnings)
 *   emit    -> writes to output directory + CONVERSION_REVIEW.md
 */

export type SourceKind =
  | "test-class"      // TestNG: contains @Test methods
  | "page-object"     // Page Object: usually has By/@FindBy fields and WebDriver field/ctor
  | "base"            // BaseTest / framework helpers
  | "infrastructure"  // DriverManager / BrowserFactory / ThreadLocal<WebDriver> — Playwright handles via fixtures, skip emission
  | "java-record"     // v2.0: Java record (POJO data carrier) -> TS interface (+ optional Builder)
  | "java-enum"       // v2.0: Java enum -> TS enum (aggregated into types/enums.ts)
  | "java-exception"  // v2.0: extends Exception/Error/Throwable -> class X extends Error (aggregated into types/errors.ts)
  | "owner-config"    // v2.0: @Config interface w/ @Key fields -> TS interface + env loader
  | "pojo"            // v2.0: private fields + getters, no @Test/@FindBy -> TS interface
  | "config"          // pom.xml, testng.xml etc. (carried forward as review notes)
  | "unknown";



/**
 * v2.0 — folder layout strategy for the converted output.
 *
 *   "v1-flat"     (default through 1.x):
 *     pages/, tests/, tests/_legacy-stubs/, tests/helpers/
 *     One emitter -> one file. No data/, types/, or fixtures/ subdir.
 *
 *   "v2-organized" (opt-in via --layout v2 during 1.x, default in 2.0+):
 *     pages/<n>.page.ts
 *     tests/<n>.spec.ts
 *     tests/fixtures/index.ts       (custom Playwright fixtures, was tests/fixtures.ts)
 *     tests/fixtures/auth.setup.ts  (when LoginPage detected)
 *     data/models.ts                (Java records / POJOs as TS interfaces)
 *     data/factories.ts             (Java *DataFactory classes)
 *     data/constants.ts             (Java *Data classes — static fields)
 *     types/enums.ts                (all Java enums aggregated)
 *     types/errors.ts               (Java exception classes aggregated)
 *     types/config.ts               (Owner @Config interface)
 *     _review/                      (files the converter could not confidently translate)
 */
export type OutputLayout = "v1-flat" | "v2-organized";

/**
 * v2.0 — per-file disposition recorded in conversion-result.json. Lets users
 * (and the new `sel2pw audit` subcommand) see exactly what happened to each
 * input file: converted to which destination, stubbed, skipped (with reason),
 * or failed.
 */
export interface FileDisposition {
  /** Input file path relative to inputDir. */
  source: string;
  /** SourceKind the classifier picked. */
  sourceKind: SourceKind;
  /** Output file path relative to outputDir, or null when nothing was emitted. */
  output: string | null;
  /** What the converter did with this file. */
  status:
    | "converted"   // produced a usable .ts file
    | "stubbed"     // produced a stub the user needs to migrate
    | "skipped"     // intentionally not emitted (infrastructure, etc.) — see reason
    | "dropped"     // silently dropped because no detector matched (v1.x bug we are fixing)
    | "failed";     // parser/emitter crashed on this file
  /** Human-readable reason — shows up in the CLI summary table. */
  reason: string;
  /** Severity hint for the CLI summary glyph (✓ / ⚠ / ⊘ / ✗). */
  severity: "ok" | "warning" | "info" | "error";
}

export interface JavaFile {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the input root (used for output mirroring). */
  relPath: string;
  packageName: string;
  className: string;
  /** Original source. */
  source: string;
  kind: SourceKind;
}

export type ByStrategy =
  | "id"
  | "css"
  | "xpath"
  | "name"
  | "linkText"
  | "partialLinkText"
  | "tagName"
  | "className";

export interface LocatorField {
  /** Java field identifier, e.g. usernameInput. */
  name: string;
  by: ByStrategy;
  value: string;
  /** Original source line — useful for review reports. */
  rawLine: string;
}

export interface ParamIR {
  name: string;
  /** Java type as written in source (e.g. "String", "int"). */
  javaType: string;
}

export interface PageMethodIR {
  name: string;
  params: ParamIR[];
  returnType: string;
  /** Raw Java body (between the outer braces, no indent normalisation). */
  rawBody: string;
  /** TS-style JSDoc preserved from the Java Javadoc (without the leading/trailing markers). */
  javadoc?: string;
}

export interface PageObjectIR {
  className: string;
  packageName: string;
  fields: LocatorField[];
  methods: PageMethodIR[];
  /** Other field declarations we didn't recognise (carried as warnings). */
  unknownFields: string[];
  /** v2.0 — Java `extends` clause, when the page object inherits from another page. */
  extendsClass?: string;
}

export type TestNgLifecycle =
  | "BeforeSuite"
  | "BeforeClass"
  | "BeforeMethod"
  | "BeforeTest"
  | "AfterMethod"
  | "AfterClass"
  | "AfterSuite"
  | "AfterTest";

export interface TestMethodIR {
  name: string;
  params: ParamIR[];
  /** Annotations in source order — e.g. ["Test(description=\"...\")"]. */
  annotations: string[];
  description?: string;
  groups?: string[];
  dataProvider?: string;
  rawBody: string;
  /** TS-style JSDoc preserved from the Java Javadoc. */
  javadoc?: string;
}

export interface LifecycleMethodIR {
  kind: TestNgLifecycle;
  name: string;
  rawBody: string;
}

export interface TestClassIR {
  className: string;
  packageName: string;
  /** Page Object types referenced (best-effort by field type lookup). */
  pageObjectTypes: string[];
  lifecycle: LifecycleMethodIR[];
  testMethods: TestMethodIR[];
  /** True if the class extends a known BaseTest. */
  extendsBase: boolean;
  baseClassName?: string;
}

export interface ReviewItem {
  file: string;
  line?: number;
  severity: "info" | "warning" | "manual";
  message: string;
  snippet?: string;
}

export interface ConvertedFile {
  /** Output path relative to the output project root. */
  relPath: string;
  /** Final TypeScript source. */
  source: string;
  warnings: ReviewItem[];
  /** What kind of file we produced. */
  kind: "page-object" | "test" | "base" | "config";
}

export interface ConversionSummary {
  inputDir: string;
  outputDir: string;
  /** v2.0: which folder layout we emitted. */
  layout?: OutputLayout;
  filesScanned: number;
  pageObjectsConverted: number;
  testClassesConverted: number;
  testMethodsConverted: number;
  /** v2.0: per-file disposition for the audit summary table. */
  dispositions?: FileDisposition[];
  warnings: ReviewItem[];
}
