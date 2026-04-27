#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import { convert, analyze } from "./index";

// Read version from package.json at runtime so we never have to hand-sync
// the CLI version with package.json again. Falls back to "unknown" if the
// file isn't reachable (e.g. weird bundler layouts) — better than lying.
function readVersion(): string {
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (pkg && typeof pkg.version === "string") return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return "unknown";
}

const program = new Command();

program
  .name("sel2pw")
  .description(
    "Convert Java + Selenium + TestNG test suites into a Playwright TypeScript project.",
  )
  .version(readVersion());

program
  .command("convert")
  .description("Convert a Selenium/TestNG project to a Playwright TS project.")
  .argument("<inputDir>", "Path to the Java/Selenium project (root or src/test/java).")
  .requiredOption("-o, --out <outputDir>", "Output directory for the Playwright project.")
  .option("--templates <dir>", "Override templates directory.")
  .option("--dry-run", "Print what would be converted without writing files.")
  .option("--emit-self-healing-shim", "Wrap locators in healOrThrow() for runtime self-healing.")
  .option("--emit-auth-setup", "Generate tests/auth.setup.ts when a LoginPage is detected.")
  .option("--format", "Run Prettier over generated TS.")
  .option("--validate", "Run `tsc --noEmit` over generated project as a gate.")
  .option("--no-todo-markers", "Skip inserting // TODO(sel2pw): markers in generated code.")
  .option("--pom-style <style>", "Page Object style: 'instance' (default) or 'factory' (page-bag fixture).", "instance")
  .option("--lang <lang>", "Force source language: 'java' or 'csharp'. Auto-detected when omitted.")
  .option("--llm-provider <p>", "LLM fallback provider: anthropic | openai | gemini.")
  .option("--llm-key <k>", "API key for the LLM provider (or set ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY env).")
  .option("--llm-model <m>", "Override the default LLM model.")
  .option("--llm-fallback", "Run the configured LLM over files the AST pipeline couldn't classify.")
  .option("--diff", "Like --dry-run but prints unified diffs against an existing output dir.")
  .action(async (inputDir: string, opts: {
    out: string;
    templates?: string;
    dryRun?: boolean;
    emitSelfHealingShim?: boolean;
    emitAuthSetup?: boolean;
    format?: boolean;
    validate?: boolean;
    todoMarkers?: boolean;
    pomStyle?: "instance" | "factory";
    lang?: "java" | "csharp";
    llmProvider?: "anthropic" | "openai" | "gemini";
    llmKey?: string;
    llmModel?: string;
    llmFallback?: boolean;
    diff?: boolean;
  }) => {
    try {
      console.log(chalk.cyan(`sel2pw — converting ${inputDir} -> ${opts.out}`));

      // Build LLM fallback config when --llm-fallback is set.
      let llmFallback: { provider: "anthropic" | "openai" | "gemini"; apiKey: string; model?: string } | undefined;
      if (opts.llmFallback) {
        const provider = opts.llmProvider ?? "anthropic";
        const envKey =
          provider === "anthropic" ? process.env.ANTHROPIC_API_KEY :
          provider === "openai" ? process.env.OPENAI_API_KEY :
          process.env.GOOGLE_API_KEY;
        const apiKey = opts.llmKey ?? envKey;
        if (!apiKey) {
          console.error(
            chalk.red(
              `--llm-fallback requires an API key. Pass --llm-key or set ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY"} in env.`,
            ),
          );
          process.exit(2);
        }
        llmFallback = { provider, apiKey, model: opts.llmModel };
      }
      const { summary, files } = await convert({
        inputDir,
        outputDir: opts.out,
        templatesDir: opts.templates ?? path.resolve(__dirname, "..", "templates"),
        dryRun: opts.dryRun || opts.diff,
        emitSelfHealingShim: opts.emitSelfHealingShim,
        emitAuthSetup: opts.emitAuthSetup,
        formatOutput: opts.format,
        validateOutput: opts.validate,
        emitTodoMarkers: opts.todoMarkers,
        pomStyle: opts.pomStyle,
        forceStack: opts.lang === "csharp" ? "csharp-nunit" : opts.lang === "java" ? "java-testng" : undefined,
        llmFallback,
      });

      if (opts.diff) {
        const fs = require("fs-extra"); // eslint-disable-line @typescript-eslint/no-require-imports
        for (const f of files) {
          const target = path.join(opts.out, f.relPath);
          let existing = "";
          if (await fs.pathExists(target)) existing = await fs.readFile(target, "utf8");
          if (existing === f.source) continue;
          console.log(chalk.bold(`\n--- ${f.relPath} ---`));
          console.log(simpleDiff(existing, f.source));
        }
      }
      printSummary(summary);
      if (opts.dryRun) {
        console.log(chalk.yellow("\nDry run — no files written."));
      } else {
        console.log(
          chalk.green(
            `\nDone. See ${path.join(opts.out, "CONVERSION_REVIEW.md")} for items needing manual review.`,
          ),
        );
      }
    } catch (err: any) {
      console.error(chalk.red("Conversion failed:"), err.message);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Scan a project and report what would be converted (no writes).")
  .argument("<inputDir>", "Path to the Java/Selenium project.")
  .action(async (inputDir: string) => {
    try {
      const result = await analyze(inputDir);
      console.log(chalk.cyan(`Files scanned: ${result.filesScanned}`));
      for (const [kind, n] of Object.entries(result.byKind)) {
        console.log(`  ${kind.padEnd(14)} ${n}`);
      }
      console.log("");
      for (const f of result.files) {
        const colour =
          f.kind === "test-class"
            ? chalk.green
            : f.kind === "page-object"
              ? chalk.blue
              : f.kind === "base"
                ? chalk.yellow
                : chalk.gray;
        console.log(`${colour(f.kind.padEnd(14))} ${f.className.padEnd(28)} ${f.relPath}`);
      }
    } catch (err: any) {
      console.error(chalk.red("Analyze failed:"), err.message);
      process.exit(1);
    }
  });

function printSummary(s: {
  filesScanned: number;
  pageObjectsConverted: number;
  testClassesConverted: number;
  testMethodsConverted: number;
  warnings: { severity: string }[];
}) {
  console.log("");
  console.log(chalk.bold("Summary"));
  console.log(`  Files scanned          ${s.filesScanned}`);
  console.log(`  Page Objects converted ${s.pageObjectsConverted}`);
  console.log(`  Test classes converted ${s.testClassesConverted}`);
  console.log(`  Test methods converted ${s.testMethodsConverted}`);
  console.log(`  Review items           ${s.warnings.length}`);
  const manual = s.warnings.filter((w) => w.severity === "manual").length;
  const warn = s.warnings.filter((w) => w.severity === "warning").length;
  if (manual)
    console.log(chalk.red(`    manual:  ${manual} (must be hand-edited)`));
  if (warn) console.log(chalk.yellow(`    warning: ${warn} (please verify)`));
}

// ─── Telemetry report subcommands ─────────────────────────────────────────

program
  .command("report-failures")
  .description("Print recent failure rows from the local telemetry DB.")
  .option("--db <path>", "Override telemetry DB path.")
  .option("-n, --limit <n>", "How many to show.", "50")
  .action(async (opts: { db?: string; limit: string }) => {
    const { createFailureStore } = await import("./server/telemetry");
    const dbPath = opts.db ?? path.resolve(process.cwd(), ".sel2pw", "telemetry.db");
    const store = createFailureStore(dbPath);
    const rows = store.listRecentFailures(parseInt(opts.limit, 10));
    if (rows.length === 0) {
      console.log(chalk.yellow("No failures recorded — either telemetry is disabled or you've had a clean run."));
      console.log(`Looked at: ${dbPath}`);
      return;
    }
    console.log(chalk.bold(`Recent failures (${rows.length}, newest first):`));
    for (const r of rows) {
      const colour =
        r.failureKind === "parse-error" ? chalk.red :
        r.failureKind === "manual-review" ? chalk.yellow :
        chalk.gray;
      console.log("");
      console.log(`${colour(r.failureKind.padEnd(24))} ${r.sourceFile}`);
      console.log(`  pattern: ${r.patternSignature}   kind: ${r.fileKind}   when: ${r.createdAt}`);
      if (r.errorMessage) console.log(`  msg:     ${r.errorMessage.slice(0, 200)}`);
    }
    store.close();
  });

program
  .command("report-patterns")
  .description("Print failure patterns grouped by signature (most-common first).")
  .option("--db <path>", "Override telemetry DB path.")
  .option("-n, --limit <n>", "How many patterns to show.", "20")
  .action(async (opts: { db?: string; limit: string }) => {
    const { createFailureStore } = await import("./server/telemetry");
    const dbPath = opts.db ?? path.resolve(process.cwd(), ".sel2pw", "telemetry.db");
    const store = createFailureStore(dbPath);
    const patterns = store.listFailurePatterns(parseInt(opts.limit, 10));
    if (patterns.length === 0) {
      console.log(chalk.yellow("No patterns yet."));
      console.log(`Looked at: ${dbPath}`);
      return;
    }
    console.log(chalk.bold(`Top failure patterns:`));
    for (const p of patterns) {
      console.log("");
      console.log(`${chalk.cyan(p.count.toString().padStart(5))}× ${p.signature}   (${p.sample.failureKind})`);
      console.log(`       ${p.sample.sourceFile}`);
      if (p.sample.errorMessage) console.log(`       ${p.sample.errorMessage.slice(0, 180)}`);
    }
    store.close();
  });

program
  .command("telemetry-share")
  .description("Opt-in: upload aggregate (no source) telemetry to a central endpoint.")
  .option("--db <path>", "Override telemetry DB path.")
  .option("--endpoint <url>", "Upload URL.", process.env.SEL2PW_TELEMETRY_UPLOAD_URL ?? "")
  .option("--api-key <key>", "Optional bearer token.")
  .action(async (opts: { db?: string; endpoint: string; apiKey?: string }) => {
    if (!opts.endpoint) {
      console.error(chalk.red("--endpoint <url> is required (or set SEL2PW_TELEMETRY_UPLOAD_URL)."));
      process.exit(2);
    }
    const { uploadAggregateTelemetry } = await import("./post/telemetryUpload");
    const dbPath = opts.db ?? path.resolve(process.cwd(), ".sel2pw", "telemetry.db");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PKG = require("../package.json");
    const result = await uploadAggregateTelemetry(
      { endpoint: opts.endpoint, dbPath, apiKey: opts.apiKey },
      PKG.version,
    );
    if (result.ok) {
      console.log(chalk.green("Aggregate telemetry uploaded successfully."));
    } else {
      console.error(chalk.red(`Upload failed: ${result.reason}`));
      process.exit(1);
    }
  });

program
  .command("report-stats")
  .description("Print aggregate stats from the local telemetry DB.")
  .option("--db <path>", "Override telemetry DB path.")
  .action(async (opts: { db?: string }) => {
    const { createFailureStore } = await import("./server/telemetry");
    const dbPath = opts.db ?? path.resolve(process.cwd(), ".sel2pw", "telemetry.db");
    const store = createFailureStore(dbPath);
    const s = store.getStats();
    console.log(chalk.bold("sel2pw telemetry stats"));
    console.log(`  total jobs        ${s.totalJobs}`);
    console.log(`  total failures    ${s.totalFailures}`);
    console.log(`  success rate      ${(s.successRate * 100).toFixed(1)}%`);
    console.log("");
    console.log("  by failure kind:");
    for (const [k, n] of Object.entries(s.byFailureKind).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(24)} ${n}`);
    }
    console.log("");
    console.log("  by file kind:");
    for (const [k, n] of Object.entries(s.byFileKind).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(24)} ${n}`);
    }
    store.close();
  });

/**
 * Tiny dependency-free unified-ish diff for the CLI's --diff mode. For real
 * diffs we recommend piping the output through `git diff --no-index` or
 * using a proper diff library; this is just enough to eyeball changes.
 */
function simpleDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const lines: string[] = [];
  for (let i = 0; i < max; i++) {
    const al = a[i] ?? "";
    const bl = b[i] ?? "";
    if (al === bl) continue;
    if (al) lines.push(chalk.red(`- ${al}`));
    if (bl) lines.push(chalk.green(`+ ${bl}`));
  }
  return lines.length ? lines.join("\n") : "(no textual diff)";
}

program.parseAsync(process.argv);
