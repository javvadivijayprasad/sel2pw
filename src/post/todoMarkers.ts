/**
 * Insert `// TODO(sel2pw): …` markers into generated TS at lines that
 * triggered review warnings. The user finds them via grep without having to
 * cross-reference CONVERSION_REVIEW.md.
 *
 * Strategy: for each `manual` warning that has a snippet, search the
 * converted source for the snippet's first ~30 chars and prepend a TODO
 * comment on the line above. Conservative: never inserts more than one
 * marker per warning, never inside string literals.
 */

import { ConvertedFile, ReviewItem } from "../types";

export function insertTodoMarkers(
  files: ConvertedFile[],
  warnings: ReviewItem[],
): ConvertedFile[] {
  const out: ConvertedFile[] = [];
  for (const file of files) {
    if (!file.relPath.endsWith(".ts")) {
      out.push(file);
      continue;
    }
    const fileWarnings = warnings.filter(
      (w) =>
        w.severity === "manual" &&
        sameFile(w.file, file.relPath) &&
        !!(w.snippet ?? w.message),
    );
    if (fileWarnings.length === 0) {
      out.push(file);
      continue;
    }
    const lines = file.source.split("\n");
    for (const w of fileWarnings) {
      const needle = (w.snippet ?? "").slice(0, 30).trim();
      if (!needle) continue;
      const idx = lines.findIndex((l) => l.includes(needle));
      if (idx < 0) continue;
      lines.splice(
        idx,
        0,
        `${leadingWhitespace(lines[idx])}// TODO(sel2pw): ${oneLine(w.message)}`,
      );
    }
    out.push({ ...file, source: lines.join("\n") });
  }
  return out;
}

function sameFile(a: string, b: string): boolean {
  // Warnings carry absolute Java paths; converted files carry relative TS paths.
  // Match best-effort by basename root.
  const aBase = a.split(/[\\/]/).pop() ?? a;
  const bBase = b.split(/[\\/]/).pop() ?? b;
  const aStem = aBase.replace(/\.(java|ts)$/, "");
  const bStem = bBase
    .replace(/\.(spec|page)\.ts$/, "")
    .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  return aStem.toLowerCase() === bStem.toLowerCase();
}

function leadingWhitespace(line: string): string {
  const m = line.match(/^\s*/);
  return m ? m[0] : "";
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
