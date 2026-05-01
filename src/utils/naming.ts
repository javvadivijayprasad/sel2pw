/** PascalCase / camelCase / kebab-case helpers. */

/**
 * Java identifier → idiomatic JS camelCase.
 *
 *   LoginPage              -> loginPage
 *   CreateReferral_Link    -> createReferralLink
 *   CreateReferral_subsidiary_SelectBox  -> createReferralSubsidiarySelectBox
 *   submit_btn             -> submitBtn
 *   userInput              -> userInput  (already camelCase, untouched)
 *
 * Real-user codebases mix PascalCase + snake_Case + ALL_CAPS in field names
 * (the v0.11.1 production sample we saw uses `Foo_Bar_Baz` shapes
 * extensively). Without this, output emits `createReferral_Link: Locator`
 * — valid TS but ugly.
 */
export function toCamelCase(s: string): string {
  if (!s) return s;
  return (s.charAt(0).toLowerCase() + s.slice(1)).replace(
    /_+([A-Za-z])/g,
    (_, c: string) => c.toUpperCase(),
  );
}

export function toKebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function pageObjectFileName(className: string): string {
  // LoginPage          -> login.page.ts
  // LoginPages         -> login.page.ts
  // LoginPageObject    -> login.page.ts        (explicit POM suffix)
  // LoginPageObjects   -> login.page.ts        (plural form)
  // LoginScreen        -> login.page.ts        (mobile-style suffix)
  // LoginView          -> login.page.ts        (alt convention)
  // LoginSection / LoginComponent / LoginLocators / LoginElements stay as-is
  // because they describe sub-areas, not full pages.
  const stripped = toKebabCase(className).replace(
    /-(?:page-objects?|pages?|screens?|views?)$/,
    "",
  );
  return `${stripped}.page.ts`;
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
