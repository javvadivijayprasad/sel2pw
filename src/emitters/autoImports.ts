/**
 * Auto-import detection for emitted TS files.
 *
 * Each emitter knows what it imports by default (`@playwright/test`,
 * `healOrThrow`, etc.). What it DOESN'T know is which OTHER converted
 * files (page objects, helpers, stubs) the body it's emitting actually
 * references. Without auto-imports, the user has to manually add
 * `import { LoginPage } from '../pages/login.page'` lines for every
 * reference — tedious and error-prone.
 *
 * This module:
 *   1. Builds a class-name → output-path map from the entire conversion run
 *   2. Scans an emitted body for those class names
 *   3. Emits `import { <Name> } from '<relative-path>'` lines
 *
 * v0.11.3 Patch DD — added after real-user audit showed Page Object cross
 * references (e.g. `LoginPage extends BasePage` body referring to
 * `BasePage` without an import) leaving the converted output broken.
 */

import * as path from "path";
import { ConvertedFile } from "../types";

export interface AutoImportSource {
  /** TS class name as it appears in import statements. */
  className: string;
  /** Full relative path of the converted file (e.g. `pages/login.page.ts`). */
  relPath: string;
}

/**
 * Build the class-name → output-path index from all converted files in the
 * current run. Call once per conversion, share across emitters.
 */
export function buildAutoImportIndex(
  converted: ConvertedFile[],
): AutoImportSource[] {
  const out: AutoImportSource[] = [];
  for (const cf of converted) {
    if (!cf.relPath || !cf.source) continue;
    // Match `export class <Name>` declarations in the emitted file.
    const re = /^export\s+(?:abstract\s+)?class\s+(\w+)\b/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cf.source)) !== null) {
      out.push({ className: m[1], relPath: cf.relPath });
    }
  }
  return out;
}

/**
 * Scan an emitted body for references to known classes and return the
 * import lines that should be prepended.
 *
 * Heuristic: a class is "referenced" if its name appears as a standalone
 * identifier (word boundaries, not inside a string literal). False
 * positives are possible (a comment mentioning the class name) but
 * import { X } from 'y' for an unused class is a tsc warning, not a
 * runtime bug — much better than missing imports.
 *
 * @param body              The emitted TS source body
 * @param fromRelPath       The relative path of the file being emitted
 *                          (used to compute relative imports)
 * @param sources           The auto-import index from buildAutoImportIndex
 * @param excludeClassNames Names to skip (e.g. the class being defined
 *                          in this file, default Playwright types)
 */
export function detectMissingImports(
  body: string,
  fromRelPath: string,
  sources: AutoImportSource[],
  excludeClassNames: Set<string> = new Set(),
): string[] {
  const skip = new Set(excludeClassNames);
  // Always skip Playwright + JS built-ins so we never emit duplicate imports.
  for (const k of [
    "Page", "Locator", "expect", "test", "Browser", "BrowserContext",
    "String", "Number", "Boolean", "Array", "Object", "Promise", "Set",
    "Map", "Date", "Math", "JSON", "Error", "RegExp", "Symbol", "console",
  ]) {
    skip.add(k);
  }

  // v0.11.3 Patch DD-fix: also skip any class name already in an existing
  // `import { X } from 'y'` line in this file. Without this, we duplicate
  // imports the test-class / page-object emitter already added (Page
  // Object types, Locator, expect, etc.).
  const existingImportRe = /^\s*import\s*\{\s*([^}]+?)\s*\}\s*from\s*['"]/gm;
  let im: RegExpExecArray | null;
  while ((im = existingImportRe.exec(body)) !== null) {
    for (const part of im[1].split(",")) {
      // Handle `X as Y` (use the local name Y) and `X` (use X).
      const local = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (local) skip.add(local);
    }
  }

  // Strip string literals + comments first so refs inside them don't count.
  const stripped = body
    .replace(/"((?:[^"\\\n]|\\.)*)"/g, '""')
    .replace(/'((?:[^'\\\n]|\\.)*)'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const referenced = new Set<string>();
  // Find any UppercaseStart identifier (with at least one letter after).
  const idRe = /\b([A-Z][A-Za-z0-9_$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(stripped)) !== null) {
    const name = m[1];
    if (skip.has(name)) continue;
    referenced.add(name);
  }

  const imports: string[] = [];
  const seen = new Set<string>();
  for (const ref of referenced) {
    const source = sources.find((s) => s.className === ref);
    if (!source) continue;
    if (source.relPath === fromRelPath) continue; // self-import
    if (seen.has(ref)) continue;
    seen.add(ref);
    const importPath = relativeImportPath(fromRelPath, source.relPath);
    imports.push(`import { ${ref} } from '${importPath}';`);
  }
  return imports.sort();
}

function relativeImportPath(fromRel: string, toRel: string): string {
  const fromDir = path.dirname(fromRel);
  let rel = path.relative(fromDir, toRel).replace(/\\/g, "/");
  // Strip .ts extension; TS imports don't include it.
  rel = rel.replace(/\.ts$/, "");
  // Add leading ./ for sibling/child paths (TS requires it).
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}
