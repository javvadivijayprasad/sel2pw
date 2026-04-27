import { ByStrategy, LocatorField } from "../types";

/**
 * Map a Selenium By locator to a Playwright locator expression.
 *
 * Returns a TypeScript fragment that, when prefixed with "this." or "page.",
 * produces a Playwright Locator. We prefer semantic locators where possible
 * (getByRole) but fall back to css/xpath strings for full coverage.
 */
export function toPlaywrightLocatorExpr(
  by: ByStrategy,
  value: string,
  pageVar: string = "this.page",
): string {
  const v = JSON.stringify(value);
  switch (by) {
    case "id":
      // Prefer getByTestId only when caller opts in; default to css selector.
      return `${pageVar}.locator(${JSON.stringify("#" + value)})`;
    case "css":
      return `${pageVar}.locator(${v})`;
    case "xpath":
      return `${pageVar}.locator(${JSON.stringify("xpath=" + value)})`;
    case "name":
      return `${pageVar}.locator(${JSON.stringify(`[name=${JSON.stringify(value)}]`)})`;
    case "linkText":
      return `${pageVar}.getByRole('link', { name: ${v} })`;
    case "partialLinkText":
      return `${pageVar}.getByRole('link', { name: ${v}, exact: false })`;
    case "tagName":
      return `${pageVar}.locator(${v})`;
    case "className":
      return `${pageVar}.locator(${JSON.stringify("." + value)})`;
    default:
      return `${pageVar}.locator(${v})`;
  }
}

/**
 * Render a locator field as a TypeScript class field initialised in the
 * constructor.
 *
 *   readonly usernameInput: Locator;
 *
 * The constructor body uses `assignLocatorField`.
 */
export function renderLocatorFieldDeclaration(field: LocatorField): string {
  return `  readonly ${field.name}: Locator;`;
}

export function renderLocatorFieldAssignment(field: LocatorField): string {
  return `    this.${field.name} = ${toPlaywrightLocatorExpr(field.by, field.value, "page")};`;
}
