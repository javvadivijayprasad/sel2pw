/**
 * `--bdd-mode flatten` emitter.
 *
 * Converts Cucumber BDD source (.feature files + Java step-def classes)
 * into pure Playwright Test specs. NO playwright-bdd dependency, NO
 * Gherkin runtime, NO .feature files in the output.
 *
 * Each `Scenario` becomes one `test()` call. Each `Scenario Outline`
 * becomes a `for` loop over external JSON data. Step-def bodies are
 * matched to feature steps and inlined. Page Objects are emitted normally
 * (handled by the test-class path).
 *
 * Output layout:
 *
 *   tests/
 *     login.spec.ts            <- one file per .feature
 *     checkout.spec.ts
 *     data/                    <- externalized Scenario Outline data
 *       login-cases.json
 *       checkout-cases.json
 *
 * Step-def Java methods are NOT emitted as separate TS files (unlike the
 * default `playwright-bdd` mode). Their bodies live inline inside each
 * test() call that references them.
 *
 * MVP scope (Phase 11.1 / v0.11.0):
 *   ✓ Feature → describe block
 *   ✓ Background → test.beforeEach
 *   ✓ Scenario → test('name', async ({ page }) => { ...inlined steps... })
 *   ✓ Scenario Outline + Examples → JSON file + parameterised loop
 *   ✓ Tags → grep filter ready (preserved as comments)
 *   ✓ Step-text → step-def regex matching with parameter capture
 *
 * Known limitations (will widen via patches):
 *   - DocStrings (`"""` triple-quoted) — not parsed
 *   - DataTables (step args via | row | row |) — not parsed
 *   - Cucumber expressions ({string}, {int}) work alongside regex patterns
 */

import * as path from "path";
import * as fs from "fs-extra";
import fg from "fast-glob";
import { ConvertedFile, JavaFile, ReviewItem } from "../types";
import { transformMethodBody } from "../transformers/bodyTransformer";
import { dedentAndIndent } from "../utils/indent";
import { parseFeature, FeatureIR, ScenarioIR, StepIR } from "../parser/featureParser";

interface StepDef {
  kind: "Given" | "When" | "Then" | "And" | "But";
  pattern: string;
  paramTypes: string[];
  paramNames: string[];
  body: string;
  sourceFile: string;
  // The pattern compiled into a JS RegExp for matching feature steps.
  regex: RegExp;
}

export async function convertBddFlatten(
  inputDir: string,
  javaFiles: JavaFile[],
): Promise<{ files: ConvertedFile[]; warnings: ReviewItem[] }> {
  const out: ConvertedFile[] = [];
  const warnings: ReviewItem[] = [];

  // 1. Discover .feature files.
  const featureFiles = await fg(["**/*.feature"], {
    cwd: inputDir,
    absolute: true,
    ignore: ["**/target/**", "**/build/**", "**/node_modules/**"],
  });

  if (featureFiles.length === 0) {
    return { files: out, warnings };
  }

  // 2. Extract step defs from all Java step-def classes (those with
  // @Given/@When/@Then annotations).
  const stepDefs: StepDef[] = [];
  const stepClasses = javaFiles.filter((f) =>
    /@(Given|When|Then|And|But)\s*\(/.test(f.source),
  );
  for (const cls of stepClasses) {
    stepDefs.push(...extractStepDefs(cls.source, cls.path));
  }

  if (stepDefs.length === 0) {
    warnings.push({
      file: inputDir,
      severity: "warning",
      message:
        "Found .feature files but no Java step-def classes (no @Given/@When/@Then methods). Cannot inline step bodies in flatten mode.",
    });
    return { files: out, warnings };
  }

  // 3. For each feature file, parse + match steps + emit a flattened spec.
  for (const featurePath of featureFiles) {
    const featureSource = await fs.readFile(featurePath, "utf8");
    const feature = parseFeature(featureSource, featurePath);
    if (!feature) {
      warnings.push({
        file: featurePath,
        severity: "warning",
        message: `Could not parse feature file ${path.basename(featurePath)} — no Feature: line found.`,
      });
      continue;
    }

    // Match every step in the feature (including Background) to a step-def.
    const allSteps = [
      ...(feature.background?.steps ?? []),
      ...feature.scenarios.flatMap((s) => s.steps),
    ];
    let matchedCount = 0;
    let unmatchedCount = 0;
    for (const step of allSteps) {
      const matched = matchStepToDef(step.text, stepDefs);
      if (matched) {
        const transformed = transformMethodBody(
          matched.def.body,
          matched.def.sourceFile,
        );
        warnings.push(...transformed.warnings);
        step.matchedBody = transformed.body;
        step.matchedParams = matched.params;
        matchedCount += 1;
      } else {
        unmatchedCount += 1;
      }
    }

    if (unmatchedCount > 0) {
      warnings.push({
        file: featurePath,
        severity: "manual",
        message:
          `${unmatchedCount} of ${matchedCount + unmatchedCount} step(s) in ` +
          `${path.basename(featurePath)} could not be matched to a step-def. ` +
          `The corresponding test bodies will contain TODO markers — ` +
          `add the step-def or fix the regex pattern.`,
      });
    } else {
      warnings.push({
        file: featurePath,
        severity: "info",
        message: `All ${matchedCount} step(s) in ${path.basename(featurePath)} matched a step-def.`,
      });
    }

    // Emit the flattened spec.
    const specRel = `tests/${kebab(feature.name)}.spec.ts`;
    const dataFiles: { relPath: string; source: string }[] = [];
    const specSource = emitFlattenedSpec(feature, dataFiles);
    out.push({
      relPath: specRel,
      source: specSource,
      warnings: [],
      kind: "test",
    });
    for (const df of dataFiles) {
      out.push({
        relPath: df.relPath,
        source: df.source,
        warnings: [],
        kind: "config",
      });
    }
  }

  const specCount = out.filter((f) => f.relPath.endsWith(".spec.ts")).length;
  const dataCount = out.filter((f) => f.relPath.startsWith("tests/data/")).length;
  warnings.push({
    file: inputDir,
    severity: "info",
    message:
      `Cucumber BDD flattened to pure Playwright Test (` +
      `${featureFiles.length} feature(s) → ${specCount} spec file(s), ${dataCount} data file(s)). ` +
      `Each Scenario is now a test() call; Scenario Outline Examples externalised as JSON in tests/data/.`,
  });

  return { files: out, warnings };
}

// ---- Step-def extraction (mirrors bdd.ts but tracks source file). ----

function extractStepDefs(source: string, sourceFile: string): StepDef[] {
  const out: StepDef[] = [];
  const re =
    /@(Given|When|Then|And|But)\s*\(\s*"([^"]*)"\s*\)\s*public\s+\w+\s+\w+\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const kind = m[1] as StepDef["kind"];
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
    out.push({
      kind,
      pattern,
      paramTypes,
      paramNames,
      body,
      sourceFile,
      regex: compileStepPattern(pattern),
    });
  }
  return out;
}

/**
 * Compile a step-def pattern (regex OR cucumber expression) into a JS RegExp.
 *
 * Cucumber expressions like `user enters {string}` translate to
 * `^user enters "([^"]+)"$` (the {string} placeholder captures a quoted
 * value). Raw regex patterns like `^user enters "([^"]*)"$` are used
 * verbatim (we just normalise leading/trailing anchors).
 */
function compileStepPattern(pattern: string): RegExp {
  // Heuristic: if the pattern contains any of `^`, `$`, `\\`, or `(...)`,
  // treat it as a raw regex. Otherwise treat as cucumber expression.
  const looksLikeRegex = /[\^$\\()[\]+*]/.test(pattern);
  let body: string;
  if (looksLikeRegex) {
    body = pattern;
  } else {
    // Cucumber expression: replace {string}/{int}/{float}/{word} with
    // capturing groups.
    body = pattern
      .replace(/\{string\}/g, '"([^"]*)"')
      .replace(/\{int\}/g, "(-?\\d+)")
      .replace(/\{float\}/g, "(-?\\d+\\.\\d+)")
      .replace(/\{word\}/g, "(\\w+)");
  }
  // Anchor if not already anchored.
  if (!body.startsWith("^")) body = "^" + body;
  if (!body.endsWith("$")) body = body + "$";
  // Escape Java's `\\\"` (already-escaped double quote) which JS sees as `\"`.
  body = body.replace(/\\"/g, '"');
  try {
    return new RegExp(body);
  } catch {
    // Fall back to a literal text match.
    return new RegExp("^" + escapeRegex(pattern) + "$");
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

// ---- Step matching: feature step text → step-def. ----

interface MatchedStep {
  def: StepDef;
  params: string[];
}

function matchStepToDef(
  stepText: string,
  defs: StepDef[],
): MatchedStep | null {
  for (const def of defs) {
    const m = stepText.match(def.regex);
    if (m) {
      return { def, params: m.slice(1) };
    }
  }
  return null;
}

// ---- Spec emitter. ----

function emitFlattenedSpec(
  feature: FeatureIR,
  dataFiles: { relPath: string; source: string }[],
): string {
  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);

  // Page Object imports — collect any types referenced in step bodies. The
  // emitter handles import generation in the test-class path; here we keep
  // it simple and let the user import whatever Page Objects they need.
  // (A future patch will scan inlined step bodies for `new XxxPage(...)`
  // and emit the imports automatically.)
  lines.push("");
  lines.push(
    `// Note: import any Page Object classes you reference inside the inlined`,
  );
  lines.push(
    `// step bodies, e.g. \`import { LoginPage } from '../pages/login.page';\``,
  );
  lines.push("");

  if (feature.tags.length > 0) {
    lines.push(`// Feature tags: ${feature.tags.join(" ")}`);
  }
  lines.push(`test.describe(${JSON.stringify(feature.name)}, () => {`);

  // Background → test.beforeEach
  if (feature.background && feature.background.steps.length > 0) {
    lines.push("  test.beforeEach(async ({ page }) => {");
    emitInlinedSteps(feature.background.steps, "    ", lines);
    lines.push("  });");
    lines.push("");
  }

  // Scenarios + Outlines
  for (const scenario of feature.scenarios) {
    if (scenario.tags.length > 0) {
      lines.push(`  // Tags: ${scenario.tags.join(" ")}`);
    }

    if (scenario.type === "scenario") {
      lines.push(
        `  test(${JSON.stringify(scenario.name)}, async ({ page }) => {`,
      );
      emitInlinedSteps(scenario.steps, "    ", lines);
      lines.push("  });");
      lines.push("");
    } else if (scenario.type === "scenario-outline") {
      // Externalize Examples to JSON.
      const dataKey = kebab(scenario.name);
      const dataRel = `tests/data/${kebab(feature.name)}-${dataKey}.json`;
      const dataImportPath = `./data/${kebab(feature.name)}-${dataKey}.json`;
      const examples = scenario.examples;
      if (examples) {
        const json = examples.rows.map((row) =>
          Object.fromEntries(examples.headers.map((h, i) => [h, row[i] ?? ""])),
        );
        dataFiles.push({
          relPath: dataRel,
          source: JSON.stringify(json, null, 2) + "\n",
        });
        // Import the data + emit a parameterised for-loop with test() inside.
        lines.push(`  // Scenario Outline data externalised to ${dataRel}`);
        lines.push(`  // eslint-disable-next-line @typescript-eslint/no-require-imports`);
        lines.push(
          `  const ${camelCase(dataKey)}Data = require(${JSON.stringify(dataImportPath)}) as Array<Record<string, string>>;`,
        );
        lines.push(`  for (const row of ${camelCase(dataKey)}Data) {`);
        const titleTemplate = scenario.examples!.headers
          .map((h) => `\${row.${h}}`)
          .join(", ");
        lines.push(
          `    test(\`${scenario.name} (${titleTemplate})\`, async ({ page }) => {`,
        );
        emitInlinedSteps(scenario.steps, "      ", lines, examples.headers);
        lines.push("    });");
        lines.push("  }");
        lines.push("");
      } else {
        lines.push(
          `  // Scenario Outline ${JSON.stringify(scenario.name)} has no Examples — skipped.`,
        );
        lines.push("");
      }
    }
  }

  lines.push(`});`);
  lines.push("");
  return lines.join("\n");
}

function emitInlinedSteps(
  steps: StepIR[],
  indent: string,
  lines: string[],
  outlineParams?: string[],
): void {
  for (const step of steps) {
    lines.push(`${indent}// ${step.keyword} ${step.text}`);
    if (step.matchedBody) {
      let body = step.matchedBody;
      // For Scenario Outline: replace <param> placeholders in step text with
      // template-literal references. The step's matchedBody comes from the
      // step-def whose param positions are already filled by matchedParams.
      // For outline params we substitute `<header>` → `row.header` in body
      // string-literal positions.
      if (outlineParams) {
        for (const h of outlineParams) {
          const pat = new RegExp(`<${h}>`, "g");
          body = body.replace(pat, `\${row.${h}}`);
          // Convert "double-quoted" literals containing the substitution
          // back to template literals so the placeholder evaluates.
          body = body.replace(
            new RegExp(`"([^"]*\\$\\{row\\.${h}\\}[^"]*)"`, "g"),
            "`$1`",
          );
        }
      }
      // Substitute matched params positionally (e.g. ${param0}) with the
      // captured values. The step-def body uses the original Java param
      // names, but our matchedParams are positional — for the MVP we leave
      // the body as-is since step-def bodies typically reference the param
      // names directly which already exist in scope after Java→TS
      // transformation.
      lines.push(dedentAndIndent(body, indent));
    } else {
      lines.push(
        `${indent}// TODO(sel2pw): no step-def matched "${step.text}" — implement here.`,
      );
      lines.push(
        `${indent}throw new Error('sel2pw: unmatched step "${step.text.replace(/'/g, "\\'")}" — see CONVERSION_REVIEW.md');`,
      );
    }
  }
}

function kebab(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function camelCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}
