import { ReviewItem } from "../types";

/**
 * Java standard-library idiom rewrites.
 *
 * Where `apiMap` handles Selenium → Playwright (driver/element/locator API)
 * and `advancedApiMap` handles the Selenium long-tail (Actions, JS execute,
 * iframe, alert, cookies, file upload, multi-window), this module covers
 * the **Java standard library** patterns that compile in Java but break in
 * TypeScript without rewriting.
 *
 * Order of application (matters):
 *   1) Custom-helper call sites (`clickElement(el)` → `await el.click()`)
 *      so subsequent passes see the rewritten Playwright primitives.
 *   2) Select-dropdown idiom (`new Select(el).selectByVisibleText(x)`).
 *   3) Java type-position rewrites in declarations (`String[]` → `string[]`,
 *      `WebElement` → `Locator`, `List<WebElement>` → `Locator`).
 *   4) Java collection-method calls (`.size()` → `.length`/`.count()`,
 *      `.get(i)` → `[i]`/`.nth(i)`, `.add` / `.remove` / `.put` / etc).
 *   5) Java string-method calls (`.length()` → `.length`, `.contains` →
 *      `.includes`, `.equalsIgnoreCase`, etc).
 *   6) Java exception-instance methods (`e.getMessage()` →
 *      `(e as Error).message`).
 *   7) Numeric parsers (`Integer.parseInt`, `String.valueOf`).
 *
 * Each rewrite is a regex over the body string. The regexes are deliberately
 * conservative — patterns that could generate ambiguous TS get a
 * `// TODO(sel2pw): verify` marker rather than a confident rewrite.
 */

export interface IdiomMapResult {
  body: string;
  warnings: ReviewItem[];
}

export function applyJavaIdiomRewrites(
  raw: string,
  filePath: string,
): IdiomMapResult {
  const warnings: ReviewItem[] = [];
  let body = raw;

  // ============================================================
  // 1) Custom helper call sites (project-specific but very common)
  // ============================================================
  // These are conventions in TestNG-style frameworks. The helper class
  // itself is auto-stubbed by customUtilDetector; here we rewrite the
  // CALL SITES so the converted test code uses Playwright primitives
  // directly instead of `await Helpers.notImplemented(...)`.

  // verifyEquals(true, elementExists(el), msg) → await expect(el).toBeVisible()
  body = body.replace(
    /\bverifyEquals\s*\(\s*true\s*,\s*elementExists\s*\(\s*([\w.]+)\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "await expect($1).toBeVisible()",
  );
  body = body.replace(
    /\bverifyEquals\s*\(\s*false\s*,\s*elementExists\s*\(\s*([\w.]+)\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "await expect($1).not.toBeVisible()",
  );
  // verifyEquals("text", el.getText(), msg) → await expect(el).toHaveText("text")
  body = body.replace(
    /\bverifyEquals\s*\(\s*("[^"]*")\s*,\s*([\w.]+)\.getText\s*\(\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "await expect($2).toHaveText($1)",
  );
  // verifyEquals(expected, list.size(), msg) → expect(await list.count()).toBe(expected)
  body = body.replace(
    /\bverifyEquals\s*\(\s*([^,]+?)\s*,\s*([\w.]+)\.size\s*\(\s*\)\s*(?:,\s*[^)]+)?\)/g,
    "expect(await $2.count()).toBe($1)",
  );
  // verifyEquals(expected, actual, msg) → expect(actual).toBe(expected)  (general fallback)
  body = body.replace(
    /\bverifyEquals\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*[^)]+\)/g,
    "expect($2).toBe($1)",
  );
  // verifyEquals(expected, actual)  (2-arg variant)
  body = body.replace(
    /\bverifyEquals\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g,
    "expect($2).toBe($1)",
  );

  // elementExists(el) → await el.isVisible()
  // Only fires on bare expression usage (e.g. `if (elementExists(x))`).
  body = body.replace(
    /\belementExists\s*\(\s*([\w.]+)\s*\)/g,
    "await $1.isVisible()",
  );

  // clickElement(el, ...) → await el.click()
  // The trailing args (label, page name, etc) are descriptive — drop them.
  body = body.replace(
    /\bclickElement\s*\(\s*([\w.]+)\s*(?:,\s*[^)]*)?\)/g,
    "await $1.click()",
  );
  // safeClick(el) / clickWithRetry(el) / waitAndClick(el) — all just click.
  body = body.replace(
    /\b(?:safeClick|clickWithRetry|waitAndClick|robustClick|forceClick)\s*\(\s*([\w.]+)\s*(?:,\s*[^)]*)?\)/g,
    "await $1.click()",
  );

  // enterText(el, text) → await el.fill(text)
  body = body.replace(
    /\benterText\s*\(\s*([\w.]+)\s*,\s*([^)]+?)\s*\)/g,
    "await $1.fill($2)",
  );
  // typeText / sendText / inputText — same family.
  body = body.replace(
    /\b(?:typeText|sendText|inputText|fillText)\s*\(\s*([\w.]+)\s*,\s*([^)]+?)\s*\)/g,
    "await $1.fill($2)",
  );

  // getText(el) (custom wrapper, not the WebElement method) →
  // await el.innerText().
  // Conservative — only rewrites when called as a free function with one
  // argument that is a known locator-shaped name.
  body = body.replace(
    /\bgetText\s*\(\s*([a-z]\w*Page\.\w+|this\.\w+|el|element|locator|loc|\w+Btn|\w+Field|\w+Link|\w+Input)\s*\)/g,
    "await $1.innerText()",
  );

  // ============================================================
  // 2) Select-dropdown idiom (new Select(el).select*)
  // ============================================================

  // new Select(el).selectByVisibleText("opt") → await el.selectOption({ label: "opt" })
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.selectByVisibleText\s*\(\s*([^)]+?)\s*\)/g,
    "await $1.selectOption({ label: $2 })",
  );
  // new Select(el).selectByValue("v") → await el.selectOption({ value: "v" })
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.selectByValue\s*\(\s*([^)]+?)\s*\)/g,
    "await $1.selectOption({ value: $2 })",
  );
  // new Select(el).selectByIndex(2) → await el.selectOption({ index: 2 })
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.selectByIndex\s*\(\s*([^)]+?)\s*\)/g,
    "await $1.selectOption({ index: $2 })",
  );
  // new Select(el).getFirstSelectedOption().getText() → await el.inputValue()
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.getFirstSelectedOption\s*\(\s*\)\s*\.getText\s*\(\s*\)/g,
    "await $1.inputValue()",
  );
  // new Select(el).getOptions() → await el.locator('option').all()
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.getOptions\s*\(\s*\)/g,
    "await $1.locator('option').all()",
  );
  // new Select(el).deselectAll() → await el.selectOption([])
  body = body.replace(
    /\bnew\s+Select\s*\(\s*([\w.]+)\s*\)\s*\.deselectAll\s*\(\s*\)/g,
    "await $1.selectOption([])",
  );

  // ============================================================
  // 3) Type-position rewrites (declarations)
  // ============================================================

  // String[] / int[] / boolean[] / double[] → string[] / number[] / boolean[] / number[]
  // Only fires in declaration positions: after `let`, `const`, `:`, `(` (param), or `,` (multi-decl).
  body = body.replace(/\bString\[\]/g, "string[]");
  body = body.replace(/\bint\[\]|\blong\[\]|\bshort\[\]|\bdouble\[\]|\bfloat\[\]|\bInteger\[\]|\bLong\[\]|\bDouble\[\]/g, "number[]");
  body = body.replace(/\bboolean\[\]|\bBoolean\[\]/g, "boolean[]");

  // List<WebElement> / List<IWebElement> in declarations → Locator (Playwright
  // Locator IS the list — no separate "list of elements" type).
  body = body.replace(/\bList<\s*WebElement\s*>/g, "Locator");
  body = body.replace(/\bList<\s*IWebElement\s*>/g, "Locator");

  // Bare WebElement in declaration → Locator. Restricted to type positions
  // (after `let`/`const`/`:`/`(`/`,`/`;`) so we don't accidentally rewrite
  // a class name inside a string literal.
  body = body.replace(
    /\b(let|const|var|public|private|protected|readonly|:|\()\s+WebElement\b/g,
    "$1 Locator",
  );

  // Promise<WebElement> / Promise<By> return types → Locator (sync handle).
  body = body.replace(/\bPromise<\s*WebElement\s*>/g, "Locator");
  body = body.replace(/\bPromise<\s*By\s*>/g, "Locator");

  // ============================================================
  // 4) Java collection-method calls
  // ============================================================

  // <expr>.size() — context-sensitive:
  //   - If <expr> ends in *Elements / *Items / *Cells / *Locators OR is `elements`
  //     / `items` / `cells` / `locators` / `results` (Locator-shaped names),
  //     rewrite to `await <expr>.count()`.
  //   - Otherwise rewrite to `<expr>.length` (Java List → JS array).
  body = body.replace(
    /\b((?:[a-z]\w*)?(?:Elements|Items|Cells|Locators|Rows|Buttons|Links|Fields|Inputs))\.size\s*\(\s*\)/g,
    "await $1.count()",
  );
  body = body.replace(
    /\b(elements|items|cells|locators|results|rows|buttons|links|fields|inputs|tableCells|matches|webElements)\.size\s*\(\s*\)/g,
    "await $1.count()",
  );
  // Anything else: assume it's a List<String> / List<Integer> → array.length.
  body = body.replace(/\b([\w.]+)\.size\s*\(\s*\)/g, "$1.length");

  // <expr>.get(i) — same heuristic.
  body = body.replace(
    /\b((?:[a-z]\w*)?(?:Elements|Items|Cells|Locators|Rows|Buttons|Links|Fields|Inputs))\.get\s*\(\s*(\d+|\w+)\s*\)/g,
    "$1.nth($2)",
  );
  body = body.replace(
    /\b(elements|items|cells|locators|results|rows|buttons|links|fields|inputs|tableCells|matches|webElements)\.get\s*\(\s*(\d+|\w+)\s*\)/g,
    "$1.nth($2)",
  );
  // Otherwise List.get(i) → array[i]
  body = body.replace(/\b([\w.]+)\.get\s*\(\s*(\d+|\w+)\s*\)/g, "$1[$2]");

  // List.add(item) → list.push(item)
  body = body.replace(/\b([\w.]+)\.add\s*\(\s*([^)]+?)\s*\)/g, "$1.push($2)");
  // List.remove(i) where i is integer index → splice(i, 1)
  body = body.replace(
    /\b([\w.]+)\.remove\s*\(\s*(\d+|\w+)\s*\)/g,
    "$1.splice($2, 1)",
  );
  // List.contains(item) → list.includes(item)
  body = body.replace(
    /\b([\w.]+)\.contains\s*\(\s*([^)]+?)\s*\)/g,
    "$1.includes($2)",
  );
  // List.isEmpty() → list.length === 0
  body = body.replace(/\b([\w.]+)\.isEmpty\s*\(\s*\)/g, "$1.length === 0");
  // List.indexOf is the same in JS — no rewrite needed.

  // Map.put(k, v) → map[k] = v  (only when in statement position, not chained)
  body = body.replace(
    /\b([\w.]+)\.put\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g,
    "$1[$2] = $3",
  );
  // Map.get(k) → map[k]  (only when arg is a string literal or simple identifier
  // — the .get(i) numeric form is handled above)
  body = body.replace(
    /\b([\w.]+)\.get\s*\(\s*("[^"]+"|'[^']+'|[a-zA-Z_]\w*)\s*\)/g,
    "$1[$2]",
  );
  // Map.containsKey(k) → k in map
  body = body.replace(
    /\b([\w.]+)\.containsKey\s*\(\s*([^)]+?)\s*\)/g,
    "$2 in $1",
  );
  // Map.keySet() → Object.keys(map)
  body = body.replace(/\b([\w.]+)\.keySet\s*\(\s*\)/g, "Object.keys($1)");
  // Map.values() → Object.values(map)
  body = body.replace(/\b([\w.]+)\.values\s*\(\s*\)/g, "Object.values($1)");
  // Map.entrySet() → Object.entries(map)
  body = body.replace(/\b([\w.]+)\.entrySet\s*\(\s*\)/g, "Object.entries($1)");

  // Arrays.asList(a, b, c) → [a, b, c]
  body = body.replace(/\bArrays\.asList\s*\(\s*([^)]*)\)/g, "[$1]");
  // Collections.sort(list) → list.sort()
  body = body.replace(
    /\bCollections\.sort\s*\(\s*([\w.]+)\s*\)/g,
    "$1.sort()",
  );
  // Collections.reverse(list) → list.reverse()
  body = body.replace(
    /\bCollections\.reverse\s*\(\s*([\w.]+)\s*\)/g,
    "$1.reverse()",
  );

  // ============================================================
  // 5) String-method calls
  // ============================================================

  // .length() → .length  (Java has parens; JS doesn't on strings)
  // Only on identifier-shaped receivers — don't touch method calls that
  // have side effects.
  body = body.replace(/\b([\w.]+)\.length\s*\(\s*\)/g, "$1.length");

  // .contains("x") → .includes("x")
  // (already done above for collection .contains; for strings the same
  // rewrite applies — both end up as .includes, which works on both.)
  // Already covered.

  // .equalsIgnoreCase("x") → .toLowerCase() === "x".toLowerCase()
  body = body.replace(
    /\b([\w.]+)\.equalsIgnoreCase\s*\(\s*([^)]+?)\s*\)/g,
    "$1.toLowerCase() === ($2).toLowerCase()",
  );

  // .replaceAll("regex", "b") → .replace(/regex/g, "b")
  body = body.replace(
    /\b([\w.]+)\.replaceAll\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g,
    "$1.replace(/$2/g, '$3')",
  );

  // .matches("regex") → /regex/.test(<receiver>)
  body = body.replace(
    /\b([\w.]+)\.matches\s*\(\s*"([^"]*)"\s*\)/g,
    "/$2/.test($1)",
  );

  // ============================================================
  // 6) Exception-instance methods
  // ============================================================

  // e.getMessage() → (e as Error).message
  // Conservative — only on bare `e.` / `ex.` / `error.` / `err.` shapes.
  body = body.replace(
    /\b(e|ex|err|error|exception)\.getMessage\s*\(\s*\)/g,
    "($1 as Error).message",
  );
  body = body.replace(
    /\b(e|ex|err|error|exception)\.getStackTrace\s*\(\s*\)/g,
    "($1 as Error).stack",
  );
  body = body.replace(
    /\b(e|ex|err|error|exception)\.printStackTrace\s*\(\s*\)/g,
    "console.error($1)",
  );

  // ============================================================
  // 7) Numeric parsers / type coercion
  // ============================================================

  body = body.replace(/\bInteger\.parseInt\s*\(\s*([^)]+?)\s*\)/g, "parseInt($1, 10)");
  body = body.replace(/\bLong\.parseLong\s*\(\s*([^)]+?)\s*\)/g, "parseInt($1, 10)");
  body = body.replace(/\bDouble\.parseDouble\s*\(\s*([^)]+?)\s*\)/g, "parseFloat($1)");
  body = body.replace(/\bFloat\.parseFloat\s*\(\s*([^)]+?)\s*\)/g, "parseFloat($1)");
  body = body.replace(
    /\bBoolean\.parseBoolean\s*\(\s*([^)]+?)\s*\)/g,
    "(($1) || '').toString().toLowerCase() === 'true'",
  );
  body = body.replace(/\bString\.valueOf\s*\(\s*([^)]+?)\s*\)/g, "String($1)");
  // Integer.toString(n) / String.valueOf are equivalent here.
  body = body.replace(/\bInteger\.toString\s*\(\s*([^)]+?)\s*\)/g, "String($1)");

  // ============================================================
  // 8) Misc Java constructs
  // ============================================================

  // str instanceof String → typeof str === 'string'
  body = body.replace(
    /\b(\w+)\s+instanceof\s+String\b/g,
    "typeof $1 === 'string'",
  );
  body = body.replace(
    /\b(\w+)\s+instanceof\s+Integer\b/g,
    "typeof $1 === 'number'",
  );
  body = body.replace(
    /\b(\w+)\s+instanceof\s+Boolean\b/g,
    "typeof $1 === 'boolean'",
  );

  // System.currentTimeMillis() → Date.now()
  body = body.replace(/\bSystem\.currentTimeMillis\s*\(\s*\)/g, "Date.now()");

  // throw new RuntimeException(e) → throw e
  body = body.replace(
    /\bthrow\s+new\s+RuntimeException\s*\(\s*(\w+)\s*\)/g,
    "throw $1",
  );
  // throw new IllegalArgumentException("msg") → throw new Error("msg")
  body = body.replace(
    /\bthrow\s+new\s+(?:IllegalArgumentException|IllegalStateException|RuntimeException)\s*\(\s*([^)]*)\)/g,
    "throw new Error($1)",
  );

  // ============================================================
  // 9) Surface a single info note if we did anything substantial.
  // ============================================================

  if (body !== raw) {
    warnings.push({
      file: filePath,
      severity: "info",
      message:
        "Java standard-library idioms rewritten to TypeScript (.size, .get, .equals, .length, Integer.parseInt, etc). Verify any complex inline expressions in the converted output — see docs/CONVERSION_PATTERNS.md for the full mapping table.",
    });
  }

  return { body, warnings };
}
