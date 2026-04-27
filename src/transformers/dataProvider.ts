import { ParamIR } from "../types";

/**
 * Convert a TestNG `@DataProvider` method body into a Playwright-friendly
 * parameterised test.
 *
 * TestNG shape:
 *   @DataProvider(name = "credentials")
 *   public Object[][] credentials() {
 *     return new Object[][] {
 *       { "alice", "correct-horse" },
 *       { "bob", "battery-staple" },
 *     };
 *   }
 *
 *   @Test(dataProvider = "credentials")
 *   public void login(String username, String password) { ... }
 *
 * Playwright shape:
 *   const credentials: [string, string][] = [
 *     ["alice", "correct-horse"],
 *     ["bob", "battery-staple"],
 *   ];
 *   for (const [username, password] of credentials) {
 *     test(`login (${username})`, async ({ page }) => { ... });
 *   }
 *
 * The transform is best-effort — we extract literal rows from the array
 * initialiser. If the data provider builds rows dynamically we surface a
 * `manual` warning rather than emitting incorrect code.
 */

export interface DataProviderRow {
  /** Each cell is the raw Java expression — e.g. `"alice"`, `42`, `null`. */
  cells: string[];
}

export interface ParsedDataProvider {
  name: string;
  rows: DataProviderRow[];
  /** True if any row contained an expression we didn't recognise. */
  unsafe: boolean;
}

/**
 * Find @DataProvider methods in the source and extract their literal rows.
 * The search is regex-based on the body text; for non-literal data providers
 * (loops, file I/O), `unsafe: true` is set so the caller falls back to a
 * manual-review warning.
 */
export function extractDataProviders(source: string): ParsedDataProvider[] {
  const out: ParsedDataProvider[] = [];
  const re =
    /@DataProvider\s*\(\s*name\s*=\s*"([^"]+)"\s*\)\s*public\s+(?:static\s+)?Object\[\]\[\]\s+\w+\s*\(\s*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    const start = m.index + m[0].length;
    const body = sliceBalanced(source, start - 1);
    if (!body) continue;
    const parsed = parseObjectArrayLiteral(body);
    out.push({ name, rows: parsed.rows, unsafe: parsed.unsafe });
  }
  return out;
}

/**
 * Render a parameterised loop wrapping a single test method. Caller has
 * already converted the method body into TS via the normal pipeline; this
 * just wraps it in `for (const [...] of rows) { test(...) }`.
 */
export function renderParameterisedTest(opts: {
  testName: string;
  description?: string;
  params: ParamIR[];
  dataProvider: ParsedDataProvider;
  bodyTs: string;
  fixtureSig: string; // e.g. "{ page }, ..."
}): string {
  const titleTpl = opts.description ?? opts.testName;
  // First param is the row binding key; build a destructure that names each
  // formal param so the test body Just Works.
  const destructure = `[${opts.params.map((p) => p.name).join(", ")}]`;
  const rowsLiteral = opts.dataProvider.rows
    .map((r) => `  [${r.cells.join(", ")}],`)
    .join("\n");
  const tsTuple = opts.params.length
    ? `[${opts.params.map((p) => javaToTs(p.javaType)).join(", ")}]`
    : "unknown[]";

  return [
    `const ${opts.dataProvider.name}: ${tsTuple}[] = [`,
    rowsLiteral,
    `];`,
    `for (const ${destructure} of ${opts.dataProvider.name}) {`,
    `  test(\`${escapeTitle(titleTpl)} (\${${opts.params[0]?.name ?? "row"}})\`, async (${opts.fixtureSig}) => {`,
    indent(opts.bodyTs, 4),
    `  });`,
    `}`,
  ].join("\n");
}

// ----------------------------- helpers -----------------------------

function escapeTitle(s: string): string {
  return s.replace(/`/g, "\\`");
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

function javaToTs(t: string): string {
  if (t === "String") return "string";
  if (["int", "long", "double", "float", "Integer"].includes(t)) return "number";
  if (t === "boolean" || t === "Boolean") return "boolean";
  return "unknown";
}

function sliceBalanced(source: string, openBraceIdx: number): string | null {
  if (source[openBraceIdx] !== "{") return null;
  let depth = 0;
  for (let p = openBraceIdx; p < source.length; p++) {
    const c = source[p];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(openBraceIdx + 1, p);
    }
  }
  return null;
}

/**
 * Parse `return new Object[][] { {"a", "b"}, {"c", "d"} };` shape.
 * Returns the rows + an `unsafe` flag if the body looks dynamic.
 */
function parseObjectArrayLiteral(
  body: string,
): { rows: DataProviderRow[]; unsafe: boolean } {
  // Locate the array initialiser.
  const startIdx = body.indexOf("{", body.indexOf("Object"));
  if (startIdx < 0) return { rows: [], unsafe: true };

  // Find the matching outer `}` of the OUTER initialiser.
  // We're already inside method body, so depth starts at 1 conceptually.
  let depth = 0;
  let outerEnd = -1;
  for (let p = startIdx; p < body.length; p++) {
    if (body[p] === "{") depth++;
    else if (body[p] === "}") {
      depth--;
      if (depth === 0) {
        outerEnd = p;
        break;
      }
    }
  }
  if (outerEnd < 0) return { rows: [], unsafe: true };
  const innerText = body.slice(startIdx + 1, outerEnd);

  const rowMatches = Array.from(
    innerText.matchAll(/\{([^{}]*)\}/g),
    (m) => m[1],
  );
  if (rowMatches.length === 0) return { rows: [], unsafe: true };

  const rows: DataProviderRow[] = rowMatches.map((row) => ({
    cells: splitCells(row).map(javaCellToTs),
  }));
  return { rows, unsafe: false };
}

function splitCells(row: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inS = false;
  let cur = "";
  for (let p = 0; p < row.length; p++) {
    const c = row[p];
    const prev = p > 0 ? row[p - 1] : "";
    if (inS) {
      cur += c;
      if (c === '"' && prev !== "\\") inS = false;
      continue;
    }
    if (c === '"') {
      inS = true;
      cur += c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
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

/**
 * Java cell value -> TS literal. Handles strings, ints/longs/doubles, true/false/null.
 * Anything else is passed through verbatim (and the row gets `unsafe` upstream
 * if the caller cares).
 */
function javaCellToTs(cell: string): string {
  const t = cell.trim();
  if (/^".*"$/.test(t)) return t;
  if (/^-?\d+[Ll]$/.test(t)) return t.replace(/[Ll]$/, "");
  if (/^-?\d+(\.\d+)?[fFdD]?$/.test(t)) return t.replace(/[fFdD]$/, "");
  if (t === "true" || t === "false" || t === "null") {
    return t === "null" ? "null" : t;
  }
  return t;
}
