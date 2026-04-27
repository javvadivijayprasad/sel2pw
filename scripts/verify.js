/* eslint-disable */
/**
 * Self-contained sandbox verifier: ports the sel2pw pipeline using ONLY
 * Node built-ins (no fs-extra, no fast-glob, no commander), so we can run
 * end-to-end without `npm install`. Mirrors src/ logic line-for-line in the
 * key transforms; intended purely for smoke-testing the algorithm.
 *
 *   node scripts/verify.js <inputDir> <outputDir>
 */
const fs = require("fs");
const path = require("path");

// ---------------- scanner ----------------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["target", "build", ".idea", "node_modules"].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && full.endsWith(".java")) out.push(full);
  }
  return out;
}

function scanProject(inputDir) {
  const abs = path.resolve(inputDir);
  return walk(abs).map((p) => {
    const source = fs.readFileSync(p, "utf8");
    const pkg = (source.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || "";
    const className =
      (source.match(/\b(?:public\s+)?(?:abstract\s+)?class\s+([A-Z][\w$]*)/) || [])[1] ||
      path.basename(p, ".java");
    return { path: p, relPath: path.relative(abs, p).replace(/\\/g, "/"), packageName: pkg, className, source, kind: classify(className, source) };
  });
}

function classify(className, source) {
  const hasTest = /@Test\b/.test(source);
  const hasFindBy = /@FindBy\b/.test(source);
  const hasByStatic = /\bBy\.(id|cssSelector|xpath|name|linkText|partialLinkText|tagName|className)\s*\(/.test(source);
  const hasWebDriver = /\bWebDriver\s+\w+\s*[;=]/.test(source);
  const hasLifecycle = /@(Before|After)(Suite|Class|Method|Test)\b/.test(source);
  if (/^(BaseTest|TestBase|.*Base)$/.test(className) && !hasTest) return "base";
  if (hasTest || hasLifecycle) return "test-class";
  if (hasFindBy || hasByStatic || hasWebDriver || /Page$/.test(className)) return "page-object";
  return "unknown";
}

// ---------------- locator mapper ----------------
function locatorExpr(by, value, pageVar = "page") {
  const v = JSON.stringify(value);
  switch (by) {
    case "id": return `${pageVar}.locator(${JSON.stringify("#" + value)})`;
    case "css": return `${pageVar}.locator(${v})`;
    case "xpath": return `${pageVar}.locator(${JSON.stringify("xpath=" + value)})`;
    case "name": return `${pageVar}.locator(${JSON.stringify(`[name=${JSON.stringify(value)}]`)})`;
    case "linkText": return `${pageVar}.getByRole('link', { name: ${v} })`;
    case "partialLinkText": return `${pageVar}.getByRole('link', { name: ${v}, exact: false })`;
    case "tagName": return `${pageVar}.locator(${v})`;
    case "className": return `${pageVar}.locator(${JSON.stringify("." + value)})`;
    default: return `${pageVar}.locator(${v})`;
  }
}
function normalizeBy(raw) {
  if (raw === "cssSelector" || raw === "css") return "css";
  return raw;
}

// ---------------- API rewrites ----------------
const API_REWRITES = [
  [/\bdriver\.get\s*\(\s*([^)]+)\)\s*;/g, "await this.page.goto($1);"],
  [/\bdriver\.navigate\(\)\.to\s*\(\s*([^)]+)\)\s*;/g, "await this.page.goto($1);"],
  [/\bdriver\.navigate\(\)\.back\s*\(\s*\)\s*;/g, "await this.page.goBack();"],
  [/\bdriver\.navigate\(\)\.forward\s*\(\s*\)\s*;/g, "await this.page.goForward();"],
  [/\bdriver\.navigate\(\)\.refresh\s*\(\s*\)\s*;/g, "await this.page.reload();"],
  [/\bdriver\.getTitle\s*\(\s*\)/g, "await this.page.title()"],
  [/\bdriver\.getCurrentUrl\s*\(\s*\)/g, "this.page.url()"],
  [/\bdriver\.quit\s*\(\s*\)\s*;/g, "// driver.quit() — handled by Playwright fixture"],
  [/\bdriver\.close\s*\(\s*\)\s*;/g, "await this.page.close();"],
  // For Page Objects: driver.findElement(<fieldName>) -> this.<fieldName>
  [/\bdriver\.findElement\s*\(\s*(\w+)\s*\)/g, "this.$1"],
  [/\b(this\.\w+|\w+)\.click\s*\(\s*\)\s*;/g, "await $1.click();"],
  [/\b(this\.\w+|\w+)\.sendKeys\s*\(\s*([^)]+)\s*\)\s*;/g, "await $1.fill($2);"],
  [/\b(this\.\w+|\w+)\.clear\s*\(\s*\)\s*;/g, "await $1.clear();"],
  [/\b(this\.\w+|\w+)\.submit\s*\(\s*\)\s*;/g, "await $1.press('Enter');"],
  [/\b(this\.\w+|\w+)\.getText\s*\(\s*\)/g, "await $1.innerText()"],
  [/\b(this\.\w+|\w+)\.getAttribute\s*\(\s*([^)]+)\s*\)/g, "await $1.getAttribute($2)"],
  [/\b(this\.\w+|\w+)\.isDisplayed\s*\(\s*\)/g, "await $1.isVisible()"],
  [/\b(this\.\w+|\w+)\.isEnabled\s*\(\s*\)/g, "await $1.isEnabled()"],
  [/\b(this\.\w+|\w+)\.isSelected\s*\(\s*\)/g, "await $1.isChecked()"],
  [/\bnew\s+WebDriverWait\s*\([^)]*\)\.until\s*\([^)]*\)\s*;/g, "// removed: explicit wait — Playwright auto-waits on locators"],
  [/Thread\.sleep\s*\(\s*(\d+)\s*\)\s*;/g, "await this.page.waitForTimeout($1);"],
  [/\bString\s+(\w+)\s*=/g, "const $1 ="],
  [/\bint\s+(\w+)\s*=/g, "const $1 ="],
  [/\bboolean\s+(\w+)\s*=/g, "const $1 ="],
];

// ---------------- assertion rewrites (scan-based) ----------------
const ASSERT_MAPPINGS = {
  assertEquals: (args) => args.length >= 3 ? `expect(${args[0]}, ${args[2]}).toBe(${args[1]});` : `expect(${args[0]}).toBe(${args[1]});`,
  assertNotEquals: (args) => `expect(${args[0]}).not.toBe(${args[1]});`,
  assertTrue: (args) => args.length >= 2 ? `expect(${args[0]}, ${args[1]}).toBe(true);` : `expect(${args[0]}).toBe(true);`,
  assertFalse: (args) => args.length >= 2 ? `expect(${args[0]}, ${args[1]}).toBe(false);` : `expect(${args[0]}).toBe(false);`,
  assertNull: (args) => `expect(${args[0]}).toBeNull();`,
  assertNotNull: (args) => `expect(${args[0]}).not.toBeNull();`,
  assertContains: (args) => `expect(${args[0]}).toContain(${args[1]});`,
  fail: (args) => `throw new Error(${args[0] || "'Test failed'"});`,
};

function parseArgs(s, start) {
  let depth = 1, inS = false, cur = "";
  const args = [];
  for (let p = start; p < s.length; p++) {
    const c = s[p], prev = p > 0 ? s[p-1] : "";
    if (inS) { cur += c; if (c === '"' && prev !== "\\") inS = false; continue; }
    if (c === '"') { inS = true; cur += c; continue; }
    if (c === "(") { depth++; cur += c; continue; }
    if (c === ")") { depth--; if (depth === 0) { if (cur.trim() !== "" || args.length > 0) args.push(cur.trim()); return { args, endIdx: p + 1 }; } cur += c; continue; }
    if (c === "," && depth === 1) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  return null;
}

function applyAssertionRewrites(body) {
  let out = "", i = 0;
  const callRe = /\bAssert\.(\w+)\s*\(/g;
  while (i <= body.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(body);
    if (!m) { out += body.slice(i); break; }
    out += body.slice(i, m.index);
    const name = m[1];
    const mapping = ASSERT_MAPPINGS[name];
    const argsStart = m.index + m[0].length;
    if (!mapping) { out += body.slice(m.index, argsStart); i = argsStart; continue; }
    const parsed = parseArgs(body, argsStart);
    if (!parsed) { out += body.slice(m.index, argsStart); i = argsStart; continue; }
    let endIdx = parsed.endIdx;
    while (endIdx < body.length && /[ \t]/.test(body[endIdx])) endIdx++;
    if (body[endIdx] !== ";") { out += body.slice(m.index, argsStart); i = argsStart; continue; }
    out += mapping(parsed.args);
    i = endIdx + 1;
  }
  return out;
}

// ---------------- body transformer ----------------
function transformBody(rawBody, filePath, warnings) {
  let b = rawBody;
  b = b.replace(/\bfinal\s+/g, "");
  // Strip duplicate Page Object init lines (synthesised separately by emitter).
  b = b.replace(/^[\t ]*\w+\s*=\s*new\s+\w+Page\s*\([^)]*\)\s*;[\t ]*\r?\n?/gm, "");
  for (const [re, rep] of API_REWRITES) b = b.replace(re, rep);
  b = applyAssertionRewrites(b);
  b = b.replace(/\bSystem\.out\.println\s*\(/g, "console.log(");
  b = b.replace(/\bSystem\.err\.println\s*\(/g, "console.error(");
  if (/\bActions\b/.test(b)) warnings.push({ file: filePath, severity: "manual", message: "Selenium Actions chain — port to page.mouse / locator.hover/dragTo." });
  if (/\bJavascriptExecutor\b|\bexecuteScript\b/.test(b)) warnings.push({ file: filePath, severity: "manual", message: "executeScript → page.evaluate(...)." });
  if (/\bswitchTo\(\)\.frame\b/.test(b)) warnings.push({ file: filePath, severity: "manual", message: "iframe switchTo → page.frameLocator(...)." });
  if (/\bswitchTo\(\)\.alert\b/.test(b)) warnings.push({ file: filePath, severity: "manual", message: "Alert handling → page.on('dialog', ...)." });
  return b;
}

// ---------------- balanced-brace body reader ----------------
function readBracedBody(source, bodyStart) {
  if (source[bodyStart] !== "{") return null;
  let depth = 0, p = bodyStart, inS = false, inC = false, inLC = false, inBC = false;
  for (; p < source.length; p++) {
    const c = source[p], prev = source[p - 1];
    if (inLC) { if (c === "\n") inLC = false; continue; }
    if (inBC) { if (c === "/" && prev === "*") inBC = false; continue; }
    if (inS) { if (c === '"' && prev !== "\\") inS = false; continue; }
    if (inC) { if (c === "'" && prev !== "\\") inC = false; continue; }
    if (c === "/" && source[p + 1] === "/") { inLC = true; continue; }
    if (c === "/" && source[p + 1] === "*") { inBC = true; continue; }
    if (c === '"') { inS = true; continue; }
    if (c === "'") { inC = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { body: source.slice(bodyStart + 1, p), end: p + 1 }; }
  }
  return null;
}

function readMethodSignature(source, start) {
  const slice = source.slice(start);
  const m = /^([\s]*)((?:public|protected|private|static|final|synchronized|\s)+)?\s*([\w<>\[\],\s\?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/.exec(slice);
  if (!m) return null;
  const params = m[5].trim() ? m[5].trim().split(",").map((p) => {
    const parts = p.trim().split(/\s+/);
    return { name: parts[parts.length - 1], javaType: parts.slice(0, -1).join(" ").replace(/^final\s+/, "") || "Object" };
  }) : [];
  return { returnType: m[3].trim(), name: m[4], params, bodyStart: start + m[0].length - 1 };
}

function readAnnotation(source, start) {
  if (source[start] !== "@") return null;
  const nm = /^@([A-Z]\w*)/.exec(source.slice(start));
  if (!nm) return null;
  let pos = start + nm[0].length;
  if (source[pos] !== "(") return { text: nm[1], start, end: pos };
  let depth = 0, p = pos;
  for (; p < source.length; p++) {
    const c = source[p];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) { p++; break; } }
  }
  return { text: source.slice(start + 1, p), start, end: p };
}

// ---------------- page object extraction ----------------
function extractPageObject(file) {
  const source = file.source;
  const fields = [];
  const byPattern = /(?:private|protected|public)?\s*(?:static\s+)?(?:final\s+)?By\s+(\w+)\s*=\s*By\.(id|cssSelector|xpath|name|linkText|partialLinkText|tagName|className)\s*\(\s*"([^"]*)"\s*\)\s*;/g;
  let m;
  while ((m = byPattern.exec(source)) !== null) {
    fields.push({ name: m[1], by: normalizeBy(m[2]), value: m[3] });
  }
  const findByPattern = /@FindBy\s*\(\s*(id|css|xpath|name|linkText|partialLinkText|tagName|className)\s*=\s*"([^"]*)"\s*\)\s*(?:private|protected|public)?\s*(?:static\s+)?(?:final\s+)?WebElement\s+(\w+)\s*;/g;
  while ((m = findByPattern.exec(source)) !== null) {
    fields.push({ name: m[3], by: normalizeBy(m[1]), value: m[2] });
  }

  const methods = [];
  const re = /\n[\t ]*public\s+(?:final\s+)?([\w<>\[\],\s\?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  let mm;
  while ((mm = re.exec(source)) !== null) {
    const returnType = mm[1].trim();
    const name = mm[2];
    if (name === file.className) continue;
    const params = mm[3].trim() ? mm[3].trim().split(",").map((p) => {
      const parts = p.trim().split(/\s+/);
      return { name: parts[parts.length - 1], javaType: parts.slice(0, -1).join(" ").replace(/^final\s+/, "") || "Object" };
    }) : [];
    const bodyStart = mm.index + mm[0].length - 1;
    const body = readBracedBody(source, bodyStart);
    if (!body) continue;
    methods.push({ name, params, returnType, rawBody: body.body });
    re.lastIndex = body.end;
  }
  return { className: file.className, packageName: file.packageName, fields, methods };
}

function javaTypeToTs(t) {
  t = t.trim();
  if (!t || t === "void") return t || "void";
  if (t === "String") return "string";
  if (["int","long","short","double","float","Integer","Long","Double"].includes(t)) return "number";
  if (t === "boolean" || t === "Boolean") return "boolean";
  if (t === "Object") return "unknown";
  return t;
}

function dedentAndIndent(body, prefix) {
  const lines = body.split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return "";
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const m = line.match(/^[\t ]*/);
    const len = m ? m[0].length : 0;
    if (len < minIndent) minIndent = len;
  }
  if (!isFinite(minIndent)) minIndent = 0;
  return lines.map((l) => l.trim() === "" ? "" : prefix + l.slice(minIndent)).join("\n");
}

function pageFile(name) {
  return name.replace(/Page$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".page.ts";
}
function specFile(name) {
  return name.replace(/Test$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".spec.ts";
}
function camel(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

function emitPageObject(ir, sourceFilePath, warnings) {
  const lines = [];
  lines.push(`import { Page, Locator, expect } from '@playwright/test';`);
  lines.push("");
  lines.push(`export class ${ir.className} {`);
  lines.push(`  readonly page: Page;`);
  for (const f of ir.fields) lines.push(`  readonly ${f.name}: Locator;`);
  lines.push("");
  lines.push(`  constructor(page: Page) {`);
  lines.push(`    this.page = page;`);
  for (const f of ir.fields) lines.push(`    this.${f.name} = ${locatorExpr(f.by, f.value, "page")};`);
  lines.push(`  }`);
  for (const m of ir.methods) {
    lines.push("");
    const tsParams = m.params.map((p) => `${p.name}: ${javaTypeToTs(p.javaType)}`).join(", ");
    const tsRet = m.returnType === "void" ? "Promise<void>" : `Promise<${javaTypeToTs(m.returnType)}>`;
    let body = transformBody(m.rawBody, sourceFilePath, warnings);
    for (const sibling of ir.methods) {
      const re = new RegExp(`(^|[^\\w.])(?<!await\\s)${sibling.name}\\s*\\(`, "gm");
      body = body.replace(re, (_m, pre) => `${pre}await this.${sibling.name}(`);
    }
    lines.push(`  async ${m.name}(${tsParams}): ${tsRet} {`);
    lines.push(dedentAndIndent(body, "    "));
    lines.push(`  }`);
  }
  lines.push(`}`);
  lines.push("");
  return { relPath: `pages/${pageFile(ir.className)}`, source: lines.join("\n"), kind: "page-object" };
}

// ---------------- test class extraction ----------------
function extractAnnotatedMethods(source) {
  const out = [];
  const annoStart = /@([A-Z]\w*)(\s*\([^)]*\))?/g;
  const visited = new Set();
  let m;
  while ((m = annoStart.exec(source)) !== null) {
    if (visited.has(m.index)) continue;
    const annotations = [];
    let cursor = m.index;
    while (true) {
      const next = readAnnotation(source, cursor);
      if (!next) break;
      annotations.push(next.text);
      cursor = next.end;
      visited.add(next.start);
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
      if (source[cursor] !== "@") break;
    }
    const sig = readMethodSignature(source, cursor);
    if (!sig) continue;
    const body = readBracedBody(source, sig.bodyStart);
    if (!body) continue;
    out.push({ annotations, name: sig.name, params: sig.params, returnType: sig.returnType, rawBody: body.body });
    annoStart.lastIndex = body.end;
  }
  return out;
}

function parseAnnoArg(annotation, key) {
  const re = new RegExp(`${key}\\s*=\\s*("([^"]*)"|\\{[^}]*\\})`);
  const mm = annotation.match(re);
  if (!mm) return undefined;
  return mm[2] !== undefined ? mm[2] : mm[1];
}

function extractTestClass(file) {
  const ms = extractAnnotatedMethods(file.source);
  const lifecycle = [], testMethods = [];
  for (const meth of ms) {
    const lifeAnno = meth.annotations.find((a) => /^(Before|After)(Suite|Class|Method|Test)\b/.test(a));
    if (lifeAnno) {
      lifecycle.push({ kind: lifeAnno.replace(/\(.*$/, ""), name: meth.name, rawBody: meth.rawBody });
      continue;
    }
    const testAnno = meth.annotations.find((a) => /^Test\b/.test(a));
    if (testAnno) {
      testMethods.push({
        name: meth.name,
        params: meth.params,
        annotations: meth.annotations,
        description: parseAnnoArg(testAnno, "description"),
        dataProvider: parseAnnoArg(testAnno, "dataProvider"),
        groups: (parseAnnoArg(testAnno, "groups") || "").replace(/^\{|\}$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean),
        rawBody: meth.rawBody,
      });
    }
  }
  const baseMatch = file.source.match(/class\s+\w+\s+extends\s+(\w+)/);
  const pageObjectTypes = Array.from(new Set(Array.from(file.source.matchAll(/(?:private|protected|public)\s+(?:final\s+)?(\w+Page)\s+\w+\s*(?:=|;)/g)).map((m) => m[1])));
  return { className: file.className, packageName: file.packageName, pageObjectTypes, lifecycle, testMethods, extendsBase: !!baseMatch, baseClassName: baseMatch ? baseMatch[1] : undefined };
}

function mapLifecycle(kind) {
  if (kind === "BeforeMethod" || kind === "BeforeTest") return "test.beforeEach";
  if (kind === "BeforeClass" || kind === "BeforeSuite") return "test.beforeAll";
  if (kind === "AfterMethod" || kind === "AfterTest") return "test.afterEach";
  return "test.afterAll";
}

function poImport(name) {
  return name.replace(/Page$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".page";
}

function rewriteAwaitOnPageObjectCalls(body, pageObjectTypes) {
  let out = body;
  for (const pt of pageObjectTypes) {
    const inst = camel(pt);
    const re = new RegExp(`(^|[^\\w.])(?<!await\\s)(${inst}\\.\\w+\\s*\\()`, "gm");
    out = out.replace(re, (_m, pre, call) => `${pre}await ${call}`);
  }
  return out;
}

function emitTestClass(ir, sourceFilePath, warnings) {
  const lines = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  for (const pt of ir.pageObjectTypes) lines.push(`import { ${pt} } from '../pages/${poImport(pt)}';`);
  lines.push("");
  lines.push(`test.describe('${ir.className}', () => {`);
  for (const pt of ir.pageObjectTypes) lines.push(`  let ${camel(pt)}: ${pt};`);
  if (ir.pageObjectTypes.length) lines.push("");
  let hasBeforeEachLike = false;
  for (const h of ir.lifecycle) {
    const tsHook = mapLifecycle(h.kind);
    if (h.kind === "BeforeMethod" || h.kind === "BeforeClass") hasBeforeEachLike = true;
    let body = transformBody(h.rawBody, sourceFilePath, warnings);
    body = rewriteAwaitOnPageObjectCalls(body, ir.pageObjectTypes);
    lines.push(`  ${tsHook}(async ({ page }) => {`);
    if (h.kind === "BeforeMethod" || h.kind === "BeforeClass") {
      for (const pt of ir.pageObjectTypes) lines.push(`    ${camel(pt)} = new ${pt}(page);`);
    }
    lines.push(dedentAndIndent(body, "    "));
    lines.push(`  });`);
    lines.push("");
  }
  if (!hasBeforeEachLike && ir.pageObjectTypes.length) {
    lines.push(`  test.beforeEach(async ({ page }) => {`);
    for (const pt of ir.pageObjectTypes) lines.push(`    ${camel(pt)} = new ${pt}(page);`);
    lines.push(`  });`);
    lines.push("");
  }
  for (const m of ir.testMethods) {
    if (m.dataProvider) warnings.push({ file: sourceFilePath, severity: "manual", message: `@Test(dataProvider="${m.dataProvider}") on ${m.name} — convert manually to a parameterised loop.` });
    const title = m.description || m.name;
    let body = transformBody(m.rawBody, sourceFilePath, warnings);
    body = rewriteAwaitOnPageObjectCalls(body, ir.pageObjectTypes);
    const tsParams = m.params.map((p) => `${p.name}: ${javaTypeToTs(p.javaType)}`).join(", ");
    const fixtureSig = tsParams ? `{ page }, ${tsParams}` : `{ page }`;
    if (m.groups && m.groups.length) lines.push(`  // groups: ${m.groups.join(", ")}`);
    lines.push(`  test(${JSON.stringify(title)}, async (${fixtureSig}) => {`);
    lines.push(dedentAndIndent(body, "    "));
    lines.push(`  });`);
    lines.push("");
  }
  lines.push(`});`);
  lines.push("");
  return { relPath: `tests/${specFile(ir.className)}`, source: lines.join("\n"), kind: "test" };
}

// ---------------- driver ----------------
function main() {
  const [, , inputDir, outputDir] = process.argv;
  if (!inputDir || !outputDir) {
    console.error("Usage: node verify.js <inputDir> <outputDir>");
    process.exit(1);
  }
  const files = scanProject(inputDir);
  console.log(`Scanned ${files.length} Java files:`);
  for (const f of files) console.log(`  ${f.kind.padEnd(14)} ${f.className.padEnd(20)} ${f.relPath}`);

  const converted = [];
  const warnings = [];
  let pages = 0, tests = 0, testMethods = 0;
  for (const f of files) {
    if (f.kind === "page-object") {
      const ir = extractPageObject(f);
      converted.push(emitPageObject(ir, f.path, warnings));
      pages++;
    } else if (f.kind === "test-class") {
      const ir = extractTestClass(f);
      converted.push(emitTestClass(ir, f.path, warnings));
      tests++;
      testMethods += ir.testMethods.length;
    } else if (f.kind === "base") {
      warnings.push({ file: f.path, severity: "manual", message: `Base class ${f.className} — port shared setup into a Playwright fixture.` });
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const templatesDir = path.resolve(__dirname, "..", "templates");
  for (const [tpl, out] of [
    ["package.json.tmpl", "package.json"],
    ["playwright.config.ts.tmpl", "playwright.config.ts"],
    ["tsconfig.json.tmpl", "tsconfig.json"],
    ["gitignore.tmpl", ".gitignore"],
  ]) {
    const tplPath = path.join(templatesDir, tpl);
    if (fs.existsSync(tplPath)) fs.copyFileSync(tplPath, path.join(outputDir, out));
  }
  for (const cf of converted) {
    const target = path.join(outputDir, cf.relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, cf.source, "utf8");
  }

  const lines = [];
  lines.push("# Conversion Review");
  lines.push("");
  lines.push(`Source: \`${path.resolve(inputDir)}\``);
  lines.push(`Output: \`${path.resolve(outputDir)}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Files scanned: **${files.length}**`);
  lines.push(`- Page Objects converted: **${pages}**`);
  lines.push(`- Test classes converted: **${tests}**`);
  lines.push(`- Test methods converted: **${testMethods}**`);
  lines.push(`- Review items: **${warnings.length}**`);
  lines.push("");
  lines.push("## Items by file");
  lines.push("");
  const grouped = {};
  for (const w of warnings) (grouped[w.file] ||= []).push(w);
  if (Object.keys(grouped).length === 0) {
    lines.push("_No review items — clean conversion._");
  } else {
    for (const file of Object.keys(grouped).sort()) {
      lines.push(`### \`${path.basename(file)}\``);
      lines.push("");
      lines.push("| Severity | Note |");
      lines.push("| --- | --- |");
      for (const it of grouped[file]) lines.push(`| ${it.severity} | ${it.message.replace(/\|/g, "\\|")} |`);
      lines.push("");
    }
  }
  fs.writeFileSync(path.join(outputDir, "CONVERSION_REVIEW.md"), lines.join("\n"), "utf8");

  console.log("");
  console.log(`Wrote ${converted.length} TS files + scaffold to ${outputDir}`);
  console.log(`Review items: ${warnings.length}`);
}

main();
