/**
 * TestNG / JUnit assertion → Playwright `expect` mappings.
 *
 * The earlier regex-only approach broke on:
 *   - assertEquals(actual, "Welcome, alice!")  — comma inside string literal
 *   - assertTrue(homePage.isLogoutVisible())   — parens inside argument
 *
 * Implementation: scan for `Assert.<name>(`, then parse balanced parens
 * (string-aware) to extract args, then map to the right `expect()` form.
 */

const MAPPINGS: Record<string, (args: string[]) => string> = {
  assertEquals: (args) =>
    args.length >= 3
      ? `expect(${args[0]}, ${args[2]}).toBe(${args[1]});`
      : `expect(${args[0]}).toBe(${args[1]});`,
  assertNotEquals: (args) => `expect(${args[0]}).not.toBe(${args[1]});`,
  assertTrue: (args) =>
    args.length >= 2
      ? `expect(${args[0]}, ${args[1]}).toBe(true);`
      : `expect(${args[0]}).toBe(true);`,
  assertFalse: (args) =>
    args.length >= 2
      ? `expect(${args[0]}, ${args[1]}).toBe(false);`
      : `expect(${args[0]}).toBe(false);`,
  assertNull: (args) => `expect(${args[0]}).toBeNull();`,
  assertNotNull: (args) => `expect(${args[0]}).not.toBeNull();`,
  assertContains: (args) => `expect(${args[0]}).toContain(${args[1]});`,
  fail: (args) => `throw new Error(${args[0] ?? "'Test failed'"});`,
};

export function applyAssertionRewrites(body: string): string {
  let out = "";
  let i = 0;
  const callRe = /\bAssert\.(\w+)\s*\(/g;
  while (i <= body.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(body);
    if (!m) {
      out += body.slice(i);
      break;
    }
    out += body.slice(i, m.index);
    const name = m[1];
    const mapping = MAPPINGS[name];
    const argsStart = m.index + m[0].length;
    if (!mapping) {
      out += body.slice(m.index, argsStart);
      i = argsStart;
      continue;
    }
    const parsed = parseArgs(body, argsStart);
    if (!parsed) {
      out += body.slice(m.index, argsStart);
      i = argsStart;
      continue;
    }
    // Skip optional trailing whitespace, then `;`.
    let endIdx = parsed.endIdx;
    while (endIdx < body.length && /[ \t]/.test(body[endIdx])) endIdx++;
    if (body[endIdx] !== ";") {
      out += body.slice(m.index, argsStart);
      i = argsStart;
      continue;
    }
    out += mapping(parsed.args);
    i = endIdx + 1;
  }
  return out;
}

/**
 * Parse comma-separated argument list starting just AFTER the opening `(`.
 * Returns args and the index just AFTER the matching `)`.
 * String-aware (double-quoted strings only — Java doesn't have single-quoted strings beyond chars).
 */
function parseArgs(
  s: string,
  start: number,
): { args: string[]; endIdx: number } | null {
  let depth = 1;
  let inString = false;
  let cur = "";
  const args: string[] = [];
  for (let p = start; p < s.length; p++) {
    const c = s[p];
    const prev = p > 0 ? s[p - 1] : "";
    if (inString) {
      cur += c;
      if (c === '"' && prev !== "\\") inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      cur += c;
      continue;
    }
    if (c === "(") {
      depth++;
      cur += c;
      continue;
    }
    if (c === ")") {
      depth--;
      if (depth === 0) {
        if (cur.trim() !== "" || args.length > 0) args.push(cur.trim());
        return { args, endIdx: p + 1 };
      }
      cur += c;
      continue;
    }
    if (c === "," && depth === 1) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  return null;
}
