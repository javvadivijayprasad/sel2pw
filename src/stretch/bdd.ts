/**
 * Cucumber BDD → playwright-bdd skeleton.
 *
 * STATUS: Phase 5 stretch — skeleton implementation. Sufficient for the
 * common shape (one feature file + Java step defs) but does not yet handle
 * scenario outlines with parameterised examples, hooks (`@Before`,
 * `@After` from `io.cucumber.java.Before`), or DataTable parameters.
 *
 * Strategy:
 *   1. Carry `.feature` files through verbatim (playwright-bdd reads them).
 *   2. Extract step definitions from Java classes annotated `@Given`,
 *      `@When`, `@Then` and emit them as playwright-bdd `Given/When/Then`
 *      handlers in a TS file. Pattern strings translate cucumber's
 *      cucumber-expression `{string}` / `{int}` into the same shape.
 *   3. Emit a tiny `playwright-bdd.config.ts` pointing at the features dir.
 */

import * as path from "path";
import * as fs from "fs-extra";
import fg from "fast-glob";
import { ConvertedFile, JavaFile, ReviewItem } from "../types";
import { transformMethodBody } from "../transformers/bodyTransformer";
import { dedentAndIndent } from "../utils/indent";

interface Step {
  kind: "Given" | "When" | "Then" | "And" | "But";
  pattern: string;
  paramTypes: string[];
  paramNames: string[];
  body: string;
}

export async function convertBdd(
  inputDir: string,
  javaFiles: JavaFile[],
): Promise<{ files: ConvertedFile[]; warnings: ReviewItem[] }> {
  const out: ConvertedFile[] = [];
  const warnings: ReviewItem[] = [];

  // 1. Carry .feature files through.
  const featureFiles = await fg(["**/*.feature"], {
    cwd: inputDir,
    absolute: true,
    ignore: ["**/target/**", "**/build/**", "**/node_modules/**"],
  });
  for (const f of featureFiles) {
    const text = await fs.readFile(f, "utf8");
    const rel = path.relative(inputDir, f).replace(/\\/g, "/");
    out.push({
      relPath: `features/${path.basename(rel)}`,
      source: text,
      warnings: [],
      kind: "config",
    });
  }

  // 2. Find step definition classes (heuristic: any class containing @Given/@When/@Then).
  const stepClasses = javaFiles.filter((f) =>
    /@(Given|When|Then|And|But)\s*\(/.test(f.source),
  );

  for (const stepClass of stepClasses) {
    const steps = extractSteps(stepClass.source);
    if (steps.length === 0) continue;
    const tsName = stepClass.className
      .replace(/Steps?$/i, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase();
    const lines: string[] = [];
    lines.push(`import { createBdd } from 'playwright-bdd';`);
    lines.push(`import { test } from '../fixtures'; // or '@playwright/test'`);
    lines.push("");
    lines.push(`const { Given, When, Then } = createBdd(test);`);
    lines.push("");
    for (const step of steps) {
      const transformed = transformMethodBody(step.body, stepClass.path);
      warnings.push(...transformed.warnings);
      const tsParams = step.paramNames
        .map((n, i) => `${n}: ${cucumberToTsType(step.paramTypes[i])}`)
        .join(", ");
      const fn = step.kind === "And" || step.kind === "But" ? "When" : step.kind;
      lines.push(`${fn}(${JSON.stringify(step.pattern)}, async ({ page }${tsParams ? `, ${tsParams}` : ""}) => {`);
      lines.push(dedentAndIndent(transformed.body, "  "));
      lines.push(`});`);
      lines.push("");
    }
    out.push({
      relPath: `steps/${tsName}.steps.ts`,
      source: lines.join("\n"),
      warnings: [],
      kind: "test",
    });
  }

  if (out.length > 0) {
    out.push({
      relPath: "playwright-bdd.config.ts",
      source: [
        `import { defineBddConfig } from 'playwright-bdd';`,
        ``,
        `export default defineBddConfig({`,
        `  features: 'features/**/*.feature',`,
        `  steps: 'steps/**/*.steps.ts',`,
        `});`,
        ``,
      ].join("\n"),
      warnings: [],
      kind: "config",
    });
    warnings.push({
      file: inputDir,
      severity: "info",
      message: `Cucumber BDD detected (${featureFiles.length} feature(s), ${stepClasses.length} step class(es)). Generated playwright-bdd skeleton — install with \`npm install -D playwright-bdd\` and follow https://vitalets.github.io/playwright-bdd/.`,
    });
  }

  return { files: out, warnings };
}

function extractSteps(source: string): Step[] {
  const out: Step[] = [];
  const re =
    /@(Given|When|Then|And|But)\s*\(\s*"([^"]*)"\s*\)\s*public\s+\w+\s+\w+\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const kind = m[1] as Step["kind"];
    const pattern = m[2];
    const paramsRaw = m[3].trim();
    const paramNames: string[] = [];
    const paramTypes: string[] = [];
    if (paramsRaw) {
      for (const p of paramsRaw.split(",")) {
        const parts = p.trim().split(/\s+/);
        paramNames.push(parts[parts.length - 1]);
        paramTypes.push(parts.slice(0, -1).join(" "));
      }
    }
    const bodyStart = m.index + m[0].length - 1;
    const body = readBraced(source, bodyStart);
    if (!body) continue;
    out.push({ kind, pattern, paramTypes, paramNames, body });
  }
  return out;
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

function cucumberToTsType(javaType: string): string {
  if (javaType === "String") return "string";
  if (["int", "Integer", "long", "Long", "double", "float"].includes(javaType)) return "number";
  if (javaType === "boolean" || javaType === "Boolean") return "boolean";
  return "unknown";
}
