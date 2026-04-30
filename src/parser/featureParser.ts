/**
 * Gherkin .feature file parser.
 *
 * Used by the `--bdd-mode flatten` path (Phase 11 / v0.11.0). Where the
 * default BDD path passes .feature files through verbatim for
 * `playwright-bdd` to consume, the flatten path needs an actual structured
 * representation so it can emit one `test()` call per Scenario, externalize
 * Scenario Outline Examples to JSON, and inline step-def bodies into the
 * test bodies.
 *
 * Implementation: line-based regex parser. Sufficient for the common shape
 * (Feature with optional Background, multiple Scenarios, Scenario Outlines
 * with Examples, tags). Edge cases NOT yet supported:
 *
 *   - Multi-line step arguments (DocStrings using `"""` triple quotes)
 *   - Step arguments via DataTable (`| key | value |` rows after a step)
 *   - Rules block (Gherkin 6+)
 *   - Internationalization (only English keywords `Feature` / `Scenario` /
 *     `Given` / `When` / `Then` / `And` / `But` / `Background` / `Examples`)
 *
 * If users hit those, we widen — Phase 11.x patches like the apiMap loop.
 */

export interface FeatureIR {
  name: string;
  description: string[];
  background?: ScenarioIR;
  scenarios: ScenarioIR[];
  tags: string[];
  filePath: string;
  rawSource: string;
}

export interface ScenarioIR {
  name: string;
  type: "scenario" | "scenario-outline" | "background";
  tags: string[];
  steps: StepIR[];
  examples?: ExamplesIR;
}

export interface StepIR {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  text: string;
  // Filled in by the step-def matcher in flattenedSpecEmitter.
  matchedBody?: string;
  matchedParams?: string[];
}

export interface ExamplesIR {
  headers: string[];
  rows: string[][];
}

const FEATURE_RE = /^Feature:\s*(.+)$/;
const BACKGROUND_RE = /^Background:\s*(.*)$/;
const SCENARIO_RE = /^Scenario:\s*(.+)$/;
const SCENARIO_OUTLINE_RE = /^Scenario Outline:\s*(.+)$/;
const EXAMPLES_RE = /^Examples:\s*(.*)$/;
const STEP_RE = /^(Given|When|Then|And|But)\s+(.+)$/;
const TAG_RE = /^(@[\w-]+(\s+@[\w-]+)*)\s*$/;
const COMMENT_RE = /^#/;
const TABLE_ROW_RE = /^\|(.+)\|$/;

export function parseFeature(source: string, filePath: string): FeatureIR | null {
  const lines = source.split(/\r?\n/);
  const feature: FeatureIR = {
    name: "",
    description: [],
    scenarios: [],
    tags: [],
    filePath,
    rawSource: source,
  };

  let i = 0;
  let pendingTags: string[] = [];

  // ---- Header pass: tags + Feature: line + description until first
  // Background/Scenario/Scenario Outline.
  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;
    if (line === "" || COMMENT_RE.test(line)) continue;
    const tagMatch = line.match(TAG_RE);
    if (tagMatch) {
      pendingTags.push(...line.split(/\s+/));
      continue;
    }
    const feat = line.match(FEATURE_RE);
    if (feat) {
      feature.name = feat[1].trim();
      feature.tags = pendingTags;
      pendingTags = [];
      // Read description lines until first Background/Scenario/Scenario Outline/tag.
      while (i < lines.length) {
        const next = lines[i].trim();
        if (
          next === "" ||
          BACKGROUND_RE.test(next) ||
          SCENARIO_RE.test(next) ||
          SCENARIO_OUTLINE_RE.test(next) ||
          TAG_RE.test(next)
        ) {
          break;
        }
        if (!COMMENT_RE.test(next)) feature.description.push(next);
        i += 1;
      }
      break;
    }
  }

  if (!feature.name) return null; // not a valid feature file

  // ---- Body pass: collect Background + Scenarios + Outlines.
  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;
    if (line === "" || COMMENT_RE.test(line)) continue;

    const tagMatch = line.match(TAG_RE);
    if (tagMatch) {
      pendingTags.push(...line.split(/\s+/));
      continue;
    }

    const bg = line.match(BACKGROUND_RE);
    if (bg) {
      const { steps, nextI } = readSteps(lines, i);
      feature.background = {
        name: bg[1] || "Background",
        type: "background",
        tags: [],
        steps,
      };
      i = nextI;
      pendingTags = [];
      continue;
    }

    const scenario = line.match(SCENARIO_RE);
    if (scenario) {
      const { steps, nextI } = readSteps(lines, i);
      feature.scenarios.push({
        name: scenario[1].trim(),
        type: "scenario",
        tags: pendingTags,
        steps,
      });
      i = nextI;
      pendingTags = [];
      continue;
    }

    const outline = line.match(SCENARIO_OUTLINE_RE);
    if (outline) {
      const { steps, nextI } = readSteps(lines, i);
      // After steps, look for Examples: block.
      let exI = nextI;
      let examples: ExamplesIR | undefined;
      while (exI < lines.length) {
        const exLine = lines[exI].trim();
        if (exLine === "" || COMMENT_RE.test(exLine)) {
          exI += 1;
          continue;
        }
        const ex = exLine.match(EXAMPLES_RE);
        if (ex) {
          const { table, nextI: tableNextI } = readTable(lines, exI + 1);
          examples = table;
          exI = tableNextI;
        }
        break;
      }
      feature.scenarios.push({
        name: outline[1].trim(),
        type: "scenario-outline",
        tags: pendingTags,
        steps,
        examples,
      });
      i = exI;
      pendingTags = [];
      continue;
    }

    // Anything else — skip and continue.
  }

  return feature;
}

function readSteps(
  lines: string[],
  startI: number,
): { steps: StepIR[]; nextI: number } {
  const steps: StepIR[] = [];
  let i = startI;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "" || COMMENT_RE.test(line)) {
      i += 1;
      continue;
    }
    if (
      BACKGROUND_RE.test(line) ||
      SCENARIO_RE.test(line) ||
      SCENARIO_OUTLINE_RE.test(line) ||
      EXAMPLES_RE.test(line) ||
      TAG_RE.test(line)
    ) {
      break;
    }
    const step = line.match(STEP_RE);
    if (step) {
      steps.push({
        keyword: step[1] as StepIR["keyword"],
        text: step[2].trim(),
      });
      i += 1;
      continue;
    }
    // DocString / DataTable — not supported in MVP. Skip the line.
    i += 1;
  }
  return { steps, nextI: i };
}

function readTable(
  lines: string[],
  startI: number,
): { table: ExamplesIR | undefined; nextI: number } {
  const rows: string[][] = [];
  let i = startI;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "" || COMMENT_RE.test(line)) {
      i += 1;
      continue;
    }
    const m = line.match(TABLE_ROW_RE);
    if (!m) break;
    const cells = m[1].split("|").map((c) => c.trim());
    rows.push(cells);
    i += 1;
  }
  if (rows.length === 0) return { table: undefined, nextI: i };
  const headers = rows[0];
  const body = rows.slice(1);
  return { table: { headers, rows: body }, nextI: i };
}
