/**
 * Split a comma-separated string at commas that are at bracket depth 0.
 *
 * Java method parameter lists routinely contain generic types like
 * `Hashtable<String, String> data` where a naive `split(",")` produces
 * `["Hashtable<String", "String> data"]` — and downstream formatters
 * then emit `Hashtable<String: unknown, data: String>`, generating
 * hundreds of TS1005 errors per converted project.
 *
 * `splitTopLevel` walks the string and tracks `<>`, `()`, `[]` nesting,
 * only treating a comma as a separator when depth === 0.
 *
 * Examples:
 *   splitTopLevel("a, b, c")                             // ["a", "b", "c"]
 *   splitTopLevel("Hashtable<String, String> data")      // ["Hashtable<String, String> data"]
 *   splitTopLevel("Map<K, V> m, List<String> l")         // ["Map<K, V> m", "List<String> l"]
 *   splitTopLevel("foo<bar<baz, qux>, quux>, r")         // ["foo<bar<baz, qux>, quux>", "r"]
 */
export function splitTopLevel(s: string, sep: string = ","): string[] {
  if (sep.length !== 1) {
    throw new Error("splitTopLevel: separator must be a single character");
  }
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ">" || ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0) depth--;
    } else if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}
