/** PascalCase / camelCase / kebab-case helpers. */

export function toCamelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function toKebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function pageObjectFileName(className: string): string {
  // LoginPage -> login.page.ts; LoginPages -> login.page.ts
  return `${toKebabCase(className).replace(/-pages?$/, "")}.page.ts`;
}

export function testFileName(className: string): string {
  // LoginTest -> login.spec.ts; LoginTests -> login.spec.ts; LoginTestCase -> login.spec.ts
  return `${toKebabCase(className).replace(/-tests?(?:-?case)?$/, "")}.spec.ts`;
}

export function packageToDir(packageName: string): string {
  return packageName.split(".").join("/");
}

/** Map a Java type name to a TS type name (best effort). */
export function javaTypeToTs(javaType: string): string {
  const t = javaType.trim();
  if (!t) return "void";
  if (t === "void") return "void";
  if (t === "String") return "string";
  if (t === "int" || t === "long" || t === "short" || t === "double" || t === "float" || t === "Integer" || t === "Long" || t === "Double") {
    return "number";
  }
  if (t === "boolean" || t === "Boolean") return "boolean";
  if (t === "Object") return "unknown";
  if (/^List<(.+)>$/.test(t)) {
    const inner = t.match(/^List<(.+)>$/)![1];
    return `${javaTypeToTs(inner)}[]`;
  }
  if (/^Map<([^,]+),\s*(.+)>$/.test(t)) {
    const [, k, v] = t.match(/^Map<([^,]+),\s*(.+)>$/)!;
    return `Record<${javaTypeToTs(k)}, ${javaTypeToTs(v)}>`;
  }
  return t; // user-defined class names pass through unchanged
}
