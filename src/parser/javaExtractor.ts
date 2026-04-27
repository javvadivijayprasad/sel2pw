import {
  JavaFile,
  PageObjectIR,
  TestClassIR,
  LocatorField,
  ByStrategy,
  PageMethodIR,
  ParamIR,
  TestMethodIR,
  LifecycleMethodIR,
  TestNgLifecycle,
} from "../types";
import { findJavadocBeforeMethod } from "../transformers/commentPreserver";

/**
 * Java extractor — turns raw Java source into a structural IR.
 *
 * This is regex + balanced-brace based, not a true AST parser. It works well
 * for the conventional shapes of TestNG tests and Page Objects, which are
 * the MVP target. The IR boundary is clean enough that a real AST parser
 * (e.g. java-parser, JavaParser via JVM sidecar) can be slotted in later
 * without changing the rest of the pipeline.
 */

// ---------- Page Object extraction ----------

export function extractPageObject(file: JavaFile): PageObjectIR {
  const fields = extractLocatorFields(file.source);
  const methods = extractMethods(file.source);
  const unknownFields = extractUnknownFields(file.source, fields);

  return {
    className: file.className,
    packageName: file.packageName,
    fields,
    methods,
    unknownFields,
  };
}

function extractLocatorFields(source: string): LocatorField[] {
  const fields: LocatorField[] = [];

  // Pattern 1:  private By usernameInput = By.id("user");
  const byPattern =
    /(?:private|protected|public)?\s*(?:static\s+)?(?:final\s+)?By\s+(\w+)\s*=\s*By\.(id|cssSelector|xpath|name|linkText|partialLinkText|tagName|className)\s*\(\s*"([^"]*)"\s*\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = byPattern.exec(source)) !== null) {
    fields.push({
      name: m[1],
      by: normalizeBy(m[2]),
      value: m[3],
      rawLine: m[0],
    });
  }

  // Pattern 2: @FindBy(id = "user") private WebElement usernameInput;
  const findByPattern =
    /@FindBy\s*\(\s*(id|css|xpath|name|linkText|partialLinkText|tagName|className)\s*=\s*"([^"]*)"\s*\)\s*(?:private|protected|public)?\s*(?:static\s+)?(?:final\s+)?WebElement\s+(\w+)\s*;/g;
  while ((m = findByPattern.exec(source)) !== null) {
    fields.push({
      name: m[3],
      by: normalizeBy(m[1]),
      value: m[2],
      rawLine: m[0].replace(/\s+/g, " "),
    });
  }

  return fields;
}

function normalizeBy(raw: string): ByStrategy {
  switch (raw) {
    case "cssSelector":
    case "css":
      return "css";
    case "id":
      return "id";
    case "xpath":
      return "xpath";
    case "name":
      return "name";
    case "linkText":
      return "linkText";
    case "partialLinkText":
      return "partialLinkText";
    case "tagName":
      return "tagName";
    case "className":
      return "className";
    default:
      return "css";
  }
}

function extractUnknownFields(source: string, known: LocatorField[]): string[] {
  const knownNames = new Set(known.map((f) => f.name));
  const fieldPattern =
    /^[\t ]*(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*(?:=[^;]+)?;/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fieldPattern.exec(source)) !== null) {
    const type = m[1].trim();
    const name = m[2];
    if (knownNames.has(name)) continue;
    if (type === "WebDriver") continue; // expected, handled separately
    if (type === "By" || type === "WebElement") continue; // already handled
    out.push(`${type} ${name}`);
  }
  return out;
}

// ---------- Test class extraction ----------

export function extractTestClass(file: JavaFile): TestClassIR {
  const methods = extractAnnotatedMethods(file.source);
  const lifecycle: LifecycleMethodIR[] = [];
  const testMethods: TestMethodIR[] = [];

  for (const method of methods) {
    const lifecycleAnno = method.annotations.find((a) =>
      // TestNG: BeforeSuite/Class/Method/Test, AfterSuite/Class/Method/Test
      // JUnit5: BeforeAll, BeforeEach, AfterAll, AfterEach
      // JUnit4: Before, After, BeforeClass, AfterClass
      /^(Before|After)(Suite|Class|Method|Test|Each|All)?\b/.test(a),
    );
    if (lifecycleAnno) {
      // Normalise JUnit annotations onto the TestNG lifecycle vocabulary.
      const kind = normaliseLifecycle(lifecycleAnno.replace(/\(.*$/, ""));
      lifecycle.push({ kind, name: method.name, rawBody: method.rawBody });
      continue;
    }
    // Treat Cucumber step defs (`@Given`/`@When`/`@Then`/`@And`/`@But`) the
    // same way the C# extractor does: emit them as test-method-IR entries so
    // even projects without .feature files (or where features live outside
    // the scanned tree) still produce a meaningful spec instead of an empty
    // describe block. The full BDD path additionally generates step files
    // when .feature files ARE present.
    const stepAnno = method.annotations.find((a) => /^(Given|When|Then|And|But)\b/.test(a));
    const testAnno = method.annotations.find((a) => /^Test\b/.test(a)) ?? stepAnno;
    if (testAnno) {
      const description = parseAnnoArg(testAnno, "description");
      const dataProvider = parseAnnoArg(testAnno, "dataProvider");
      const groupsRaw = parseAnnoArg(testAnno, "groups");
      const groups = groupsRaw
        ? groupsRaw
            .replace(/^\{|\}$/g, "")
            .split(",")
            .map((s) => s.trim().replace(/^"|"$/g, ""))
            .filter(Boolean)
        : undefined;
      testMethods.push({
        name: method.name,
        params: method.params,
        annotations: method.annotations,
        description,
        groups,
        dataProvider,
        rawBody: method.rawBody,
        javadoc: method.javadoc,
      });
    }
  }

  const baseMatch = file.source.match(/class\s+\w+\s+extends\s+(\w+)/);
  const baseClassName = baseMatch ? baseMatch[1] : undefined;

  // Find Page Object types referenced anywhere in the source — class fields,
  // local declarations inside test methods, AND bare `new XxxPage(...)` calls.
  // Some projects declare Page Objects as locals per-test; without this we'd
  // miss the imports and skip the await-prefix step.
  const pageObjectTypes = Array.from(
    new Set([
      // class-level / local declarations: `<vis?> <Type>Page <name> = ...` or just `<Type>Page <name>;`
      ...Array.from(
        file.source.matchAll(
          /(?:(?:private|protected|public)\s+)?(?:final\s+)?(\w+Page)\s+\w+\s*(?:=|;)/g,
        ),
      ).map((m) => m[1]),
      // any `new <Type>Page(` call — covers per-method local instantiations
      ...Array.from(file.source.matchAll(/\bnew\s+(\w+Page)\s*\(/g)).map((m) => m[1]),
    ]),
  );

  return {
    className: file.className,
    packageName: file.packageName,
    pageObjectTypes: Array.from(new Set(pageObjectTypes)),
    lifecycle,
    testMethods,
    extendsBase: !!baseClassName,
    baseClassName,
  };
}

/**
 * Map a raw annotation name (TestNG or JUnit4/5) onto the TestNG-flavoured
 * lifecycle vocabulary used by the rest of the pipeline. The emitter then
 * maps this onto Playwright's `test.beforeEach/beforeAll/afterEach/afterAll`.
 */
function normaliseLifecycle(raw: string): TestNgLifecycle {
  // JUnit5: @BeforeEach/@AfterEach map to per-method semantics
  if (raw === "BeforeEach") return "BeforeMethod";
  if (raw === "AfterEach") return "AfterMethod";
  // JUnit5: @BeforeAll/@AfterAll map to per-class semantics
  if (raw === "BeforeAll") return "BeforeClass";
  if (raw === "AfterAll") return "AfterClass";
  // JUnit4: bare @Before / @After are per-method
  if (raw === "Before") return "BeforeMethod";
  if (raw === "After") return "AfterMethod";
  // TestNG passes through unchanged
  return raw as TestNgLifecycle;
}

function parseAnnoArg(annotation: string, key: string): string | undefined {
  // matches:  description = "foo"   description="foo"   groups = {"a","b"}
  const re = new RegExp(`${key}\\s*=\\s*("([^"]*)"|\\{[^}]*\\})`);
  const m = annotation.match(re);
  if (!m) return undefined;
  return m[2] !== undefined ? m[2] : m[1];
}

// ---------- Generic method extraction ----------

interface RawMethod {
  annotations: string[]; // text between @ and end of args, e.g. 'Test(description="...")'
  name: string;
  params: ParamIR[];
  returnType: string;
  rawBody: string;
  javadoc?: string;
}

/**
 * Extract methods that have at least one annotation. (Lifecycle and @Test
 * methods all have annotations; constructors and helpers without annotations
 * are skipped here.)
 */
function extractAnnotatedMethods(source: string): RawMethod[] {
  const out: RawMethod[] = [];
  // We scan for an annotation, then expect zero+ more annotations, then the
  // method signature on the following lines.
  const annoStart = /@([A-Z]\w*)(\s*\([^)]*\))?/g;
  const visited = new Set<number>();

  let m: RegExpExecArray | null;
  while ((m = annoStart.exec(source)) !== null) {
    if (visited.has(m.index)) continue;

    // Collect this annotation and any consecutive ones.
    const annotations: string[] = [];
    let cursor = m.index;
    for (;;) {
      const next = readAnnotation(source, cursor);
      if (!next) break;
      annotations.push(next.text);
      cursor = next.end;
      visited.add(next.start);
      // Skip whitespace
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
      if (source[cursor] !== "@") break;
    }

    // Now `cursor` should be at the method signature.
    const sig = readMethodSignature(source, cursor);
    if (!sig) continue;
    const body = readBracedBody(source, sig.bodyStart);
    if (!body) continue;
    // Look for a Javadoc immediately preceding the FIRST annotation.
    const firstAnnoIdx = m.index;
    const javadoc = findJavadocBeforeMethod(source, firstAnnoIdx) ?? undefined;
    out.push({
      annotations,
      name: sig.name,
      params: sig.params,
      returnType: sig.returnType,
      rawBody: body.body,
      javadoc,
    });
    annoStart.lastIndex = body.end;
  }
  return out;
}

function readAnnotation(
  source: string,
  start: number,
): { text: string; start: number; end: number } | null {
  if (source[start] !== "@") return null;
  // Match @Name optionally followed by a (...) with possibly nested parens.
  const nameMatch = /^@([A-Z]\w*)/.exec(source.slice(start));
  if (!nameMatch) return null;
  let pos = start + nameMatch[0].length;
  // Java tolerates `@Test (priority = 0, ...)` with space before the `(`.
  // The annoStart regex above accepts that shape too (`\s*\(`), so we have
  // to mirror it here — otherwise the arg list gets skipped over and the
  // annotation appears as bare `Test` to downstream matchers, which then
  // can't find `Test(description="...")` patterns.
  while (pos < source.length && (source[pos] === " " || source[pos] === "\t")) pos++;
  if (source[pos] !== "(") {
    return { text: nameMatch[1], start, end: pos };
  }
  // Consume balanced parens.
  let depth = 0;
  let p = pos;
  for (; p < source.length; p++) {
    const c = source[p];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        p++;
        break;
      }
    }
  }
  return { text: source.slice(start + 1, p), start, end: p };
}

function readMethodSignature(
  source: string,
  start: number,
): {
  returnType: string;
  name: string;
  params: ParamIR[];
  bodyStart: number;
} | null {
  // Scan forward to the first '{' on the same logical signature line(s).
  // Accept signatures like:  public void foo() throws Exception {
  const slice = source.slice(start);
  const sigMatch =
    /^([\s]*)((?:public|protected|private|static|final|synchronized|\s)+)?\s*([\w<>[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/.exec(
      slice,
    );
  if (!sigMatch) return null;
  const returnType = sigMatch[3].trim();
  const name = sigMatch[4];
  const paramsRaw = sigMatch[5].trim();
  const params: ParamIR[] = paramsRaw
    ? paramsRaw.split(",").map((p) => {
        const parts = p.trim().split(/\s+/);
        const pname = parts[parts.length - 1];
        const ptype = parts.slice(0, -1).join(" ").replace(/^final\s+/, "");
        return { name: pname, javaType: ptype || "Object" };
      })
    : [];
  const bodyStart = start + sigMatch[0].length - 1; // points at '{'
  return { returnType, name, params, bodyStart };
}

function readBracedBody(
  source: string,
  bodyStart: number,
): { body: string; end: number } | null {
  if (source[bodyStart] !== "{") return null;
  let depth = 0;
  let p = bodyStart;
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (; p < source.length; p++) {
    const c = source[p];
    const prev = source[p - 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "/" && prev === "*") inBlockComment = false;
      continue;
    }
    if (inString) {
      if (c === '"' && prev !== "\\") inString = false;
      continue;
    }
    if (inChar) {
      if (c === "'" && prev !== "\\") inChar = false;
      continue;
    }
    if (c === "/" && source[p + 1] === "/") {
      inLineComment = true;
      continue;
    }
    if (c === "/" && source[p + 1] === "*") {
      inBlockComment = true;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "'") {
      inChar = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { body: source.slice(bodyStart + 1, p), end: p + 1 };
      }
    }
  }
  return null;
}

// ---------- Page Object methods ----------

function extractMethods(source: string): PageMethodIR[] {
  // Page Object public methods (not annotated, typically): public void enterUsername(String s) { ... }
  const out: PageMethodIR[] = [];
  const re =
    /\n[\t ]*public\s+(?:final\s+)?([\w<>[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const returnType = m[1].trim();
    const name = m[2];
    if (name === source.match(/class\s+(\w+)/)?.[1]) continue; // skip ctor
    const paramsRaw = m[3].trim();
    const params: ParamIR[] = paramsRaw
      ? paramsRaw.split(",").map((p) => {
          const parts = p.trim().split(/\s+/);
          const pname = parts[parts.length - 1];
          const ptype = parts.slice(0, -1).join(" ").replace(/^final\s+/, "");
          return { name: pname, javaType: ptype || "Object" };
        })
      : [];
    const bodyStart = m.index + m[0].length - 1;
    const body = readBracedBody(source, bodyStart);
    if (!body) continue;
    const javadoc = findJavadocBeforeMethod(source, m.index) ?? undefined;
    out.push({ name, params, returnType, rawBody: body.body, javadoc });
    re.lastIndex = body.end;
  }
  return out;
}
