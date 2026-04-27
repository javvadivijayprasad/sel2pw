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
  | "config"          // pom.xml, testng.xml etc. (carried forward as review notes)
  | "unknown";

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
  filesScanned: number;
  pageObjectsConverted: number;
  testClassesConverted: number;
  testMethodsConverted: number;
  warnings: ReviewItem[];
}
