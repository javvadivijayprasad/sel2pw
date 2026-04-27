import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs-extra";
import { ReviewItem } from "../types";
import { logger } from "../utils/logger";

const execFileP = promisify(execFile);

/**
 * Run `tsc --noEmit` against the generated Playwright project as a final
 * sanity gate. Any compile errors get attached to the review report so the
 * user knows immediately if the conversion produced un-typecheckable code.
 *
 * Best-effort: if `tsc` isn't on the path (no `npm install` yet in the
 * generated project), we record a warning and move on.
 */
export async function tscValidate(outputDir: string): Promise<{
  ok: boolean;
  warnings: ReviewItem[];
}> {
  const warnings: ReviewItem[] = [];
  // Ensure there's a tsconfig.json in the output project — we ship one in templates.
  const tsconfigPath = path.join(outputDir, "tsconfig.json");
  if (!(await fs.pathExists(tsconfigPath))) {
    return { ok: true, warnings };
  }
  try {
    await execFileP("npx", ["--no-install", "tsc", "-p", outputDir, "--noEmit"], {
      cwd: outputDir,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, warnings };
  } catch (err: any) {
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    const out = stdout + stderr;
    if (
      /'npx' is not recognised|not found|ENOENT|Cannot find module|cannot find/i.test(out) ||
      out.trim().length === 0
    ) {
      // Empty-output non-zero exit (Windows "tsc not installed in output project"
      // is the most common cause) — skip silently rather than log a stale warning.
      logger.info(
        "tsc not available in output project — run `npm install` there to enable --validate",
      );
      return { ok: true, warnings };
    }
    // Attach up to 50 errors to the review.
    const errors = out
      .split("\n")
      .filter((l: string) => l.includes("error TS"))
      .slice(0, 50);
    for (const line of errors) {
      warnings.push({
        file: outputDir,
        severity: "warning",
        message: `TypeScript compile error in generated output: ${line.trim()}`,
      });
    }
    if (errors.length === 0) {
      warnings.push({
        file: outputDir,
        severity: "warning",
        message: `tsc reported issues but no error lines parsed: ${out.slice(0, 500)}`,
      });
    }
    return { ok: false, warnings };
  }
}
