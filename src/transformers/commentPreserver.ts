/**
 * Carry Java comments through the conversion so the generated TypeScript
 * keeps the same documentation context.
 *
 * What we preserve:
 *   - Javadoc blocks `/** … * /` immediately before a method declaration
 *   - Single-line `//` comments inside method bodies
 *   - Multi-line `/* … * /` comments inside method bodies
 *
 * What we drop:
 *   - License headers at top of file (the generated project has its own)
 *   - `@author`/`@since` Javadoc tags (rarely useful in the new project)
 *   - Comments on the inside of the locator field declaration block
 *     (the field renaming + restructuring makes line-level mapping unsafe)
 *
 * The implementation is pragmatic: we extract a `(beforeMethod, body)`
 * pair from a Java method, sanitise the leading Javadoc, and the body
 * comments survive the body-transformer pass because they're text rather
 * than syntax.
 */

const JAVADOC_RE = /\/\*\*([\s\S]*?)\*\//g;

/**
 * Find the Javadoc block that appears IMMEDIATELY before the method's
 * first annotation or signature line. Returns the cleaned-up TS-style
 * doc comment, or `null` if there isn't one.
 */
export function findJavadocBeforeMethod(
  source: string,
  methodIndex: number,
): string | null {
  // Scan backwards from methodIndex through whitespace/newlines/annotations
  // until we either hit a `}`/`;` (no doc comment for this method) or a
  // closing `*/` of a Javadoc.
  let p = methodIndex - 1;
  while (p > 0) {
    const c = source[p];
    if (c === "/" && source[p - 1] === "*") {
      // Found end of a comment. Walk back to find its start.
      let q = p - 2;
      while (q > 0) {
        if (source[q] === "*" && source[q - 1] === "/") {
          // Could be javadoc /** … */ or block /* … */ — only keep javadoc.
          const blockStart = q - 1;
          const block = source.slice(blockStart, p + 1);
          if (block.startsWith("/**")) {
            return cleanJavadoc(block);
          }
          return null;
        }
        q--;
      }
      return null;
    }
    if (c === "}" || c === ";") return null;
    if (c === "@") {
      // Annotation precedes — keep walking up past it.
      while (p > 0 && source[p] !== "\n") p--;
    }
    p--;
  }
  return null;
}

/**
 * Convert a Java Javadoc block into TS-style JSDoc, dropping noise tags.
 */
function cleanJavadoc(block: string): string {
  // Strip leading `/**` and trailing `*/`.
  const inner = block.slice(3, -2);
  const lines = inner
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\* ?/, "").trimEnd())
    // Drop noise tags
    .filter((l) => !/^@(author|since|version)\b/.test(l.trim()));

  // Trim leading + trailing blank lines.
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

  if (lines.length === 0) return "";

  const out: string[] = ["/**"];
  for (const l of lines) out.push(` * ${l}`);
  out.push(" */");
  return out.join("\n");
}

/**
 * Preserve comments inside a method body. The body transformer already
 * keeps `//` and `/* … * /` characters verbatim through its rewrites
 * (those rewrites match Selenium-specific tokens, not comment text). This
 * helper exists to re-anchor comments that ended up orphaned after a
 * rewrite removed the line they were attached to.
 *
 * Returns the body unchanged in v1; the helper is a hook for the comment
 * preservation pass to evolve into without touching every rewrite rule.
 */
export function preserveBodyComments(body: string): string {
  return body;
}

/**
 * Strip a license header from the top of a Java file (best-effort).
 * Useful when source comments aren't appropriate for the new project.
 */
export function stripFileHeader(source: string): string {
  // Drop a leading `/* … */` block if it's the very first non-whitespace.
  const m = /^\s*\/\*[\s\S]*?\*\//.exec(source);
  if (m && /(?:Copyright|License|©)/i.test(m[0])) {
    return source.slice(m.index + m[0].length).replace(/^\s*\n/, "");
  }
  return source;
}

/**
 * Find ALL Javadoc blocks in a file, indexed by the position right after
 * each block. Useful for callers that want to attach docs to whatever
 * declaration follows.
 */
export function indexAllJavadocs(source: string): {
  endsAt: number;
  doc: string;
}[] {
  const out: { endsAt: number; doc: string }[] = [];
  let m: RegExpExecArray | null;
  JAVADOC_RE.lastIndex = 0;
  while ((m = JAVADOC_RE.exec(source)) !== null) {
    const cleaned = cleanJavadoc(m[0]);
    if (cleaned) out.push({ endsAt: m.index + m[0].length, doc: cleaned });
  }
  return out;
}
