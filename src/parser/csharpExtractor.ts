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

/**
 * C# / Selenium / NUnit / SpecFlow extractor.
 *
 * Pragmatic regex+balanced-brace approach (same shape as the Java extractor
 * before Phase 1's AST swap). Roslyn-grade extraction lives in the .NET
 * sidecar design at src/stretch/csharp/README.md; this module is the
 * "most-codebases-just-work" pragmatic version.
 *
 * Reuses the Java IR types — emitters/transformers see no difference. The
 * conversions specific to C# (PascalCase → camelCase, properties → method
 * calls, `IWebDriver`/`IWebElement` → Playwright primitives) happen as a
 * pre-pass that normalises the body to look like Java before the standard
 * body transformer runs.
 *
 * NOTE: `JavaFile` is misnamed at this point — it just means "source file".
 * Future refactor: rename to `SourceFile`. Not blocking.
 */

// -------- public API --------

export function extractCsharpPageObject(file: JavaFile): PageObjectIR {
  const fields = extractLocatorFieldsCsharp(file.source);
  const methods = extractCsharpMethods(file.source, file.className);
  const unknownFields = extractUnknownFieldsCsharp(file.source, fields);

  return {
    className: file.className,
    packageName: file.packageName,
    fields,
    methods,
    unknownFields,
  };
}

export function extractCsharpTestClass(file: JavaFile): TestClassIR {
  const all = extractAnnotatedMethodsCsharp(file.source);
  const lifecycle: LifecycleMethodIR[] = [];
  const testMethods: TestMethodIR[] = [];

  for (const m of all) {
    const lifecycleAttr = m.attributes.find((a) =>
      // NUnit: SetUp / TearDown / OneTimeSetUp / OneTimeTearDown
      // MSTest: TestInitialize / TestCleanup / ClassInitialize / ClassCleanup
      // SpecFlow: Before / After (when paired with [Binding])
      /^(SetUp|TearDown|OneTimeSetUp|OneTimeTearDown|TestInitialize|TestCleanup|ClassInitialize|ClassCleanup|Before|After|BeforeScenario|AfterScenario|BeforeFeature|AfterFeature)\b/.test(a),
    );
    if (lifecycleAttr) {
      lifecycle.push({
        kind: normaliseCsharpLifecycle(lifecycleAttr.replace(/\(.*$/, "")),
        name: m.name,
        rawBody: m.rawBody,
      });
      continue;
    }
    const testAttr = m.attributes.find((a) => /^(Test|TestCase|TestMethod|Fact|Theory)\b/.test(a));
    if (testAttr) {
      testMethods.push({
        name: m.name,
        params: m.params,
        annotations: m.attributes,
        description: undefined,
        groups: [],
        dataProvider: undefined,
        rawBody: m.rawBody,
        javadoc: m.xmlDoc,
      });
      continue;
    }
    // SpecFlow step definitions
    const stepAttr = m.attributes.find((a) => /^(Given|When|Then|And|But)\b/.test(a));
    if (stepAttr) {
      // Treat step defs the same as test methods so the existing emitter
      // produces a spec; the BDD path will pick them up separately when
      // .feature files are present.
      testMethods.push({
        name: m.name,
        params: m.params,
        annotations: m.attributes,
        description: parseAttrArg(stepAttr),
        groups: [],
        dataProvider: undefined,
        rawBody: m.rawBody,
        javadoc: m.xmlDoc,
      });
    }
  }

  // Page-object instances declared via `private LoginPage loginPage = new LoginPage(driver);`
  const pageObjectTypes = Array.from(
    new Set(
      Array.from(
        file.source.matchAll(
          /(?:private|protected|public|internal)\s+(?:readonly\s+)?(\w+Page)\s+\w+\s*(?:=|;)/g,
        ),
      ).map((m) => m[1]),
    ),
  );

  const baseMatch = file.source.match(/class\s+\w+\s*:\s*(\w+)/);

  return {
    className: file.className,
    packageName: file.packageName,
    pageObjectTypes,
    lifecycle,
    testMethods,
    extendsBase: !!baseMatch,
    baseClassName: baseMatch ? baseMatch[1] : undefined,
  };
}

// -------- locator field extraction --------

function extractLocatorFieldsCsharp(source: string): LocatorField[] {
  const fields: LocatorField[] = [];

  // C# By.Id("user") — PascalCase methods.
  const byPattern =
    /(?:private|protected|public|internal)?\s*(?:static\s+)?(?:readonly\s+)?By\s+(\w+)\s*=\s*By\.(Id|CssSelector|XPath|Name|LinkText|PartialLinkText|TagName|ClassName)\s*\(\s*"([^"]*)"\s*\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = byPattern.exec(source)) !== null) {
    fields.push({
      name: m[1],
      by: normalizeBy(m[2]),
      value: m[3],
      rawLine: m[0],
    });
  }

  // [FindsBy(How = How.Id, Using = "user")] private IWebElement userInput;
  const findsByPattern =
    /\[FindsBy\s*\(\s*How\s*=\s*How\.(Id|CssSelector|XPath|Name|LinkText|PartialLinkText|TagName|ClassName)\s*,\s*Using\s*=\s*"([^"]*)"\s*\)\s*\]\s*(?:private|protected|public|internal)?\s*(?:readonly\s+)?IWebElement\s+(\w+)\s*;/g;
  while ((m = findsByPattern.exec(source)) !== null) {
    fields.push({
      name: m[3],
      by: normalizeBy(m[1]),
      value: m[2],
      rawLine: m[0].replace(/\s+/g, " "),
    });
  }
  return fields;
}

function extractUnknownFieldsCsharp(
  source: string,
  known: LocatorField[],
): string[] {
  const knownNames = new Set(known.map((f) => f.name));
  const fieldPattern =
    /^[\t ]*(?:private|protected|public|internal)\s+(?:readonly\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*(?:=[^;]+)?;/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fieldPattern.exec(source)) !== null) {
    const type = m[1].trim();
    const name = m[2];
    if (knownNames.has(name)) continue;
    if (type === "IWebDriver" || type === "By" || type === "IWebElement") continue;
    out.push(`${type} ${name}`);
  }
  return out;
}

// -------- method extraction --------

function extractCsharpMethods(source: string, className: string): PageMethodIR[] {
  const out: PageMethodIR[] = [];
  // C# methods: public/internal/private + return type + Name + (params) + body.
  const re =
    /\n[\t ]*(?:public|internal|protected)\s+(?:async\s+)?(?:override\s+)?(?:virtual\s+)?([\w<>[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const returnType = m[1].trim();
    const name = m[2];
    if (name === className) continue;
    const paramsRaw = m[3].trim();
    const params: ParamIR[] = paramsRaw
      ? paramsRaw.split(",").map((p) => {
          const parts = p.trim().split(/\s+/);
          const pname = parts[parts.length - 1];
          const ptype = parts.slice(0, -1).join(" ");
          return { name: pname, javaType: ptype || "object" };
        })
      : [];
    const bodyStart = m.index + m[0].length - 1;
    const body = readBracedBody(source, bodyStart);
    if (!body) continue;
    out.push({
      name,
      params,
      returnType,
      rawBody: normaliseCsharpBody(body.body),
    });
    re.lastIndex = body.end;
  }
  return out;
}

interface CsharpAnnotatedMethod {
  attributes: string[];
  name: string;
  params: ParamIR[];
  returnType: string;
  rawBody: string;
  xmlDoc?: string;
}

function extractAnnotatedMethodsCsharp(source: string): CsharpAnnotatedMethod[] {
  const out: CsharpAnnotatedMethod[] = [];
  // C# attributes: [Test], [TestCase], [SetUp], [Given("...")], etc.
  const attrStart = /\[([A-Z]\w*)(\s*\([^)]*\))?\s*\]/g;
  const visited = new Set<number>();
  let m: RegExpExecArray | null;

  while ((m = attrStart.exec(source)) !== null) {
    if (visited.has(m.index)) continue;

    const attributes: string[] = [];
    let cursor = m.index;
    for (;;) {
      const next = readAttribute(source, cursor);
      if (!next) break;
      attributes.push(next.text);
      cursor = next.end;
      visited.add(next.start);
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
      if (source[cursor] !== "[") break;
    }

    const sig = readMethodSignatureCsharp(source, cursor);
    if (!sig) continue;
    const body = readBracedBody(source, sig.bodyStart);
    if (!body) continue;
    out.push({
      attributes,
      name: sig.name,
      params: sig.params,
      returnType: sig.returnType,
      rawBody: normaliseCsharpBody(body.body),
    });
    attrStart.lastIndex = body.end;
  }
  return out;
}

function readAttribute(
  source: string,
  start: number,
): { text: string; start: number; end: number } | null {
  if (source[start] !== "[") return null;
  let depth = 0;
  let p = start;
  for (; p < source.length; p++) {
    const c = source[p];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        p++;
        break;
      }
    }
  }
  return { text: source.slice(start + 1, p - 1).trim(), start, end: p };
}

function readMethodSignatureCsharp(
  source: string,
  start: number,
): {
  returnType: string;
  name: string;
  params: ParamIR[];
  bodyStart: number;
} | null {
  const slice = source.slice(start);
  const sigMatch =
    /^([\s]*)((?:public|protected|private|internal|static|readonly|virtual|override|async|\s)+)?\s*([\w<>[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*\{/.exec(
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
        const ptype = parts.slice(0, -1).join(" ");
        return { name: pname, javaType: ptype || "object" };
      })
    : [];
  return {
    returnType,
    name,
    params,
    bodyStart: start + sigMatch[0].length - 1,
  };
}

function readBracedBody(
  source: string,
  bodyStart: number,
): { body: string; end: number } | null {
  if (source[bodyStart] !== "{") return null;
  let depth = 0;
  let p = bodyStart;
  let inS = false;
  let inC = false;
  let inLC = false;
  let inBC = false;
  for (; p < source.length; p++) {
    const c = source[p];
    const prev = source[p - 1];
    if (inLC) {
      if (c === "\n") inLC = false;
      continue;
    }
    if (inBC) {
      if (c === "/" && prev === "*") inBC = false;
      continue;
    }
    if (inS) {
      if (c === '"' && prev !== "\\") inS = false;
      continue;
    }
    if (inC) {
      if (c === "'" && prev !== "\\") inC = false;
      continue;
    }
    if (c === "/" && source[p + 1] === "/") {
      inLC = true;
      continue;
    }
    if (c === "/" && source[p + 1] === "*") {
      inBC = true;
      continue;
    }
    if (c === '"') {
      inS = true;
      continue;
    }
    if (c === "'") {
      inC = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: source.slice(bodyStart + 1, p), end: p + 1 };
    }
  }
  return null;
}

// -------- C# → Java-flavoured normalisation --------

/**
 * Massage a C# method body so the existing Java body transformer recognises
 * it. The downstream apiMap/assertionMap rewrites already cover lower-case
 * Selenium API; we only need to convert the C#-specific spelling here.
 */
function normaliseCsharpBody(body: string): string {
  let out = body;

  // PascalCase Selenium / WebElement methods → camelCase so the existing
  // apiMap rewrites (e.g. /\.click\s*\(/) match.
  out = out.replace(/\.Click\s*\(/g, ".click(");
  out = out.replace(/\.SendKeys\s*\(/g, ".sendKeys(");
  out = out.replace(/\.Clear\s*\(/g, ".clear(");
  out = out.replace(/\.Submit\s*\(/g, ".submit(");
  out = out.replace(/\.GetAttribute\s*\(/g, ".getAttribute(");
  // Properties → method calls so subsequent rewrites work.
  out = out.replace(/\.Text\b(?!\s*\()/g, ".getText()");
  out = out.replace(/\.Displayed\b(?!\s*\()/g, ".isDisplayed()");
  out = out.replace(/\.Enabled\b(?!\s*\()/g, ".isEnabled()");
  out = out.replace(/\.Selected\b(?!\s*\()/g, ".isSelected()");
  out = out.replace(/\.TagName\b(?!\s*\()/g, ".getTagName()");

  // C# driver navigation API.
  out = out.replace(/\bdriver\.Navigate\(\)\.GoToUrl\s*\(/g, "driver.get(");
  out = out.replace(/\bdriver\.Url\s*=\s*([^;]+);/g, "driver.get($1);");
  out = out.replace(/\bdriver\.Title\b(?!\s*\()/g, "driver.getTitle()");
  out = out.replace(/\bdriver\.Close\s*\(/g, "driver.close(");
  out = out.replace(/\bdriver\.Quit\s*\(/g, "driver.quit(");

  // FindElement/FindElements (PascalCase) → findElement/findElements
  out = out.replace(/\bdriver\.FindElement\s*\(/g, "driver.findElement(");
  out = out.replace(/\bdriver\.FindElements\s*\(/g, "driver.findElements(");

  // C# By spelling → Java spelling so the locator rewrites match.
  out = out.replace(/\bBy\.Id\s*\(/g, "By.id(");
  out = out.replace(/\bBy\.CssSelector\s*\(/g, "By.cssSelector(");
  out = out.replace(/\bBy\.XPath\s*\(/g, "By.xpath(");
  out = out.replace(/\bBy\.Name\s*\(/g, "By.name(");
  out = out.replace(/\bBy\.LinkText\s*\(/g, "By.linkText(");
  out = out.replace(/\bBy\.PartialLinkText\s*\(/g, "By.partialLinkText(");
  out = out.replace(/\bBy\.TagName\s*\(/g, "By.tagName(");
  out = out.replace(/\bBy\.ClassName\s*\(/g, "By.className(");

  // NUnit / MSTest / xUnit assertions → TestNG-flavoured for the existing rewriter.
  out = out.replace(/\bAssert\.AreEqual\s*\(/g, "Assert.assertEquals(");
  out = out.replace(/\bAssert\.AreNotEqual\s*\(/g, "Assert.assertNotEquals(");
  out = out.replace(/\bAssert\.IsTrue\s*\(/g, "Assert.assertTrue(");
  out = out.replace(/\bAssert\.IsFalse\s*\(/g, "Assert.assertFalse(");
  out = out.replace(/\bAssert\.IsNull\s*\(/g, "Assert.assertNull(");
  out = out.replace(/\bAssert\.IsNotNull\s*\(/g, "Assert.assertNotNull(");
  out = out.replace(/\bAssert\.Fail\s*\(/g, "Assert.fail(");
  // xUnit-style.
  out = out.replace(/\bAssert\.Equal\s*\(/g, "Assert.assertEquals(");
  out = out.replace(/\bAssert\.NotEqual\s*\(/g, "Assert.assertNotEquals(");
  out = out.replace(/\bAssert\.True\s*\(/g, "Assert.assertTrue(");
  out = out.replace(/\bAssert\.False\s*\(/g, "Assert.assertFalse(");

  // C# `var` declarations → `String` (just so the Java rewrite picks them up
  // and turns them into `const`).
  out = out.replace(/\bvar\s+(\w+)\s*=/g, "String $1 =");

  return out;
}

function normalizeBy(raw: string): ByStrategy {
  const lower = raw.toLowerCase();
  if (lower === "cssselector" || lower === "css") return "css";
  if (lower === "xpath") return "xpath";
  if (lower === "id") return "id";
  if (lower === "name") return "name";
  if (lower === "linktext") return "linkText";
  if (lower === "partiallinktext") return "partialLinkText";
  if (lower === "tagname") return "tagName";
  if (lower === "classname") return "className";
  return "css";
}

function normaliseCsharpLifecycle(raw: string): TestNgLifecycle {
  // Map every C# lifecycle attribute onto the TestNG vocabulary the emitter speaks.
  if (raw === "SetUp" || raw === "TestInitialize" || raw === "BeforeScenario" || raw === "Before") return "BeforeMethod";
  if (raw === "TearDown" || raw === "TestCleanup" || raw === "AfterScenario" || raw === "After") return "AfterMethod";
  if (raw === "OneTimeSetUp" || raw === "ClassInitialize" || raw === "BeforeFeature") return "BeforeClass";
  if (raw === "OneTimeTearDown" || raw === "ClassCleanup" || raw === "AfterFeature") return "AfterClass";
  return "BeforeMethod";
}

function parseAttrArg(attr: string): string | undefined {
  // [Given("the user is on the login page")]  →  "the user is on the login page"
  const m = /^\w+\s*\(\s*"([^"]*)"/.exec(attr);
  return m ? m[1] : undefined;
}
