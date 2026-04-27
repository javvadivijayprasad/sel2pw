/**
 * Auto-fix loop — Phase 5 stretch goal.
 *
 * The conceptual loop:
 *
 *   convert →  run (headless) →  capture failures →  diagnose →  patch →  re-run
 *
 * After a regular AST conversion completes, this module spawns Playwright
 * against the generated project, captures failures, and feeds each failure
 * (along with the original Java source, the converted TS, and the failure
 * trace/screenshot) into an LLM with a tightly-scoped editing brief. The
 * LLM returns a unified diff; we apply it; we re-run. Bounded iterations.
 *
 * STATUS: scaffolded. The `runOnce()` step works; the LLM-driven patch
 * generator is currently a stub (`patchFromFailure`) that the user can wire
 * up to Anthropic, OpenAI, or a local model. The loop framing is here so
 * once you plug in `patchFromFailure`, the rest of the orchestration "just
 * works".
 */

import * as path from "path";
import * as fs from "fs-extra";
import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger";

const execFileP = promisify(execFile);

export interface AutoFixOptions {
  outputDir: string;
  /** Max iterations of fix-and-retry. */
  maxIterations?: number;
  /** Provided by the caller — implements the LLM call. */
  patchFromFailure?: PatchFn;
}

export type PatchFn = (input: {
  failure: PlaywrightFailure;
  generatedTs: Record<string, string>;
  originalJava: Record<string, string>;
}) => Promise<UnifiedDiff | null>;

export interface PlaywrightFailure {
  file: string;
  testTitle: string;
  errorMessage: string;
  stack?: string;
  screenshotPath?: string;
}

export interface UnifiedDiff {
  /** Per-file patches. Keys are relative paths under outputDir. */
  patches: Record<string, string>;
}

export async function autoFix(opts: AutoFixOptions): Promise<{
  iterations: number;
  remaining: PlaywrightFailure[];
}> {
  const max = opts.maxIterations ?? 3;
  let failures: PlaywrightFailure[] = [];
  let iterations = 0;

  for (; iterations < max; iterations++) {
    const result = await runOnce(opts.outputDir);
    failures = result.failures;
    if (failures.length === 0) break;
    if (!opts.patchFromFailure) {
      logger.info(
        { failures: failures.length },
        "auto-fix loop has failures but no patchFromFailure callback was provided; stopping",
      );
      break;
    }
    let appliedAny = false;
    for (const f of failures) {
      try {
        const ctx = await collectContext(opts.outputDir, f);
        const diff = await opts.patchFromFailure({
          failure: f,
          generatedTs: ctx.generatedTs,
          originalJava: ctx.originalJava,
        });
        if (!diff) continue;
        await applyDiff(opts.outputDir, diff);
        appliedAny = true;
      } catch (err: any) {
        logger.warn({ err: err.message, file: f.file }, "patch failed");
      }
    }
    if (!appliedAny) break;
  }
  return { iterations, remaining: failures };
}

export async function runOnce(outputDir: string): Promise<{
  passed: boolean;
  failures: PlaywrightFailure[];
}> {
  try {
    const { stdout } = await execFileP(
      "npx",
      ["--no-install", "playwright", "test", "--reporter=json"],
      { cwd: outputDir, maxBuffer: 50 * 1024 * 1024 },
    );
    const report = JSON.parse(stdout);
    const failures = parseFailuresFromJsonReport(report);
    return { passed: failures.length === 0, failures };
  } catch (err: any) {
    const stdout = err.stdout?.toString() ?? "";
    try {
      const report = JSON.parse(stdout);
      const failures = parseFailuresFromJsonReport(report);
      return { passed: false, failures };
    } catch {
      return {
        passed: false,
        failures: [
          {
            file: "(suite)",
            testTitle: "playwright runner errored",
            errorMessage: err.message,
            stack: err.stderr?.toString(),
          },
        ],
      };
    }
  }
}

function parseFailuresFromJsonReport(report: any): PlaywrightFailure[] {
  const out: PlaywrightFailure[] = [];
  const stack = [report];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (Array.isArray(cur.suites)) stack.push(...cur.suites);
    if (Array.isArray(cur.specs)) {
      for (const spec of cur.specs) {
        for (const t of spec.tests ?? []) {
          for (const r of t.results ?? []) {
            if (r.status === "failed" || r.status === "timedOut") {
              out.push({
                file: spec.file ?? "",
                testTitle: spec.title ?? "",
                errorMessage: r.error?.message ?? r.errors?.[0]?.message ?? "",
                stack: r.error?.stack,
                screenshotPath: r.attachments?.find((a: any) =>
                  /screenshot/i.test(a.name ?? ""),
                )?.path,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

async function collectContext(
  outputDir: string,
  failure: PlaywrightFailure,
): Promise<{
  generatedTs: Record<string, string>;
  originalJava: Record<string, string>;
}> {
  const generatedTs: Record<string, string> = {};
  const originalJava: Record<string, string> = {};
  const failureFile = path.resolve(outputDir, failure.file);
  if (await fs.pathExists(failureFile)) {
    generatedTs[failure.file] = await fs.readFile(failureFile, "utf8");
  }
  // Pull Page Objects referenced by the spec — heuristic match on imports.
  const text = generatedTs[failure.file] ?? "";
  for (const m of text.matchAll(/from\s+['"](\.\.\/pages\/[^'"]+)['"]/g)) {
    const rel = m[1] + ".ts";
    const abs = path.resolve(outputDir, "tests", "..", rel.replace(/^\.\.\//, ""));
    if (await fs.pathExists(abs)) {
      generatedTs[rel] = await fs.readFile(abs, "utf8");
    }
  }
  // The Java side: caller can stash the original source map under
  //   <outputDir>/.sel2pw/originals/<rel>.java
  const originalsDir = path.join(outputDir, ".sel2pw", "originals");
  if (await fs.pathExists(originalsDir)) {
    const all = await fs.readdir(originalsDir);
    for (const f of all) {
      originalJava[f] = await fs.readFile(path.join(originalsDir, f), "utf8");
    }
  }
  return { generatedTs, originalJava };
}

async function applyDiff(outputDir: string, diff: UnifiedDiff): Promise<void> {
  for (const [rel, patch] of Object.entries(diff.patches)) {
    const target = path.resolve(outputDir, rel);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, patch, "utf8");
    logger.info({ file: rel }, "auto-fix applied patch");
  }
}
