/* eslint-disable */
/**
 * find-stub-callers — porting helper.
 *
 * After sel2pw runs, `tests/_legacy-stubs/<name>.ts` holds typed stubs for
 * Java utility classes that don't have a clean Playwright equivalent. Each
 * stub throws if invoked. To finish the migration the user has to:
 *
 *   1. Find every place that imports / references the stub.
 *   2. Replace each call site with a Playwright primitive.
 *   3. Delete the stub.
 *
 * This script does step 1 mechanically and prints a porting checklist
 * grouped by stub. It runs with no dependencies (pure Node built-ins) so
 * you can use it directly from the converted project without `npm install`.
 *
 *   node scripts/find-stub-callers.js <converted-project-dir>
 *
 * Output (per stub):
 *   ──────────────────────────────────────────────────────
 *   ExtentReporterNG   (kind: reporter)
 *   ──────────────────────────────────────────────────────
 *   Suggested replacements:
 *     - playwright.config.ts → reporter: [['html'], ['list']]
 *     - allure-playwright npm package
 *     - playwright/.cache → trace.zip viewer
 *
 *   Call sites (3):
 *     tests/login.spec.ts:14    new ExtentReporterNG().onTestStart(result);
 *     tests/login.spec.ts:42    ExtentReporterNG.flush();
 *     pages/base.page.ts:8      import { ExtentReporterNG } from '../tests/_legacy-stubs/extent-reporter-ng';
 */

const fs = require("fs");
const path = require("path");

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("Usage: node scripts/find-stub-callers.js <converted-project-dir>");
  process.exit(1);
}
const root = path.resolve(projectDir);
const stubsDir = path.join(root, "tests", "_legacy-stubs");
if (!fs.existsSync(stubsDir)) {
  console.error(`No tests/_legacy-stubs/ directory at ${stubsDir}`);
  console.error("Run sel2pw first, or check the path argument.");
  process.exit(1);
}

const SUGGESTIONS = {
  "driver-factory": [
    "tests/fixtures.ts          (per-test page setup)",
    "playwright.config.ts        (browser project config)",
    "Playwright manages browsers itself — no WebDriverManager equivalent needed.",
  ],
  "driver-manager": [
    "tests/fixtures.ts          (per-test page setup)",
    "playwright.config.ts        (browser project config)",
  ],
  "wait-utils": [
    "locator auto-waits          (await locator.click() etc)",
    "expect(locator).toBeVisible() / .toHaveText() / .toHaveCount()",
    "page.waitForLoadState(...) for navigation barriers",
  ],
  "event-listener": [
    "playwright.config.ts → reporter            (use html / list / json reporters)",
    "test.beforeEach / test.afterEach hooks      (for per-test instrumentation)",
    "page.on('console' | 'pageerror' | 'request') (for browser-side events)",
  ],
  reporter: [
    "playwright.config.ts → reporter: [['html'], ['list']]   (built-ins)",
    "allure-playwright npm package                            (Allure equivalent)",
    "playwright/.cache → trace.zip viewer                     (per-test traces)",
  ],
  "test-util": [
    "Port pure helper functions to plain TS modules under tests/helpers/.",
    "File / Excel / JSON loaders → use 'fs/promises', 'xlsx', or fixture-data.",
    "String / Date helpers → standard JS APIs or 'date-fns'.",
  ],
  unknown: ["Rewrite call sites to use Playwright primitives directly."],
};

// ----- discover stubs -----

const stubs = fs
  .readdirSync(stubsDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => parseStub(path.join(stubsDir, f)));

if (stubs.length === 0) {
  console.log("No legacy stubs found — nothing to port.");
  process.exit(0);
}

// ----- walk source tree for references -----

const sourceFiles = collectTsFiles(root);

const results = stubs.map((s) => ({
  ...s,
  references: findReferences(s.className, sourceFiles, root),
}));

// ----- print -----

let totalRefs = 0;
const bar = "─".repeat(60);

for (const r of results.sort((a, b) => b.references.length - a.references.length)) {
  totalRefs += r.references.length;
  console.log(bar);
  console.log(`${r.className}   (kind: ${r.kind})`);
  console.log(bar);
  console.log("Suggested replacements:");
  for (const s of SUGGESTIONS[r.kind] ?? SUGGESTIONS.unknown) {
    console.log("  - " + s);
  }
  console.log("");
  if (r.references.length === 0) {
    console.log("Call sites (0): no references found — safe to delete the stub.");
  } else {
    console.log(`Call sites (${r.references.length}):`);
    for (const ref of r.references) {
      console.log(`  ${ref.relPath}:${ref.line}    ${ref.snippet}`);
    }
  }
  console.log("");
}

console.log(bar);
console.log(`Summary: ${results.length} stub(s), ${totalRefs} total reference(s).`);
console.log(`Stubs with 0 references can be deleted now.`);
console.log(bar);

// =====================================================================

function parseStub(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const cls = (src.match(/export\s+class\s+(\w+)/) || [])[1];
  // The detector kind is the first hyphenated tag in the JSDoc header.
  const kindMatch = src.match(
    /Auto-detected legacy utility from your Selenium suite \((\w[\w-]*)\)/,
  );
  return {
    className: cls ?? path.basename(filePath, ".ts"),
    kind: kindMatch ? kindMatch[1] : "unknown",
    stubPath: filePath,
  };
}

function collectTsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip node_modules, the stubs dir itself, build outputs.
      if (
        e.name === "node_modules" ||
        e.name === "_legacy-stubs" ||
        e.name === "playwright-report" ||
        e.name === "test-results" ||
        e.name === "dist"
      ) continue;
      collectTsFiles(full, out);
    } else if (e.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function findReferences(className, files, root) {
  const refs = [];
  // Word-boundary match so `LoginPage` doesn't match inside `MyLoginPageWrapper`,
  // and we skip the stub's own definition file.
  const re = new RegExp(`\\b${escapeRe(className)}\\b`);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        refs.push({
          relPath: path.relative(root, f).replace(/\\/g, "/"),
          line: i + 1,
          snippet: lines[i].trim().slice(0, 100),
        });
      }
    }
  }
  return refs;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
