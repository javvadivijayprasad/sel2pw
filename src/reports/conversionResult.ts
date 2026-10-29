import * as path from "path";
import * as fs from "fs-extra";
import {
  ConversionSummary,
  ConvertedFile,
  JavaFile,
  ReviewItem,
} from "../types";
import { getParserStats, ParserStats } from "../parser/javaAst";

/**
 * Structured per-file conversion outcome — written next to the human-readable
 * CONVERSION_REVIEW.md and MIGRATION_NOTES.md so downstream tooling (the
 * platform UI, CI pipelines, the user's own scripts) can answer three
 * questions without parsing markdown:
 *
 *   1. Which files did sel2pw successfully convert?
 *   2. Which files did it skip / fail on, and why?
 *   3. What action does the user need to take for each unconverted file?
 *
 * Shape stays stable across releases (the JSON is a public contract). New
 * fields land as additions; existing fields don't change semantics.
 */

export interface FileOutcome {
  /** Path relative to inputDir, forward-slashes. */
  source: string;
  /** Path relative to outputDir if converted, else null. */
  output: string | null;
  /** What the scanner classified this file as. */
  sourceKind: "page-object" | "test-class" | "base" | "infrastructure" | "java-record" | "java-enum" | "java-exception" | "owner-config" | "pojo" | "config" | "unknown";
  /** Final disposition. */
  status: "converted" | "stubbed" | "skipped" | "failed";
  /** Why the file got this status — one short sentence. */
  reason: string;
  /** What the user needs to do (if anything). */
  action: string;
  /** Severity of the user-action: ok | warning | manual. */
  severity: "ok" | "warning" | "manual";
}

export interface ConversionResultJson {
  schema: "sel2pw.conversion-result.v1";
  inputDir: string;
  outputDir: string;
  sourceStack: string;
  generatedAt: string;
  /** v2.0.10 — hybrid-parser transparency. See src/parser/javaAst.ts ParserStats. */
  parser?: ParserStats;
  stats: {
    filesScanned: number;
    converted: number;
    stubbed: number;
    skipped: number;
    failed: number;
    manualReviewItems: number;
    warningItems: number;
    infoItems: number;
  };
  /** Per-file outcomes, sorted by severity then path. */
  files: FileOutcome[];
  /** Project-wide notes (info / warning / manual not tied to a specific source file). */
  projectNotes: { severity: "info" | "warning" | "manual"; message: string }[];
  /** Path to the human-readable review report. */
  reviewReportPath: string;
  /** Path to the migration notes. */
  migrationNotesPath: string;
}

export interface BuildResultArgs {
  inputDir: string;
  outputDir: string;
  sourceStack: string;
  scannedFiles: JavaFile[];
  convertedFiles: ConvertedFile[];
  warnings: ReviewItem[];
  summary: ConversionSummary;
}

export async function writeConversionResult(args: BuildResultArgs): Promise<string> {
  const target = path.join(args.outputDir, "conversion-result.json");
  const payload = buildConversionResult(args);
  await fs.writeJson(target, payload, { spaces: 2 });
  return target;
}

export function buildConversionResult(args: BuildResultArgs): ConversionResultJson {
  const { inputDir, outputDir, sourceStack, scannedFiles, convertedFiles, warnings, summary } = args;

  // Index converted files by output basename for quick lookup. The emitted
  // file paths are kebab-cased (login.spec.ts, action-driver.page.ts) while
  // the IR carries the original PascalCase class name. Both sides get
  // kebab-normalised so lookups match.
  //
  // Keep the `.page` / `.spec` suffix in the key: `pages/login.page.ts` and
  // `tests/login.spec.ts` share the bare stem `login`, and a stem-only map
  // silently overwrote one entry with the other, so a LoginPage and a
  // LoginTest could both be reported as the same output file (whichever was
  // indexed last won). `byStem` stays as a fallback for helper/config
  // outputs that carry no page/spec segment; it stores the first entry per
  // stem so the result is deterministic.
  const byOutputName = new Map<string, ConvertedFile>();
  const byStem = new Map<string, ConvertedFile>();
  for (const cf of convertedFiles) {
    const name = path.basename(cf.relPath, ".ts").toLowerCase();
    byOutputName.set(name, cf);
    const stem = name.replace(/\.(page|spec)$/, "");
    if (!byStem.has(stem)) byStem.set(stem, cf);
  }

  const files: FileOutcome[] = scannedFiles.map((f) =>
    fileOutcomeFor(f, warnings, byOutputName, byStem),
  );

  const projectNotes = warnings
    .filter((w) => isProjectWide(w.file))
    .map((w) => ({ severity: w.severity, message: w.message }));

  const counts = {
    converted: files.filter((f) => f.status === "converted").length,
    stubbed: files.filter((f) => f.status === "stubbed").length,
    skipped: files.filter((f) => f.status === "skipped").length,
    failed: files.filter((f) => f.status === "failed").length,
  };

  return {
    schema: "sel2pw.conversion-result.v1",
    inputDir,
    outputDir,
    sourceStack,
    generatedAt: new Date().toISOString(),
    parser: getParserStats(),
    stats: {
      filesScanned: summary.filesScanned,
      ...counts,
      manualReviewItems: warnings.filter((w) => w.severity === "manual").length,
      warningItems: warnings.filter((w) => w.severity === "warning").length,
      infoItems: warnings.filter((w) => w.severity === "info").length,
    },
    files: files.sort(severityThenPath),
    projectNotes,
    reviewReportPath: "CONVERSION_REVIEW.md",
    migrationNotesPath: "MIGRATION_NOTES.md",
  };
}

/**
 * Resolve the emitted file for a scanned source file. Page objects and test
 * classes are looked up with their emit suffix (`<stem>.page` / `<stem>.spec`)
 * so the two namespaces cannot collide; everything else falls back to the
 * exact basename and then the legacy stem index (helpers, configs, fixtures).
 */
function matchConverted(
  kind: JavaFile["kind"],
  stem: string,
  byOutputName: Map<string, ConvertedFile>,
  byStem: Map<string, ConvertedFile>,
): ConvertedFile | undefined {
  const suffixed = kind === "page-object"
    ? `${stem}.page`
    : kind === "test-class"
      ? `${stem}.spec`
      : null;
  if (suffixed) {
    const hit = byOutputName.get(suffixed);
    if (hit) return hit;
  }
  return byOutputName.get(stem) ?? byStem.get(stem);
}

function fileOutcomeFor(
  file: JavaFile,
  warnings: ReviewItem[],
  byOutputName: Map<string, ConvertedFile>,
  byStem: Map<string, ConvertedFile>,
): FileOutcome {
  const fileWarnings = warnings.filter((w) => w.file === file.path);
  const hasManual = fileWarnings.some((w) => w.severity === "manual");
  const hasWarning = fileWarnings.some((w) => w.severity === "warning");

  // Did anything land in the output for this file? Kebab-normalise the
  // class name so it matches the emitted file's basename (which uses
  // kebab-case: ActionDriver -> action-driver.page.ts).
  //
  // Mirrors the emitter-side naming logic (src/utils/naming.ts):
  //   - base test files emit to a fixed `tests/fixtures.ts` regardless
  //     of class name, so map base-kind files straight to "fixtures".
  //   - test classes: kebab then strip trailing `-test(s)`/`-test-case`
  //     (so LoginTests -> login, API_Test -> api).
  //   - page objects: kebab then strip trailing `-page(s)`.
  // Pre-fix this used a PascalCase strip-then-kebab order which leaked
  // a trailing dash on names like `API_Test` (see selenium12 + 15).
  const stem = file.kind === "base"
    ? "fixtures"
    : kebab(file.className).replace(
        /-(tests?(?:-?case)?|page-?objects?|pages?|screens?|views?)$/,
        "",
      );
  const matched = matchConverted(file.kind, stem, byOutputName, byStem);

  if (file.kind === "unknown") {
    // Either promoted to a stub by customUtilDetector, or genuinely skipped.
    const stubbed = warnings.some(
      (w) =>
        w.file === file.className && /tests\/_legacy-stubs/.test(w.message),
    );
    if (stubbed) {
      return {
        source: file.relPath,
        output: `tests/_legacy-stubs/${kebab(file.className)}.ts`,
        sourceKind: file.kind,
        status: "stubbed",
        reason: "No 1:1 Playwright equivalent — typed stub generated.",
        action:
          "Open the stub file's header for migration guidance. Replace each call site with a Playwright primitive, then delete the stub.",
        severity: "manual",
      };
    }
    return {
      source: file.relPath,
      output: null,
      sourceKind: file.kind,
      status: "skipped",
      reason: "Could not be classified as a Page Object, test class, or known utility.",
      action:
        "Open the file. If it's test code, add @Test/@BeforeMethod annotations or a *Page/*Section/*Test class-name suffix. If it's data/POJO, ignore.",
      severity: "warning",
    };
  }

  if (hasManual) {
    return {
      source: file.relPath,
      output: matched ? matched.relPath : null,
      sourceKind: file.kind,
      status: matched ? "converted" : "failed",
      reason: matched
        ? "Converted but contains items that need manual edits."
        : "Conversion failed for this file.",
      action: fileWarnings.find((w) => w.severity === "manual")?.message ??
        "See CONVERSION_REVIEW.md for the manual items on this file.",
      severity: "manual",
    };
  }

  if (matched) {
    return {
      source: file.relPath,
      output: matched.relPath,
      sourceKind: file.kind,
      status: "converted",
      reason: hasWarning
        ? "Converted; one or more warnings to verify."
        : "Converted cleanly.",
      action: hasWarning
        ? fileWarnings.find((w) => w.severity === "warning")?.message ??
          "See CONVERSION_REVIEW.md for the warning details."
        : "No action required.",
      severity: hasWarning ? "warning" : "ok",
    };
  }

  // Should rarely happen: classified as test/page-object but no output produced.
  return {
    source: file.relPath,
    output: null,
    sourceKind: file.kind,
    status: "failed",
    reason: "Classified but no output produced — likely an emitter error.",
    action: "File a bug report with this file's contents.",
    severity: "manual",
  };
}

function severityThenPath(a: FileOutcome, b: FileOutcome): number {
  const order = { manual: 0, warning: 1, ok: 2 } as const;
  const sa = order[a.severity];
  const sb = order[b.severity];
  if (sa !== sb) return sa - sb;
  return a.source.localeCompare(b.source);
}

function isProjectWide(file: string): boolean {
  if (!file) return true;
  const base = file.split(/[\\/]/).pop() ?? "";
  if (!base.includes(".")) return true;
  return !/\.(java|cs|ts|tsx|xml|properties|feature)$/i.test(base);
}

function kebab(s: string): string {
  // Mirror src/utils/naming.ts → toKebabCase: replace camel-case boundaries
  // AND collapse underscore/whitespace runs to dashes. Without the
  // underscore handling, source files with underscore-prefixed class
  // names (`_01_Intro`) wouldn't match the kebab-cased emitter output
  // (`-01-intro.spec.ts`), and every such file showed as "failed" in
  // conversion-result.json even though the file was emitted correctly.
  // Bug surfaced in selenium10/11 (46 false failures) — fix in 0.10.4.
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}
