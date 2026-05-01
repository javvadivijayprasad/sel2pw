import { ConvertedFile, JavaFile, ReviewItem } from "../types";
import { transformMethodBody } from "../transformers/bodyTransformer";
import { javaTypeToTs, toKebabCase } from "../utils/naming";
import { dedentAndIndent } from "../utils/indent";

/**
 * Convert a Selenium-using utility class to a TypeScript helper class.
 *
 * Sister to `customUtilDetector.emitUtilityStub`. Where `emitUtilityStub`
 * produces a stub for utilities with no Selenium API calls (Excel readers,
 * JSON parsers, DB connectors, retry analysers — things that need real
 * npm-package replacements), this emitter produces a CONVERTED helper for
 * utilities that DO use Selenium API and therefore can be translated:
 *
 *   - `clickElement(WebElement el)` → `clickElement(el: Locator)` with body
 *     run through `transformMethodBody` (driver/By/element calls rewritten)
 *   - `WebDriver` parameters → drop or rewrite to `Page`
 *   - `By` parameters → rewrite to `Locator`
 *
 * Output goes to `tests/helpers/<name>.ts` (instead of `tests/_legacy-stubs/`).
 * Call sites still work because the public method names are preserved.
 *
 * Heuristic for "Selenium-using":
 *   - Method body contains `driver.findElement` / `By\.` / `WebElement` /
 *     `WebDriverWait` / `el.click()` / etc.
 *   - OR class has a `WebDriver` / `WebElement` field
 *
 * Added in v0.11.1 from real-user feedback: utility classes with Selenium
 * calls in their bodies were being stubbed instead of converted, leaving
 * the converted spec files riddled with `await Helpers.notImplemented(...)`
 * call sites.
 */

export function hasSeleniumApi(source: string): boolean {
  return (
    /\bdriver\.findElement/.test(source) ||
    /\bdriver\.findElements/.test(source) ||
    /\bBy\.\w+\s*\(/.test(source) ||
    /\bWebDriverWait\b/.test(source) ||
    /\bnew\s+Actions\s*\(/.test(source) ||
    /\bWebElement\b/.test(source) ||
    /@FindBy\b/.test(source) ||
    /\bdriver\.(get|navigate|switchTo|getTitle|getCurrentUrl|getPageSource|manage|getWindowHandles)/.test(source)
  );
}

interface HelperMethod {
  name: string;
  isStatic: boolean;
  isAsync: boolean;
  returnType: string;
  paramSig: string;
  body: string;
}

export function emitConvertibleHelper(file: JavaFile): {
  converted: ConvertedFile;
  warnings: ReviewItem[];
} {
  const warnings: ReviewItem[] = [];
  const methods = extractPublicMethods(file.source);
  const lines: string[] = [];
  const baseName = toKebabCase(file.className).replace(
    /-(?:utils?|utility|helpers?|service|manager)$/,
    "",
  );

  lines.push(`import { Locator, Page, expect } from '@playwright/test';`);
  lines.push("");
  lines.push(`/**`);
  lines.push(
    ` * Converted helper class from your Selenium suite (${file.className}).`,
  );
  lines.push(
    ` * Method bodies have been auto-translated through sel2pw's body transformer:`,
  );
  lines.push(` *   - WebDriver / WebElement / By → Page / Locator`);
  lines.push(` *   - el.click() → await locator.click()`);
  lines.push(` *   - Thread.sleep / WebDriverWait removed (Playwright auto-waits)`);
  lines.push(` *`);
  lines.push(
    ` * Verify each method body — complex Selenium constructs may need manual review.`,
  );
  lines.push(` * See CONVERSION_REVIEW.md for items flagged for inspection.`);
  lines.push(` */`);
  lines.push(`export class ${file.className} {`);

  if (methods.length === 0) {
    lines.push(`  // No public methods detected.`);
    warnings.push({
      file: file.path,
      severity: "warning",
      message: `${file.className}: no public methods extracted — verify the class shape and re-run if methods are missing.`,
    });
  }

  for (const m of methods) {
    let body = m.body;
    // v0.11.1 Patch G: when a parameter is typed `Keys` (Selenium enum for
    // Tab/Enter/Escape/etc.), `objWebElement.sendKeys(<keysParam>)` should
    // map to `await locator.press(<keysParam>)`, not `await locator.fill(...)`.
    // Detect Keys-typed params and pre-rewrite the body before bodyTransformer
    // runs (so apiMap's sendKeys → fill rule doesn't grab it first).
    const keysParams = extractKeysParamNames(m.paramSig);
    if (keysParams.length > 0) {
      for (const kp of keysParams) {
        // <el>.sendKeys(<keysParam>) → <el>.press(<keysParam>)
        const pressRe = new RegExp(`(\\w+)\\.sendKeys\\s*\\(\\s*${escapeRegex(kp)}\\s*\\)`, "g");
        body = body.replace(pressRe, `$1.press(${kp})`);
        // <keysParam>.name() → <keysParam> (the param is now a plain string)
        body = body.replace(new RegExp(`\\b${escapeRegex(kp)}\\.name\\s*\\(\\s*\\)`, "g"), kp);
      }
    }

    const transformed = transformMethodBody(body, file.path);
    warnings.push(...transformed.warnings);
    const tsParams = rewriteSeleniumParams(m.paramSig);
    const tsReturn = rewriteSeleniumReturnType(m.returnType);
    const asyncKeyword = m.isAsync ? "async " : "";
    const staticKeyword = m.isStatic ? "static " : "";
    lines.push("");
    lines.push(`  ${staticKeyword}${asyncKeyword}${m.name}(${tsParams})${tsReturn ? ": " + tsReturn : ""} {`);
    lines.push(dedentAndIndent(transformed.body, "    "));
    lines.push(`  }`);
  }

  lines.push(`}`);
  lines.push("");

  return {
    converted: {
      relPath: `tests/helpers/${baseName}.ts`,
      source: lines.join("\n"),
      warnings: [],
      kind: "config",
    },
    warnings,
  };
}

function extractPublicMethods(source: string): HelperMethod[] {
  const out: HelperMethod[] = [];
  // Public method signature: visibility static? returnType name(params) [throws ...] {
  const re =
    /(public|protected)\s+(static\s+)?(?:final\s+)?([\w<>[\],\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const isStatic = !!m[2];
    const returnType = m[3].trim();
    const name = m[4];
    const paramSig = m[5].trim();
    // Skip constructors (returnType is class name, name === class name).
    if (name === returnType) continue;
    const bodyStart = m.index + m[0].length - 1;
    const body = readBraced(source, bodyStart);
    if (!body) continue;
    // Always emit as async — Playwright operations are all async.
    const isAsync = true;
    out.push({
      name,
      isStatic,
      isAsync,
      returnType,
      paramSig,
      body,
    });
  }
  return out;
}

function rewriteSeleniumParams(paramSig: string): string {
  if (!paramSig.trim()) return "";
  return paramSig
    .split(",")
    .map((p) => {
      const parts = p.trim().split(/\s+/);
      if (parts.length < 2) return p.trim();
      const name = parts[parts.length - 1];
      const type = parts.slice(0, -1).join(" ");
      // Selenium → Playwright type rewrites for parameter positions.
      let tsType = type;
      if (/^WebDriver$/.test(type)) tsType = "Page";
      else if (/^WebElement$/.test(type)) tsType = "Locator";
      else if (/^By$/.test(type)) tsType = "string"; // selectors come in as strings
      else if (/^List<\s*WebElement\s*>$/.test(type)) tsType = "Locator";
      else if (/^Keys$/.test(type)) tsType = "string"; // v0.11.1 Patch G — Selenium Keys enum becomes a string key name
      else tsType = javaTypeToTs(type);
      return `${name}: ${tsType}`;
    })
    .join(", ");
}

/**
 * Find param names whose declared type is the Selenium `Keys` enum. The
 * helperClassEmitter uses these names to pre-rewrite `el.sendKeys(<keysParam>)`
 * → `el.press(<keysParam>)` BEFORE the body transformer runs (so the
 * default sendKeys → fill rule doesn't grab it first).
 */
function extractKeysParamNames(paramSig: string): string[] {
  if (!paramSig.trim()) return [];
  const names: string[] = [];
  for (const p of paramSig.split(",")) {
    const parts = p.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const type = parts.slice(0, -1).join(" ");
    if (/^Keys$/.test(type)) names.push(parts[parts.length - 1]);
  }
  return names;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteSeleniumReturnType(returnType: string): string {
  if (!returnType || returnType === "void") return "Promise<void>";
  if (returnType === "WebDriver") return "Promise<Page>";
  if (returnType === "WebElement") return "Promise<Locator>";
  if (/^List<\s*WebElement\s*>$/.test(returnType)) return "Promise<Locator>";
  // For everything else, wrap in Promise<> since we forced async above.
  return `Promise<${javaTypeToTs(returnType)}>`;
}

function readBraced(source: string, start: number): string | null {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let p = start; p < source.length; p++) {
    const c = source[p];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(start + 1, p);
    }
  }
  return null;
}
