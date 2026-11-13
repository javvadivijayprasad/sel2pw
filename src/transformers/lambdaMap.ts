import { ReviewItem } from "../types";

/**
 * Java lambda expressions → TypeScript arrow functions (issue #20).
 *
 *   x -> x.click()                 →  (x) => x.click()
 *   (a, b) -> a.compareTo(b)       →  (a, b) => a.compareTo(b)
 *   (String a, int b) -> ...       →  (a, b) => ...        (Java parameter types dropped)
 *   (Map<K, V> m) -> ...           →  (m) => ...
 *   () -> { ... }                  →  () => { ... }
 *   driver -> { ... }              →  (driver) => { ... }
 *
 * Only real code is rewritten. Text inside string literals, character literals and
 * comments is left alone, so `"a -> b"`, `// step 1 --> step 2` and XPath axes such as
 * `parent::div` are never touched.
 *
 * Java switch arrows (`case LOCAL -> ...`, `default -> ...`) are not lambdas. They are
 * left as they are and reported once per file, because the right TypeScript shape
 * (`case X: return ...` or an object lookup) depends on how the switch is used.
 *
 * Method references (`String::length`, `this::onStart`) are a separate rule.
 */

export interface LambdaMapResult {
  body: string;
  warnings: ReviewItem[];
  /** How many lambda arrows were rewritten (useful for tests and reports). */
  converted: number;
}

const IDENT_AT_END = /[A-Za-z_$][\w$]*$/;

/**
 * Return a copy of `src` where every character inside a string literal, character
 * literal, text block, template literal or comment is replaced by `\u0000`. Code
 * characters keep their positions, so indexes found in the mask are valid in `src`.
 */
export function maskNonCode(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = "\u0000";
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const stop = end === -1 ? src.length : end + 3;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n" && c !== "`") break; // unterminated: stop at end of line
        j++;
      }
      const stop = Math.min(j + 1, src.length);
      blank(i, stop);
      i = stop;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** Split a parameter list on top-level commas, ignoring commas inside <...>, (...) or [...]. */
function splitParams(params: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(params.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(params.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** `final String name` / `@NotNull Map<K, V> m` / `String... xs` / `x` → the parameter name. */
function paramName(param: string): string | null {
  const cleaned = param
    .replace(/@\w+(\([^)]*\))?\s*/g, "")
    .replace(/\bfinal\s+/g, "")
    .trim();
  const m = cleaned.match(IDENT_AT_END);
  return m ? m[0] : null;
}

/** Index of the `(` that matches the `)` at `close`, scanning the masked text backwards. */
function matchingOpenParen(mask: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = mask[i];
    if (c === ")") depth++;
    else if (c === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function applyLambdaRewrites(raw: string, filePath: string): LambdaMapResult {
  const warnings: ReviewItem[] = [];
  if (!raw.includes("->")) return { body: raw, warnings, converted: 0 };

  const mask = maskNonCode(raw);
  const edits: Array<{ from: number; to: number; text: string }> = [];
  let switchArrows = 0;

  for (let at = mask.indexOf("->"); at !== -1; at = mask.indexOf("->", at + 2)) {
    // `x-->0` is a decrement followed by a comparison, not a lambda.
    if (mask[at - 1] === "-") continue;

    // Java switch arrows: `case A ->`, `case A, B ->`, `default ->`.
    const lineStart = mask.lastIndexOf("\n", at - 1) + 1;
    const lineBefore = mask.slice(lineStart, at).trim();
    if (/^(case\b.*|default)$/.test(lineBefore)) {
      switchArrows++;
      continue;
    }

    // Find the parameter list immediately to the left of the arrow.
    let k = at - 1;
    while (k >= 0 && /\s/.test(mask[k])) k--;
    if (k < 0) continue;

    let from: number;
    let names: string[];
    if (mask[k] === ")") {
      const open = matchingOpenParen(mask, k);
      if (open === -1) continue;
      const inner = raw.slice(open + 1, k);
      const parts = splitParams(inner);
      const resolved = parts.map(paramName);
      if (resolved.some((n) => n === null)) continue;
      names = resolved as string[];
      from = open;
    } else {
      const m = mask.slice(0, k + 1).match(IDENT_AT_END);
      if (!m) continue;
      names = [m[0]];
      from = k + 1 - m[0].length;
    }

    edits.push({ from, to: at + 2, text: `(${names.join(", ")}) =>` });
  }

  let body = raw;
  for (const e of edits.sort((a, b) => b.from - a.from)) {
    body = body.slice(0, e.from) + e.text + body.slice(e.to);
  }

  if (switchArrows > 0) {
    warnings.push({
      file: filePath,
      severity: "warning",
      message:
        `Java switch expression with arrow cases (\`case X -> ...\`) left unconverted (${switchArrows} case${switchArrows === 1 ? "" : "s"}). ` +
        "Rewrite it as a TypeScript `switch` with `case X:` and `return`/`break`, or as an object lookup.",
    });
  }

  return { body, warnings, converted: edits.length };
}
