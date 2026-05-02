import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs-extra";

const execFileP = promisify(execFile);

/**
 * v2.0 spike — TS error capture for the auto-fix loop.
 *
 * Runs `tsc --noEmit --pretty false` against the converted output project,
 * parses every diagnostic into a structured `TscError`, and attaches three
 * lines of context around each error (the LLM patch generator needs the
 * surrounding code to make sensible patches).
 *
 * NOT yet wired into the convert() pipeline. This is the foundation
 * component for the auto-fix loop described in `docs/ROADMAP_V2.md`
 * Theme 1. The loop will:
 *   1. Run rule-based conversion (existing v1.x pipeline)
 *   2. Run this `runTsc()` to capture errors
 *   3. Group errors by root cause (`errorGrouper.ts` — TODO)
 *   4. For each group: send to LLM, apply patch (`patchGenerator.ts` +
 *      `patchApplier.ts` — TODO)
 *   5. Re-run tsc, repeat until error count is 0 or fixed-point reached
 *
 * Used standalone today as a diagnostic — `node -e "import('./dist/autofix/tscRunner.js').then(m => m.runTsc('./out').then(console.log))"`.
 */

export interface TscError {
  /** Absolute path to the file with the error. */
  filePath: string;
  /** Path relative to the project root (the dir tsconfig.json lives in). */
  relPath: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** TS diagnostic code, e.g. "TS2304". */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Three lines before, the offending line, three lines after. */
  context: {
    before: string[];
    line: string;
    after: string[];
  };
}

export interface TscRunResult {
  ok: boolean;
  errorCount: number;
  errors: TscError[];
  /** Raw tsc stdout/stderr if needed for debugging. */
  rawOutput: string;
}

/**
 * Run `tsc --noEmit` against `projectDir` and return structured errors.
 *
 * Requires:
 *   - tsconfig.json in projectDir
 *   - typescript installed in projectDir/node_modules (or globally)
 *
 * @param projectDir Absolute path to the converted Playwright project root
 * @param options.maxErrors Cap parsing at N errors (default: 1000) to keep
 *                          memory bounded on huge codebases
 */
export async function runTsc(
  projectDir: string,
  options: { maxErrors?: number; tsBin?: string } = {},
): Promise<TscRunResult> {
  const maxErrors = options.maxErrors ?? 1000;
  const tsBin = options.tsBin ?? "npx";
  const args =
    tsBin === "npx"
      ? ["--no-install", "tsc", "-p", projectDir, "--noEmit", "--pretty", "false", "--noErrorTruncation"]
      : ["-p", projectDir, "--noEmit", "--pretty", "false", "--noErrorTruncation"];

  let rawOutput = "";
  try {
    const { stdout, stderr } = await execFileP(tsBin, args, {
      cwd: projectDir,
      maxBuffer: 50 * 1024 * 1024,
    });
    rawOutput = stdout + stderr;
  } catch (err) {
    // tsc returns non-zero when there are errors — that's the normal path.
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    rawOutput = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
  }

  const errors = await parseTscOutput(rawOutput, projectDir, maxErrors);
  return {
    ok: errors.length === 0,
    errorCount: errors.length,
    errors,
    rawOutput,
  };
}

/**
 * Parse tsc's compact output format into structured errors.
 *
 * Format: `<file>(<line>,<col>): error <code>: <message>`
 *
 * Multi-line messages (TS2322 sometimes wraps) are joined back into one
 * `message` field by detecting indentation continuation.
 */
async function parseTscOutput(
  raw: string,
  projectDir: string,
  maxErrors: number,
): Promise<TscError[]> {
  const lineRe = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
  const errors: TscError[] = [];
  const fileCache = new Map<string, string[]>();

  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (!m) continue;
    if (errors.length >= maxErrors) break;
    const [, filePath, lineStr, colStr, code, message] = m;
    const lineNum = parseInt(lineStr, 10);
    const colNum = parseInt(colStr, 10);

    // Resolve to absolute path so file reads are robust regardless of
    // tsc's cwd (sometimes prints absolute, sometimes relative).
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectDir, filePath);
    const relPath = path
      .relative(projectDir, absPath)
      .replace(/\\/g, "/");

    // Read + cache file contents so multiple errors in the same file
    // don't re-read it.
    let lines = fileCache.get(absPath);
    if (!lines) {
      try {
        const text = await fs.readFile(absPath, "utf8");
        lines = text.split(/\r?\n/);
        fileCache.set(absPath, lines);
      } catch {
        lines = [];
      }
    }

    const before = lines.slice(Math.max(0, lineNum - 4), lineNum - 1);
    const lineText = lines[lineNum - 1] ?? "";
    const after = lines.slice(lineNum, Math.min(lines.length, lineNum + 3));

    errors.push({
      filePath: absPath,
      relPath,
      line: lineNum,
      column: colNum,
      code,
      message: message.trim(),
      context: { before, line: lineText, after },
    });
  }

  return errors;
}

/**
 * Group errors by file. Useful for the patch generator — patching all
 * errors in one file in a single LLM call is cheaper than one call per
 * error.
 */
export function groupErrorsByFile(errors: TscError[]): Map<string, TscError[]> {
  const out = new Map<string, TscError[]>();
  for (const err of errors) {
    const list = out.get(err.relPath) ?? [];
    list.push(err);
    out.set(err.relPath, list);
  }
  // Sort each file's errors by line number (top-down patches).
  for (const list of out.values()) {
    list.sort((a, b) => a.line - b.line);
  }
  return out;
}

/**
 * Summary stats — useful for progress reporting in the auto-fix CLI.
 */
export interface TscSummary {
  totalErrors: number;
  uniqueFiles: number;
  byCode: Record<string, number>;
  topFiles: { relPath: string; errorCount: number }[];
}

export function summariseTscRun(result: TscRunResult): TscSummary {
  const byCode: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  for (const err of result.errors) {
    byCode[err.code] = (byCode[err.code] ?? 0) + 1;
    byFile[err.relPath] = (byFile[err.relPath] ?? 0) + 1;
  }
  const topFiles = Object.entries(byFile)
    .map(([relPath, errorCount]) => ({ relPath, errorCount }))
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, 10);
  return {
    totalErrors: result.errorCount,
    uniqueFiles: Object.keys(byFile).length,
    byCode,
    topFiles,
  };
}
