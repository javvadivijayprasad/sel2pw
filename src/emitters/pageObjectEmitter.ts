import { ConvertedFile, PageObjectIR, ReviewItem } from "../types";
import {
  renderLocatorFieldAssignment,
  renderLocatorFieldDeclaration,
  toPlaywrightLocatorExpr,
} from "../transformers/locatorMapper";
import { transformMethodBody } from "../transformers/bodyTransformer";
import { javaTypeToTs, pageObjectFileName } from "../utils/naming";
import { dedentAndIndent } from "../utils/indent";

export interface EmitPageObjectOptions {
  /**
   * When true, locator initialisers are wrapped in `healOrThrow` so the
   * converted Page Object integrates with `self-healing-stage-services`
   * at runtime.
   */
  selfHealingShim?: boolean;
}

/**
 * Render a Java Page Object IR as a Playwright TypeScript Page Object.
 *
 * Output shape (without self-healing shim):
 *   import { Page, Locator, expect } from '@playwright/test';
 *   export class LoginPage {
 *     readonly page: Page;
 *     readonly usernameInput: Locator;
 *     ...
 *     constructor(page: Page) {
 *       this.page = page;
 *       this.usernameInput = page.locator('#username');
 *       ...
 *     }
 *   }
 *
 * With selfHealingShim: true, locator init becomes:
 *   this.usernameInput = healOrThrow(page, {
 *     preferred: page.locator('#username'),
 *     context: { page: 'LoginPage', name: 'usernameInput' },
 *   });
 */
export function emitPageObject(
  ir: PageObjectIR,
  sourceFilePath: string,
  opts: EmitPageObjectOptions = {},
): ConvertedFile {
  const warnings: ReviewItem[] = [];
  const lines: string[] = [];

  lines.push(`import { Page, Locator, expect } from '@playwright/test';`);
  if (opts.selfHealingShim) {
    lines.push(`import { healOrThrow } from '@platform/sdk-self-healing';`);
  }
  lines.push("");
  lines.push(`export class ${ir.className} {`);
  lines.push(`  readonly page: Page;`);
  for (const f of ir.fields) {
    lines.push(renderLocatorFieldDeclaration(f));
  }
  lines.push("");
  lines.push(`  constructor(page: Page) {`);
  lines.push(`    this.page = page;`);
  for (const f of ir.fields) {
    if (opts.selfHealingShim) {
      const preferred = toPlaywrightLocatorExpr(f.by, f.value, "page");
      lines.push(`    this.${f.name} = healOrThrow(page, {`);
      lines.push(`      preferred: ${preferred},`);
      lines.push(`      context: { page: ${JSON.stringify(ir.className)}, name: ${JSON.stringify(f.name)} },`);
      lines.push(`    });`);
    } else {
      lines.push(renderLocatorFieldAssignment(f));
    }
  }
  lines.push(`  }`);

  // Methods
  for (const method of ir.methods) {
    lines.push("");
    if (method.javadoc) {
      // Indent the preserved JSDoc to match the class-method indent (2 spaces).
      for (const docLine of method.javadoc.split("\n")) {
        lines.push("  " + docLine);
      }
    }
    const tsParams = method.params
      .map((p) => `${p.name}: ${rewriteSeleniumType(p.javaType)}`)
      .join(", ");
    const tsReturn =
      method.returnType === "void"
        ? "Promise<void>"
        : `Promise<${rewriteSeleniumType(method.returnType)}>`;

    // v0.11.1 Patch I: when a method parameter is typed `By` (a Selenium
    // selector), the body's `driver.findElement(<paramName>)` call must
    // become `this.page.locator(<paramName>)` — NOT `this.<paramName>`.
    // The apiMap rewrite "driver.findElement(<bareField>) → this.<bareField>"
    // is correct for class fields but wrong for method parameters. We
    // pre-process the body here, BEFORE bodyTransformer runs, so the
    // apiMap rule never sees the parameter form.
    let preBody = method.rawBody;
    for (const p of method.params) {
      if (p.javaType === "By") {
        // driver.findElement(<param>) -> this.page.locator(<param>)
        const re = new RegExp(
          `\\bdriver\\.findElement\\s*\\(\\s*${escapeRegex(p.name)}\\s*\\)`,
          "g",
        );
        preBody = preBody.replace(re, `this.page.locator(${p.name})`);
        // driver.findElements(<param>) -> this.page.locator(<param>)
        const reAll = new RegExp(
          `\\bdriver\\.findElements\\s*\\(\\s*${escapeRegex(p.name)}\\s*\\)`,
          "g",
        );
        preBody = preBody.replace(reAll, `this.page.locator(${p.name})`);
      }
    }

    const transformed = transformMethodBody(preBody, sourceFilePath);
    warnings.push(...transformed.warnings);

    // Pre-collect parameter names — referenced by both the catch-all
    // sibling rewrite (Patch P) and the field-prefix loop below.
    const paramNames = new Set(method.params.map((p) => p.name));

    // Sibling-method calls (e.g. enterUsername(x)) inside this Page Object
    // need `await this.<m>(...)`. We don't touch identifiers that already
    // start with `this.` or `await `.
    let body = transformed.body;
    for (const sibling of ir.methods) {
      const re = new RegExp(`(^|[^\\w.])(?<!await\\s)${sibling.name}\\s*\\(`, "gm");
      body = body.replace(re, (_m, pre) => `${pre}await this.${sibling.name}(`);
    }

    // v0.11.3 Patch P: catch-all for inherited / parent-class methods that
    // aren't in `ir.methods`. Rewrites bare `<camelCaseName>(...)` calls
    // to `await this.<name>(...)`.
    //
    // Patch U (CRITICAL fix): protect string literals + comment lines
    // before applying. Without this, XPath expressions like
    // `By.xpath("//a[text()='X']")` get mangled to
    // `By.xpath("//a[await this.text()='X']")` because `text()` is inside
    // a string but the regex doesn't know that.
    const KNOWN_GLOBALS = new Set([
      "if", "else", "for", "while", "do", "switch", "case", "return", "throw",
      "try", "catch", "finally", "new", "typeof", "instanceof", "void",
      "function", "async", "await", "yield", "break", "continue", "default",
      "delete", "in", "of", "let", "const", "var",
      "console", "expect", "test", "page", "JSON", "Math", "Date", "String",
      "Number", "Boolean", "Array", "Object", "Promise", "Set", "Map",
      "Symbol", "Error", "RegExp", "parseInt", "parseFloat", "isNaN",
      "isFinite", "encodeURIComponent", "decodeURIComponent",
      "require", "describe", "it", "beforeEach", "afterEach", "beforeAll", "afterAll",
      // XPath / CSS function names that show up inside locator strings
      "text", "contains", "starts", "ends", "normalize", "translate",
      "concat", "substring", "string", "boolean", "number", "count",
      "id", "name", "lang", "local", "namespace", "position", "last",
      "current", "key", "format", "ceiling", "floor", "round",
    ]);

    // Step 1: replace string literals + line/block comments with placeholders
    // so Patch P can't see method-call shapes inside them.
    const protectedFrags: string[] = [];
    const placeholder = (i: number) => `__SEL2PW_PROTECTED_${i}__`;
    let scratch = body
      .replace(/"((?:[^"\\\n]|\\.)*)"/g, (m) => {
        protectedFrags.push(m);
        return placeholder(protectedFrags.length - 1);
      })
      .replace(/'((?:[^'\\\n]|\\.)*)'/g, (m) => {
        protectedFrags.push(m);
        return placeholder(protectedFrags.length - 1);
      })
      .replace(/`(?:[^`\\]|\\.)*`/g, (m) => {
        protectedFrags.push(m);
        return placeholder(protectedFrags.length - 1);
      })
      .replace(/\/\/[^\n]*/g, (m) => {
        protectedFrags.push(m);
        return placeholder(protectedFrags.length - 1);
      })
      .replace(/\/\*[\s\S]*?\*\//g, (m) => {
        protectedFrags.push(m);
        return placeholder(protectedFrags.length - 1);
      });

    // Step 2: apply Patch P transform on the placeholder-protected body.
    scratch = scratch.replace(
      /(^|[^\w.])(?<!await\s)([a-z][a-zA-Z0-9]*)\s*\(/gm,
      (m, pre: string, name: string) => {
        if (KNOWN_GLOBALS.has(name)) return m;
        if (paramNames.has(name)) return m;
        return `${pre}await this.${name}(`;
      },
    );

    // Step 3: restore string literals + comments.
    // v0.11.3 Patch AA: restore recursively until no placeholders remain.
    // A protected fragment can itself contain a placeholder (when the
    // double-quote pass protected `"x"` first, then the single-quote
    // pass protected `'[name="x"]'` whose content already had the
    // double-quote placeholder embedded). Single-pass replace leaves
    // the inner placeholder unrestored — loop until stable.
    body = scratch;
    let prev: string;
    do {
      prev = body;
      body = body.replace(
        /__SEL2PW_PROTECTED_(\d+)__/g,
        (_, i: string) => protectedFrags[parseInt(i, 10)] ?? "",
      );
    } while (body !== prev);

    // PageFactory shape: `usernameInput.fill(...)` (bare identifier) needs to
    // become `this.usernameInput.fill(...)`. We don't touch fields already
    // prefixed with `this.` or that appear as part of a longer identifier.
    // v0.11.1 Patch I: also skip if the field name matches a method
    // parameter — parameters are local to the method and should NOT be
    // rewritten to `this.<name>` (paramNames pre-collected above).
    for (const f of ir.fields) {
      if (paramNames.has(f.name)) continue;
      const re = new RegExp(`(^|[^\\w.])${f.name}\\b`, "g");
      body = body.replace(re, (_m, pre) => `${pre}this.${f.name}`);
    }

    lines.push(`  async ${method.name}(${tsParams}): ${tsReturn} {`);
    lines.push(dedentAndIndent(body, "    "));
    lines.push(`  }`);
  }

  // Surface unknown fields as warnings
  for (const u of ir.unknownFields) {
    warnings.push({
      file: sourceFilePath,
      severity: "warning",
      message: `Page Object field not auto-converted: \`${u}\` — port manually if used by tests.`,
    });
  }

  lines.push(`}`);
  lines.push("");

  return {
    relPath: `pages/${pageObjectFileName(ir.className)}`,
    source: lines.join("\n"),
    warnings,
    kind: "page-object",
  };
}

/**
 * Map a Java parameter / return type to a TS type, with Selenium-aware
 * rewrites that `javaTypeToTs` (the general-purpose mapper) doesn't know
 * about.
 *
 *   By               → string         (selectors are strings in Playwright)
 *   WebElement       → Locator        (Playwright's Locator IS the element)
 *   WebDriver        → Page           (the fixture-injected page object)
 *   List<WebElement> → Locator        (Locator already represents a list)
 *   Keys             → string         (Playwright press takes a key name)
 *
 * v0.11.1 Patch I — added when real-user output showed `By` leaking into
 * method signatures (the params used Java's `By` type, javaTypeToTs passed
 * it through unchanged, so the TS spec had `elementLocation: By` which
 * didn't compile).
 */
function rewriteSeleniumType(javaType: string): string {
  const t = javaType.trim();
  if (t === "By") return "string";
  if (t === "WebElement") return "Locator";
  if (t === "WebDriver") return "Page";
  if (t === "Keys") return "string";
  if (/^List<\s*WebElement\s*>$/.test(t)) return "Locator";
  if (/^List<\s*By\s*>$/.test(t)) return "string[]";
  return javaTypeToTs(t);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
