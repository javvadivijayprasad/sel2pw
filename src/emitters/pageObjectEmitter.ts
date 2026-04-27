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
      .map((p) => `${p.name}: ${javaTypeToTs(p.javaType)}`)
      .join(", ");
    const tsReturn =
      method.returnType === "void"
        ? "Promise<void>"
        : `Promise<${javaTypeToTs(method.returnType)}>`;

    const transformed = transformMethodBody(method.rawBody, sourceFilePath);
    warnings.push(...transformed.warnings);

    // Sibling-method calls (e.g. enterUsername(x)) inside this Page Object
    // need `await this.<m>(...)`. We don't touch identifiers that already
    // start with `this.` or `await `.
    let body = transformed.body;
    for (const sibling of ir.methods) {
      const re = new RegExp(`(^|[^\\w.])(?<!await\\s)${sibling.name}\\s*\\(`, "gm");
      body = body.replace(re, (_m, pre) => `${pre}await this.${sibling.name}(`);
    }

    // PageFactory shape: `usernameInput.fill(...)` (bare identifier) needs to
    // become `this.usernameInput.fill(...)`. We don't touch fields already
    // prefixed with `this.` or that appear as part of a longer identifier.
    for (const f of ir.fields) {
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
