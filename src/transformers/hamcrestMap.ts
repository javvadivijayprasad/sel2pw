/**
 * Hamcrest matchers used inside `assertThat(actual, <matcher>)` calls →
 * Playwright `expect()` equivalents.
 *
 * Hamcrest is the most common alternative to TestNG's plain `Assert.*` and
 * Java teams using JUnit5 + Hamcrest are a sizeable migration audience.
 *
 * Common shape:
 *   assertThat(items, hasItem("alpha"));
 *   assertThat(items, containsInAnyOrder("a", "b", "c"));
 *   assertThat(name, equalToIgnoringCase("Alice"));
 *   assertThat(value, is(notNullValue()));
 *
 * The mapping table is small but covers ~80% of real-world usage. We use
 * the same scan-based parsing as `assertionMap.ts` so commas and parens in
 * arguments are handled correctly.
 */

const MATCHERS: Record<string, (actual: string, args: string[]) => string> = {
  equalTo: (a, args) => `expect(${a}).toBe(${args[0]});`,
  equalToIgnoringCase: (a, args) =>
    `expect(${a}.toLowerCase()).toBe(${args[0]}.toLowerCase());`,
  is: (a, args) => `expect(${a}).toBe(${args[0]});`,
  not: (a, args) => `expect(${a}).not.toBe(${args[0]});`,
  notNullValue: (a) => `expect(${a}).not.toBeNull();`,
  nullValue: (a) => `expect(${a}).toBeNull();`,
  hasItem: (a, args) => `expect(${a}).toContain(${args[0]});`,
  hasItems: (a, args) => args.map((g) => `expect(${a}).toContain(${g});`).join(" "),
  containsString: (a, args) => `expect(${a}).toContain(${args[0]});`,
  startsWith: (a, args) => `expect(${a}.startsWith(${args[0]})).toBe(true);`,
  endsWith: (a, args) => `expect(${a}.endsWith(${args[0]})).toBe(true);`,
  containsInAnyOrder: (a, args) => `expect(${a}).toEqual(expect.arrayContaining([${args.join(", ")}]));`,
  contains: (a, args) => `expect(${a}).toEqual([${args.join(", ")}]);`,
  empty: (a) => `expect(${a}).toHaveLength(0);`,
  hasSize: (a, args) => `expect(${a}).toHaveLength(${args[0]});`,
  greaterThan: (a, args) => `expect(${a}).toBeGreaterThan(${args[0]});`,
  greaterThanOrEqualTo: (a, args) =>
    `expect(${a}).toBeGreaterThanOrEqual(${args[0]});`,
  lessThan: (a, args) => `expect(${a}).toBeLessThan(${args[0]});`,
  lessThanOrEqualTo: (a, args) =>
    `expect(${a}).toBeLessThanOrEqual(${args[0]});`,
};

export function applyHamcrestRewrites(body: string): string {
  let out = "";
  let i = 0;
  const callRe = /\bassertThat\s*\(/g;
  while (i <= body.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(body);
    if (!m) {
      out += body.slice(i);
      break;
    }
    out += body.slice(i, m.index);
    const argsStart = m.index + m[0].length;
    const parsed = parseTopLevelArgs(body, argsStart);
    if (!parsed || parsed.args.length < 2) {
      out += body.slice(m.index, argsStart);
      i = argsStart;
      continue;
    }
    let endIdx = parsed.endIdx;
    while (endIdx < body.length && /[ \t]/.test(body[endIdx])) endIdx++;
    if (body[endIdx] !== ";") {
      out += body.slice(m.index, argsStart);
      i = argsStart;
      continue;
    }
    const [actual, matcherExpr] = parsed.args;
    const replacement = mapMatcher(actual, matcherExpr);
    if (replacement) {
      out += replacement;
      i = endIdx + 1;
    } else {
      out += body.slice(m.index, argsStart);
      i = argsStart;
    }
  }
  return out;
}

function mapMatcher(actual: string, matcherExpr: string): string | null {
  const m = /^(\w+)\s*\((.*)\)\s*$/.exec(matcherExpr.trim());
  if (!m) return null;
  const name = m[1];
  const argsRaw = m[2];
  const fn = MATCHERS[name];
  if (!fn) return null;
  const args = argsRaw.trim() ? splitTopLevel(argsRaw) : [];
  // Special composition: not(notNullValue()) → expect(x).toBeNull()
  if (name === "not" && /^notNullValue\s*\(\s*\)\s*$/.test(args[0] ?? "")) {
    return `expect(${actual}).toBeNull();`;
  }
  if (name === "not" && /^nullValue\s*\(\s*\)\s*$/.test(args[0] ?? "")) {
    return `expect(${actual}).not.toBeNull();`;
  }
  // Special composition: is(notNullValue()) → expect(x).not.toBeNull()
  if (name === "is" && /^notNullValue\s*\(\s*\)\s*$/.test(args[0] ?? "")) {
    return `expect(${actual}).not.toBeNull();`;
  }
  if (name === "is" && /^nullValue\s*\(\s*\)\s*$/.test(args[0] ?? "")) {
    return `expect(${actual}).toBeNull();`;
  }
  // Special composition: not(empty()) → expect(x).not.toHaveLength(0)
  if (name === "not" && /^empty\s*\(\s*\)\s*$/.test(args[0] ?? "")) {
    return `expect(${actual}).not.toHaveLength(0);`;
  }
  return fn(actual, args);
}

function parseTopLevelArgs(
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

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let cur = "";
  for (let p = 0; p < s.length; p++) {
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
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
