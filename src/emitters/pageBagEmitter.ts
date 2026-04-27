import { ConvertedFile } from "../types";

/**
 * Page-bag (factory) style: a single `pages/index.ts` exposes all page
 * objects through one entry point so tests use `pages.login.x()` instead of
 * `new LoginPage(page)` in every beforeEach. Opt-in via `--pom-style=factory`.
 *
 * Output:
 *
 *   // pages/index.ts
 *   import { Page } from '@playwright/test';
 *   import { LoginPage } from './login.page';
 *   import { HomePage } from './home.page';
 *
 *   export interface Pages { login: LoginPage; home: HomePage; }
 *   export function makePages(page: Page): Pages {
 *     return { login: new LoginPage(page), home: new HomePage(page) };
 *   }
 *
 *   // tests/_fixtures/pages.fixture.ts (auto-merged with tests/fixtures.ts when present)
 *   import { test as base } from '@playwright/test';
 *   import { makePages, Pages } from '../../pages';
 *   export const test = base.extend<{ pages: Pages }>({
 *     pages: async ({ page }, use) => { await use(makePages(page)); },
 *   });
 */

export function emitPageBag(pageClassNames: string[]): ConvertedFile[] {
  if (pageClassNames.length === 0) return [];

  const indexLines: string[] = [];
  indexLines.push(`import { Page } from '@playwright/test';`);
  for (const cls of pageClassNames) {
    indexLines.push(`import { ${cls} } from './${importStem(cls)}';`);
  }
  indexLines.push("");
  indexLines.push("export interface Pages {");
  for (const cls of pageClassNames) {
    indexLines.push(`  ${camel(cls.replace(/Page$/, ""))}: ${cls};`);
  }
  indexLines.push("}");
  indexLines.push("");
  indexLines.push("export function makePages(page: Page): Pages {");
  indexLines.push("  return {");
  for (const cls of pageClassNames) {
    indexLines.push(`    ${camel(cls.replace(/Page$/, ""))}: new ${cls}(page),`);
  }
  indexLines.push("  };");
  indexLines.push("}");
  indexLines.push("");

  const fixtureLines: string[] = [
    `import { test as base } from '@playwright/test';`,
    `import { makePages, Pages } from '../pages';`,
    ``,
    `/**`,
    ` * Adds a typed \`pages\` fixture, e.g. \`async ({ pages }) => pages.login.open(...)\`.`,
    ` * Used when sel2pw is run with --pom-style=factory.`,
    ` */`,
    `export const test = base.extend<{ pages: Pages }>({`,
    `  pages: async ({ page }, use) => {`,
    `    await use(makePages(page));`,
    `  },`,
    `});`,
    `export { expect } from '@playwright/test';`,
    ``,
  ];

  return [
    {
      relPath: "pages/index.ts",
      source: indexLines.join("\n"),
      warnings: [],
      kind: "page-object",
    },
    {
      relPath: "tests/fixtures.pages.ts",
      source: fixtureLines.join("\n"),
      warnings: [],
      kind: "base",
    },
  ];
}

function camel(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function importStem(cls: string): string {
  return cls
    .replace(/Page$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .concat(".page");
}
