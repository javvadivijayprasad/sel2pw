import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs-extra";
import { ReviewItem } from "../types";
import { logger } from "../utils/logger";

const execFileP = promisify(execFile);

/**
 * Run `eslint` against the generated Playwright project.
 *
 * Sister pass to `tscValidate`. Where tsc catches type errors, eslint catches
 * style and best-practice issues that compile but indicate bugs — unused
 * vars, unreachable code, accidental `==` instead of `===`, missing `await`
 * on promises (extremely relevant for a Playwright project), etc.
 *
 * Best-effort by design: if eslint isn't installed in the output project
 * (most common case — user hasn't run `npm install` there yet) OR the
 * project doesn't have an eslint config, record a single info note and move
 * on. Don't fail the conversion on missing tooling.
 *
 * Errors / warnings get parsed from eslint's compact output format and
 * attached to the conversion review so the user sees them in
 * CONVERSION_REVIEW.md alongside the TS / Hamcrest / Actions warnings.
 */
export async function eslintValidate(outputDir: string): Promise<{
  ok: boolean;
  warnings: ReviewItem[];
}> {
  const warnings: ReviewItem[] = [];

  // Quick gate: skip if there's no eslint config in the output. We don't
  // emit one (the user can copy from their root) — running eslint with no
  // config errors out with a confusing message that isn't actionable.
  const hasEslintConfig =
    (await fs.pathExists(path.join(outputDir, ".eslintrc.json"))) ||
    (await fs.pathExists(path.join(outputDir, ".eslintrc.js"))) ||
    (await fs.pathExists(path.join(outputDir, ".eslintrc.cjs"))) ||
    (await fs.pathExists(path.join(outputDir, "eslint.config.js"))) ||
    (await fs.pathExists(path.join(outputDir, "eslint.config.mjs")));

  if (!hasEslintConfig) {
    warnings.push({
      file: outputDir,
      severity: "info",
      message:
        "ESLint validation skipped — no eslint config found in output. " +
        "Add `.eslintrc.json` (or copy from your team's standard) and re-run with `--validate-eslint`.",
    });
    return { ok: true, warnings };
  }

  try {
    await execFileP(
      "npx",
      [
        "--no-install",
        "eslint",
        "--format",
        "compact",
        "--ext",
        ".ts",
        "tests",
        "pages",
      ],
      {
        cwd: outputDir,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    // No errors and no warnings — eslint exited 0.
    return { ok: true, warnings };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    const stdout = (e.stdout?.toString() ?? "").trim();
    const stderr = (e.stderr?.toString() ?? "").trim();
    const out = stdout + (stderr ? "\n" + stderr : "");

    // Tooling missing (expected if user hasn't `npm install`-ed in output).
    if (
      /'npx' is not recognised|not found|ENOENT|Cannot find module|cannot find/i.test(out) ||
      out.length === 0
    ) {
      logger.info(
        "eslint not available in output project — run `npm install` there to enable --validate-eslint",
      );
      warnings.push({
        file: outputDir,
        severity: "info",
        message:
          "ESLint validation skipped — eslint isn't installed in the output project. " +
          "Run `npm install` in the output dir and re-run sel2pw with `--validate-eslint`.",
      });
      return { ok: true, warnings };
    }

    // Parse compact-format output:
    //   <abs-path>: line N, col M, Error - <message> (<rule>)
    //   <abs-path>: line N, col M, Warning - <message> (<rule>)
    const lineRe = /^(.+?):\s+line\s+(\d+),\s+col\s+(\d+),\s+(Error|Warning)\s+-\s+(.+?)\s+\((.+?)\)\s*$/;
    let parsedCount = 0;
    let errorCount = 0;
    for (const raw of out.split("\n")) {
      const m = raw.match(lineRe);
      if (!m) continue;
      parsedCount += 1;
      const [, file, line, col, severity, message, rule] = m;
      const isError = severity === "Error";
      if (isError) errorCount += 1;
      // Surface up to 100 to keep the review report bounded.
      if (parsedCount > 100) continue;
      warnings.push({
        file: path.relative(outputDir, file).replace(/\\/g, "/"),
        severity: isError ? "warning" : "info",
        message: `ESLint ${rule} (${severity.toLowerCase()}) at ${line}:${col} — ${message}`,
      });
    }

    if (parsedCount === 0) {
      // Non-zero exit but nothing parsed — surface the raw blob, capped.
      warnings.push({
        file: outputDir,
        severity: "warning",
        message: `eslint reported issues but no lines parsed: ${out.slice(0, 500)}`,
      });
    } else if (parsedCount > 100) {
      warnings.push({
        file: outputDir,
        severity: "warning",
        message: `ESLint reported ${parsedCount} issues; only the first 100 are surfaced in this report. Run \`npx eslint .\` in the output dir to see the full list.`,
      });
    }

    // ok is true if there are no errors (warnings are tolerable).
    return { ok: errorCount === 0, warnings };
  }
}
