import { test as base, expect } from '@playwright/test';

/**
 * Auto-generated from BaseTest.java by sel2pw.
 * Replaces the legacy BaseTest superclass pattern with a Playwright
 * fixture extension. Tests should `import { test } from '../fixtures'`
 * instead of `from '@playwright/test'` to inherit shared setup.
 */
// [MANUAL EDIT #1 — remove stray closing brace]
// sel2pw's baseTestExtractor left a dead `}` from the Java
// `if (driver != null) driver.quit();` block (the if-body was stripped,
// but its closing brace slipped through). One-line hand fix; will be
// patched as v2.0.9 (see bodyTransformer's stripJavaDriverBoilerplate).
export const test = base.extend<{}>({
  page: async ({ page }, use) => {
    // ----- before each test -----
    await use(page);
    // ----- after each test -----
    // driver.quit() — handled by Playwright fixture
  },
});

export { expect };
