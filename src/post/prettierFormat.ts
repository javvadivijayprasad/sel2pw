/**
 * Optionally run Prettier over the generated TS files. We dynamic-require so
 * the converter still works in environments where Prettier isn't installed.
 */
import { ConvertedFile } from "../types";
import { logger } from "../utils/logger";

let cachedPrettier: typeof import("prettier") | null = null;
let prettierMissing = false;

function loadPrettier(): typeof import("prettier") | null {
  if (prettierMissing) return null;
  if (cachedPrettier !== null) return cachedPrettier;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedPrettier = require("prettier");
    return cachedPrettier;
  } catch {
    prettierMissing = true;
    logger.info("prettier not installed; skipping output formatting");
    return null;
  }
}

export async function prettyPrint(files: ConvertedFile[]): Promise<ConvertedFile[]> {
  const prettier = loadPrettier();
  if (!prettier) return files;
  const out: ConvertedFile[] = [];
  for (const f of files) {
    if (!f.relPath.endsWith(".ts")) {
      out.push(f);
      continue;
    }
    try {
      // Both v2 (sync `.format`) and v3 (async `.format`) work with `await`.
      const formatted = await Promise.resolve(
        prettier.format(f.source, {
          parser: "typescript",
          printWidth: 90,
          singleQuote: false,
          trailingComma: "all",
        }),
      );
      out.push({ ...f, source: formatted });
    } catch (err: any) {
      logger.warn(
        { file: f.relPath, err: err.message },
        "prettier failed for file; keeping unformatted output",
      );
      out.push(f);
    }
  }
  return out;
}
