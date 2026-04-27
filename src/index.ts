import * as path from "path";
import { scanProject } from "./scanner/projectScanner";
// AST extractor is the canonical source. It transparently falls back to the
// regex extractor when java-parser isn't installed or a single file fails to
// parse — see src/parser/javaAst.ts for the recovery strategy.
import { extractPageObject, extractTestClass } from "./parser/javaAst";
import { emitPageObject } from "./emitters/pageObjectEmitter";
import { emitTestClass } from "./emitters/testClassEmitter";
import { emitProject } from "./emitters/projectEmitter";
import { writeReviewReport } from "./reports/reviewReport";
import { logger } from "./utils/logger";
import { emitFixture } from "./transformers/baseTestExtractor";
import { convertTestngXml } from "./transformers/testngXmlConverter";
import { convertPropertiesFiles } from "./transformers/propertiesConverter";
import {
  detectCustomUtilities,
  emitUtilityStub,
} from "./transformers/customUtilDetector";
import { prettyPrint } from "./post/prettierFormat";
import { tscValidate } from "./post/tscValidate";
import { detectAndEmitAuthSetup } from "./post/authSetupGenerator";
import { insertTodoMarkers } from "./post/todoMarkers";
import { writeMigrationNotes } from "./reports/migrationNotes";
import { writeConversionResult } from "./reports/conversionResult";
import { extractPageObject as extractPageObjectIR } from "./parser/javaAst";
import { emitPageBag } from "./emitters/pageBagEmitter";
import { detectSourceStack, SourceStack } from "./scanner/stackDetector";
import {
  extractCsharpPageObject,
  extractCsharpTestClass,
} from "./parser/csharpExtractor";
import { convertBdd } from "./stretch/bdd";
import { runLlmFallback } from "./post/llmFallback";
import { LlmProvider } from "./stretch/llmAdapter";
import {
  createFailureStore,
  patternHash,
  sourceHash as computeSourceHash,
  FailureStore,
} from "./server/telemetry";
import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as fsPath from "path";
import {
  ConversionSummary,
  ConvertedFile,
  JavaFile,
  ReviewItem,
} from "./types";

export interface ConvertOptions {
  inputDir: string;
  outputDir: string;
  /** Path to the templates/ folder (defaults to packaged copy). */
  templatesDir?: string;
  /** Don't write files; just return what would be produced. */
  dryRun?: boolean;
  /**
   * When true, locator field initialisers are wrapped in
   *   healOrThrow(page, { preferred, context })
   * from `@platform/sdk-self-healing`, so the converted suite integrates with
   * `self-healing-stage-services` at runtime. See INTEGRATION.md flow B.
   */
  emitSelfHealingShim?: boolean;
  /** When true, generate `tests/auth.setup.ts` if a LoginPage was detected. */
  emitAuthSetup?: boolean;
  /** When true, run prettier over the generated TS files. */
  formatOutput?: boolean;
  /** When true, run `tsc --noEmit` over the generated project as a gate. */
  validateOutput?: boolean;
  /** When true, insert `// TODO(sel2pw): …` markers near manual review items. */
  emitTodoMarkers?: boolean;
  /**
   * Failure-telemetry SQLite path. When unset, defaults to `<workdir>/sel2pw-telemetry.db`.
   * Telemetry is local-only by default; opt-in upload lives in src/post/telemetryUpload.ts.
   * Set to `false` to disable telemetry entirely for this run.
   */
  telemetryDb?: string | false;
  /**
   * Page Object emission style:
   *   "instance" — default; tests call `new LoginPage(page)` themselves.
   *   "factory" — also emit `pages/index.ts` + `tests/fixtures.pages.ts`
   *               so tests use `async ({ pages }) => pages.login.x()`.
   */
  pomStyle?: "instance" | "factory";
  /**
   * Force a particular source stack. When omitted (default), the stack is
   * auto-detected from the input directory's file extensions.
   */
  forceStack?: SourceStack;
  /**
   * LLM fallback config — when set, files the AST pipeline couldn't convert
   * are retried via the named LLM provider. Requires the matching SDK to be
   * installed in node_modules and an API key.
   */
  llmFallback?: {
    provider: LlmProvider;
    apiKey: string;
    model?: string;
    governanceSidecarUrl?: string;
  };
}

export async function convert(opts: ConvertOptions): Promise<{
  summary: ConversionSummary;
  files: ConvertedFile[];
}> {
  const inputDir = path.resolve(opts.inputDir);
  const outputDir = path.resolve(opts.outputDir);
  const templatesDir =
    opts.templatesDir ?? path.resolve(__dirname, "..", "templates");

  // Detect source stack (java-testng / java-bdd-cucumber / csharp-nunit /
  // csharp-bdd-specflow). The user can override via opts.forceStack.
  const stackDetection = await detectSourceStack(inputDir);
  const stack = opts.forceStack ?? stackDetection.stack;
  logger.info({ stack, evidence: stackDetection.evidence }, "source stack");

  const javaFiles: JavaFile[] = await scanProject(inputDir);
  const converted: ConvertedFile[] = [];
  const warnings: ReviewItem[] = [];

  // -------- Telemetry: open the failure store --------
  // Local-only by default. Set telemetryDb: false to disable for this run.
  const telemetryJobId = "cnv_local_" + crypto.randomBytes(6).toString("base64url");
  const telemetryDbPath =
    opts.telemetryDb === false
      ? null
      : (opts.telemetryDb ?? path.resolve(process.cwd(), ".sel2pw", "telemetry.db"));
  const telemetry: FailureStore | null = telemetryDbPath
    ? createFailureStore(telemetryDbPath)
    : null;
  const telemetryStartedAt = new Date().toISOString();
  if (telemetry) {
    telemetry.recordJob({
      jobId: telemetryJobId,
      sourceStack: stack,
      filesScanned: javaFiles.length,
      filesSucceeded: 0,
      filesFailed: 0,
      manualCount: 0,
      warningCount: 0,
      infoCount: 0,
      startedAt: telemetryStartedAt,
      status: "running",
    });
  }

  warnings.push({
    file: inputDir,
    severity: "info",
    message: `Source stack: ${stack}. ${stackDetection.reason}`,
  });

  let pageObjectsConverted = 0;
  let testClassesConverted = 0;
  let testMethodsConverted = 0;

  for (const file of javaFiles) {
    // Per-file try/catch: a single problematic source file is logged + flagged
    // for review but does NOT abort the conversion. This keeps the tool
    // resilient against unfamiliar Java shapes (nested classes, lambdas,
    // exotic generics) that the parser may choke on.
    try {
      const isCsharp = file.path.toLowerCase().endsWith(".cs");
      if (file.kind === "page-object") {
        const ir = isCsharp ? extractCsharpPageObject(file) : extractPageObject(file);
        const out = emitPageObject(ir, file.path, {
          selfHealingShim: !!opts.emitSelfHealingShim,
        });
        converted.push(out);
        warnings.push(...out.warnings);
        pageObjectsConverted++;
      } else if (file.kind === "test-class") {
        const ir = isCsharp ? extractCsharpTestClass(file) : extractTestClass(file);
        const out = emitTestClass(ir, file.path);
        converted.push(out);
        warnings.push(...out.warnings);
        testClassesConverted++;
        testMethodsConverted += ir.testMethods.length;
      } else if (file.kind === "base") {
        const fixture = emitFixture(file);
        converted.push(fixture.converted);
        warnings.push(...fixture.converted.warnings);
        warnings.push({
          file: file.path,
          severity: "info",
          message: `Generated tests/fixtures.ts from \`${file.className}\`. Update converted spec files to \`import { test, expect } from '../fixtures'\` instead of '@playwright/test' to inherit shared setup.`,
        });
      } else if (file.kind === "unknown") {
        // Phase 6: try the custom-utility detector before giving up.
        const util = detectCustomUtilities(file);
        if (util) {
          const stub = emitUtilityStub(util);
          converted.push(stub.converted);
          warnings.push(stub.warning);
        } else {
          warnings.push({
            file: file.path,
            severity: "info",
            message: `\`${file.className}\` was not classified as test or page object. Skipped.`,
          });
          // Telemetry: unknown that even the customUtilDetector couldn't
          // promote. These are the highest-priority shapes to investigate
          // for future detector widening.
          if (telemetry) {
            const sig = patternHash(
              "unknown-classification",
              file.className.replace(/[A-Z]/g, "X").replace(/[a-z]/g, "x").replace(/\d/g, "N"),
            );
            telemetry.recordFailure({
              jobId: telemetryJobId,
              sourceFile: file.relPath,
              fileKind: file.kind,
              failureKind: "unknown-classification",
              sourceHash: computeSourceHash(file.source),
              sourcePreview: file.source.slice(0, 400),
              patternSignature: sig,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err: any) {
      logger.error(
        { file: file.path, err: err.message, stack: err.stack },
        "conversion failed for file — skipping",
      );
      warnings.push({
        file: file.path,
        severity: "manual",
        message: `Conversion failed for this file (${err.message}). Skipped — please port manually or report a bug with the source.`,
      });
      // Telemetry: record the parse/transformer error so maintainers can
      // see common failure shapes across users.
      if (telemetry) {
        const sig = patternHash(
          "parse-error",
          file.kind,
          err.message?.replace(/['"][^'"]+['"]/g, '"…"').replace(/\d+/g, "N") ?? "",
        );
        telemetry.recordFailure({
          jobId: telemetryJobId,
          sourceFile: file.relPath,
          fileKind: file.kind,
          failureKind: "parse-error",
          errorMessage: err.message,
          sourceHash: computeSourceHash(file.source),
          sourcePreview: file.source.slice(0, 400),
          patternSignature: sig,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // Convert testng.xml -> playwright.config.ts (overrides the template).
  // Look for testng.xml at the project root or in any common location.
  const testngXmlCandidates = [
    fsPath.join(inputDir, "testng.xml"),
    fsPath.join(inputDir, "src/test/resources/testng.xml"),
    fsPath.join(inputDir, "test-suites/testng.xml"),
  ];
  for (const candidate of testngXmlCandidates) {
    if (await fs.pathExists(candidate)) {
      try {
        const xml = await fs.readFile(candidate, "utf8");
        const result = convertTestngXml(xml);
        converted.push(result.converted);
        warnings.push(...result.warnings);
        warnings.push({
          file: candidate,
          severity: "info",
          message: `Converted testng.xml to playwright.config.ts (${result.suiteCount} suite(s)). The template config has been overridden.`,
        });
        break;
      } catch (err: any) {
        logger.warn({ candidate, err: err.message }, "testng.xml parse failed");
      }
    }
  }

  // Convert .properties → .env + tests/config.ts
  try {
    const propsConverted = await convertPropertiesFiles(inputDir);
    converted.push(...propsConverted);
    if (propsConverted.length) {
      warnings.push({
        file: inputDir,
        severity: "info",
        message: `Converted ${propsConverted.length} properties file(s) to .env shape with tests/config.ts loader.`,
      });
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, ".properties conversion failed");
  }

  // -------- Telemetry: record one row per manual-severity ReviewItem --------
  if (telemetry) {
    for (const w of warnings) {
      if (w.severity !== "manual") continue;
      const sig = patternHash(
        "manual-review",
        w.message.replace(/['"][^'"]+['"]/g, '"…"').replace(/\d+/g, "N").slice(0, 200),
      );
      telemetry.recordFailure({
        jobId: telemetryJobId,
        sourceFile: relativisePath(w.file, inputDir),
        fileKind: "review",
        failureKind: "manual-review",
        errorMessage: w.message,
        sourceHash: "n/a",
        sourcePreview: w.snippet?.slice(0, 400),
        patternSignature: sig,
        createdAt: new Date().toISOString(),
      });
    }
    // Update the job summary now that we know the counts.
    telemetry.recordJob({
      jobId: telemetryJobId,
      sourceStack: stack,
      filesScanned: javaFiles.length,
      filesSucceeded: pageObjectsConverted + testClassesConverted,
      filesFailed: warnings.filter((w) => w.severity === "manual").length,
      manualCount: warnings.filter((w) => w.severity === "manual").length,
      warningCount: warnings.filter((w) => w.severity === "warning").length,
      infoCount: warnings.filter((w) => w.severity === "info").length,
      startedAt: telemetryStartedAt,
      endedAt: new Date().toISOString(),
      status: "succeeded",
    });
    telemetry.close();
  }

  const summary: ConversionSummary = {
    inputDir,
    outputDir,
    filesScanned: javaFiles.length,
    pageObjectsConverted,
    testClassesConverted,
    testMethodsConverted,
    warnings,
  };

  // -------- Phase 8: BDD path (Cucumber/Java OR SpecFlow/C#) --------
  if (stack === "java-bdd-cucumber" || stack === "csharp-bdd-specflow") {
    try {
      const bddOut = await convertBdd(inputDir, javaFiles);
      converted.push(...bddOut.files);
      warnings.push(...bddOut.warnings);
    } catch (err: any) {
      logger.warn({ err: err.message }, "BDD conversion failed");
      warnings.push({
        file: inputDir,
        severity: "warning",
        message: `BDD conversion encountered an error (${err.message}). Continuing with the rest of the pipeline.`,
      });
    }
  }

  // -------- Phase 8: LLM fallback for unknowns --------
  if (opts.llmFallback) {
    const unknowns = javaFiles.filter((f) => f.kind === "unknown");
    if (unknowns.length > 0) {
      logger.info(
        { count: unknowns.length, provider: opts.llmFallback.provider },
        "running LLM fallback over unknown files",
      );
      const fallback = await runLlmFallback(unknowns, {
        config: {
          provider: opts.llmFallback.provider,
          apiKey: opts.llmFallback.apiKey,
          model: opts.llmFallback.model,
          governanceSidecarUrl: opts.llmFallback.governanceSidecarUrl,
        },
        contextFiles: converted.filter((c) => c.kind === "page-object"),
      });
      converted.push(...fallback.files);
      warnings.push(...fallback.warnings);
    }
  }

  // -------- Phase 3 post-processing pass --------

  // Auth setup file generation (requires the page-object IR list which we
  // didn't keep around above; re-extract just the IRs cheaply for the few
  // page-object files).
  // Page-bag (factory) style: emit pages/index.ts + tests/fixtures.pages.ts.
  if (opts.pomStyle === "factory") {
    const pageClassNames = javaFiles
      .filter((f) => f.kind === "page-object")
      .map((f) => f.className);
    converted.push(...emitPageBag(pageClassNames));
    if (pageClassNames.length) {
      warnings.push({
        file: inputDir,
        severity: "info",
        message:
          "Emitted page-bag style (`pages/index.ts` + `tests/fixtures.pages.ts`). Tests can use `async ({ pages }) => pages.login.x()` after switching their import to `'../fixtures.pages'`.",
      });
    }
  }

  if (opts.emitAuthSetup) {
    const pageObjectIRs = javaFiles
      .filter((f) => f.kind === "page-object")
      .map((f) => extractPageObjectIR(f));
    const authFile = detectAndEmitAuthSetup(pageObjectIRs);
    if (authFile) {
      converted.push(authFile);
      warnings.push({
        file: inputDir,
        severity: "info",
        message:
          "Generated tests/auth.setup.ts — set BASE_URL, TEST_USER, TEST_PASSWORD env vars; add a `setup` project to playwright.config.ts to wire it in.",
      });
    }
  }

  let postFiles = converted;
  if (opts.emitTodoMarkers !== false) {
    postFiles = insertTodoMarkers(postFiles, warnings);
  }
  if (opts.formatOutput) {
    postFiles = await prettyPrint(postFiles);
  }

  if (!opts.dryRun) {
    await emitProject(outputDir, postFiles, summary, templatesDir);
    await writeReviewReport(outputDir, summary);
    await writeMigrationNotes(outputDir, inputDir, summary);
    // Phase 10: structured per-file outcome JSON for downstream tooling.
    await writeConversionResult({
      inputDir,
      outputDir,
      sourceStack: stack,
      scannedFiles: javaFiles,
      convertedFiles: postFiles,
      warnings,
      summary,
    });

    if (opts.validateOutput) {
      const tsc = await tscValidate(outputDir);
      if (!tsc.ok) {
        // Re-write the review report with the new tsc warnings appended.
        summary.warnings.push(...tsc.warnings);
        await writeReviewReport(outputDir, summary);
      }
    }
  }

  return { summary, files: postFiles };
}

export async function analyze(inputDir: string): Promise<{
  filesScanned: number;
  byKind: Record<string, number>;
  files: { relPath: string; kind: string; className: string }[];
}> {
  const javaFiles = await scanProject(inputDir);
  const byKind: Record<string, number> = {};
  for (const f of javaFiles) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  return {
    filesScanned: javaFiles.length,
    byKind,
    files: javaFiles.map((f) => ({
      relPath: f.relPath,
      kind: f.kind,
      className: f.className,
    })),
  };
}

/**
 * Convert an absolute file path to one relative to inputDir, for telemetry
 * privacy (we never send absolute paths off-machine — they may leak
 * usernames / project structure).
 */
function relativisePath(file: string, inputDir: string): string {
  if (!file) return "";
  try {
    return path.relative(inputDir, file).replace(/\\/g, "/");
  } catch {
    return path.basename(file);
  }
}

export * from "./types";
