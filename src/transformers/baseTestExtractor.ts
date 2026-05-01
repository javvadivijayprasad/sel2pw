import * as path from "path";
import { ConvertedFile, JavaFile, ReviewItem } from "../types";
import { transformMethodBody } from "./bodyTransformer";
import { dedentAndIndent } from "../utils/indent";

/**
 * BaseTest superclass → Playwright fixture file generator.
 *
 * Common Java pattern:
 *   public class BaseTest {
 *     protected WebDriver driver;
 *     @BeforeMethod public void setUp() {
 *       driver = new ChromeDriver();
 *       driver.manage().window().maximize();
 *     }
 *     @AfterMethod public void tearDown() { driver.quit(); }
 *   }
 *
 * In Playwright the right place for shared setup is a fixture extension —
 * https://playwright.dev/docs/test-fixtures. We emit `tests/fixtures.ts`
 * with the converted before/after bodies wrapped in a custom `test`
 * export. Test classes that extended BaseTest then `import { test } from
 * '../fixtures'` instead of `from '@playwright/test'`.
 *
 * The transform handles the common "WebDriver creation" boilerplate by
 * detecting and stripping it (Playwright fixtures already provide `page`).
 */

export interface BaseTestEmitOptions {
  /** Optional override for the fixture export class name. */
  exportName?: string;
}

export function isBaseTest(file: JavaFile): boolean {
  return file.kind === "base";
}

interface ExtractedHook {
  kind: "before" | "after";
  body: string;
}

export function emitFixture(
  baseTestFile: JavaFile,
  _opts: BaseTestEmitOptions = {},
): { converted: ConvertedFile; hadDriverCreation: boolean } {
  const warnings: ReviewItem[] = [];
  const hooks = extractLifecycleHooks(baseTestFile.source);
  const hadDriverCreation = hooks.some((h) =>
    /\bnew\s+(?:Chrome|Firefox|Edge|Safari)Driver\b/.test(h.body),
  );

  const beforeHooks = hooks.filter((h) => h.kind === "before");
  const afterHooks = hooks.filter((h) => h.kind === "after");

  const lines: string[] = [];
  lines.push(`import { test as base, expect } from '@playwright/test';`);
  lines.push("");
  lines.push(
    `/**`,
  );
  lines.push(
    ` * Auto-generated from ${path.basename(baseTestFile.path)} by sel2pw.`,
  );
  lines.push(
    ` * Replaces the legacy BaseTest superclass pattern with a Playwright`,
  );
  lines.push(
    ` * fixture extension. Tests should \`import { test } from '../fixtures'\``,
  );
  lines.push(` * instead of \`from '@playwright/test'\` to inherit shared setup.`,
  );
  lines.push(` */`);
  lines.push(`export const test = base.extend<{}>({`);
  lines.push(`  page: async ({ page }, use) => {`);

  // Run all "before" bodies (minus the driver-creation lines, which are
  // handled by Playwright's page fixture).
  if (beforeHooks.length) {
    lines.push(`    // ----- before each test -----`);
    for (const h of beforeHooks) {
      const { body, warnings: bw } = transformMethodBody(
        stripDriverBoilerplate(h.body),
        baseTestFile.path,
      );
      warnings.push(...bw);
      const dent = dedentAndIndent(body, "    ");
      if (dent.trim()) lines.push(dent);
    }
  }

  lines.push(`    await use(page);`);

  if (afterHooks.length) {
    lines.push(`    // ----- after each test -----`);
    for (const h of afterHooks) {
      const { body, warnings: bw } = transformMethodBody(
        stripDriverBoilerplate(h.body),
        baseTestFile.path,
      );
      warnings.push(...bw);
      const dent = dedentAndIndent(body, "    ");
      if (dent.trim()) lines.push(dent);
    }
  }

  lines.push(`  },`);
  lines.push(`});`);
  lines.push("");
  lines.push(`export { expect };`);
  lines.push("");

  if (hadDriverCreation) {
    warnings.push({
      file: baseTestFile.path,
      severity: "info",
      message:
        "Stripped WebDriver creation (`new ChromeDriver()` etc.) — Playwright fixtures provide `page` directly. If you need a non-Chromium browser, configure it in playwright.config.ts → projects.",
    });
  }

  return {
    converted: {
      relPath: "tests/fixtures.ts",
      source: lines.join("\n"),
      warnings,
      kind: "base",
    },
    hadDriverCreation,
  };
}

function stripDriverBoilerplate(body: string): string {
  // After all the line-level filters below, do one final pass to rewrite
  // bare `driver` identifier references to `page` — the Playwright fixture
  // doesn't expose a `driver` variable, but BaseTest bodies frequently use
  // `someHelper(driver)` / `driver.executeScript(...)` / `driver.something`
  // patterns that the apiMap rules don't cover. v0.11.3.
  const filtered = body
    .split("\n")
    .filter((line) => {
      const t = line.trim();

      // Driver instantiation
      if (/^driver\s*=\s*new\s+(Chrome|Firefox|Edge|Safari|Remote|InternetExplorer)Driver/.test(t)) return false;
      if (/^WebDriver\s+driver\s*=/.test(t)) return false;
      if (/^driver\s*=\s*new\s+\w+Driver\s*\(/.test(t)) return false;

      // Window management
      if (/^driver\.manage\(\)\.window\(\)\.maximize\(\)/.test(t)) return false;
      if (/^driver\.manage\(\)\.window\(\)\.setSize\b/.test(t)) return false;
      if (/^driver\.manage\(\)\.window\(\)\.setPosition\b/.test(t)) return false;

      // Cookie / timeout / log management
      if (/^driver\.manage\(\)\.deleteAllCookies\b/.test(t)) return false;
      if (/^driver\.manage\(\)\.timeouts\(\)\./.test(t)) return false;
      if (/^driver\.manage\(\)\.logs\(\)\./.test(t)) return false;

      // null-guards around driver
      if (/^if\s*\(\s*driver\s*!=\s*null\s*\)/.test(t)) return false;
      if (/^if\s*\(\s*driver\s*==\s*null\s*\)/.test(t)) return false;

      // WebDriverWait setup (added in v0.11.3 — Playwright auto-waits make
      // this entirely unnecessary; let it leak and the converted fixture
      // has dead Java code). v0.11.3 Patch Q: also covers `const wait = ...`
      // / `let wait = ...` / `var wait = ...` declarations (post-Java→TS
      // const-conversion form).
      if (/^WebDriverWait\s+\w+\s*=/.test(t)) return false;
      if (/^(?:const|let|var|final)\s+\w+\s*=\s*new\s+WebDriverWait\s*\(/.test(t)) return false;
      if (/^\w+\s*=\s*new\s+WebDriverWait\s*\(/.test(t)) return false;
      if (/^FluentWait\s+\w+\s*=/.test(t)) return false;
      if (/^(?:const|let|var|final)\s+\w+\s*=\s*new\s+FluentWait\s*\(/.test(t)) return false;
      if (/^\w+\s*=\s*new\s+FluentWait\s*\(/.test(t)) return false;

      // Browser options / capabilities setup (Selenium-only — Playwright
      // configures these in playwright.config.ts → projects → use)
      if (/^(?:Chrome|Firefox|Edge|Safari)Options\s+\w+\s*=/.test(t)) return false;
      if (/^\w+\s*=\s*new\s+(?:Chrome|Firefox|Edge|Safari)Options\b/.test(t)) return false;
      if (/^DesiredCapabilities\s+\w+\s*=/.test(t)) return false;
      if (/^\w+\.addArguments?\s*\(/.test(t)) return false;
      if (/^\w+\.setCapability\s*\(/.test(t)) return false;
      if (/^\w+\.setExperimentalOption\s*\(/.test(t)) return false;
      if (/^\w+\.merge\s*\(\s*\w*[Cc]apabilit/.test(t)) return false;

      // WebDriverManager setup (the bonigarcia bootstrap library)
      if (/^WebDriverManager\.\w+\s*\(\s*\)\.setup\s*\(/.test(t)) return false;

      // System.setProperty for driver paths (predates WebDriverManager)
      if (/^System\.setProperty\s*\(\s*"webdriver\.\w+\.driver"/.test(t)) return false;

      // Keep `driver.quit();` — it gets rewritten to a no-op by apiMap.
      return true;
    })
    .join("\n");

  // Bare `driver` identifier → `page`. The negative lookahead/behind keep
  // us from rewriting `driver.something` (apiMap handles that surface) or
  // identifiers like `myDriver` / `driverPool`.
  return filtered.replace(/\bdriver\b(?!\s*\.)/g, "page");
}

function extractLifecycleHooks(source: string): ExtractedHook[] {
  const out: ExtractedHook[] = [];
  // Permissive: skip *anything* between the @Before/@After annotation and
  // the opening `{`. The previous tighter pattern explicitly modelled the
  // method signature (`\([^)]*\)`), which broke on parameter-level
  // annotations like `@Optional("chrome") String browser` — the inner
  // `("chrome")` parens prematurely closed the outer params group, the
  // signature didn't match, and the whole BaseTest emitter produced no
  // output. selenium12/13/14 surfaced this — fix in 0.10.4.
  //
  // Caveat: an `{` inside an annotation default value (e.g.
  // `@Optional({"a", "b"})`) would be interpreted as the body opener.
  // Vanishingly rare in @BeforeMethod / @AfterMethod context — accept as
  // a known edge case.
  const re = /@(Before|After)(Suite|Class|Method|Test)\b[^{]*?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const kind: "before" | "after" =
      m[1].toLowerCase() === "before" ? "before" : "after";
    const bodyStart = m.index + m[0].length - 1;
    const body = readBracedBody(source, bodyStart);
    if (body) out.push({ kind, body });
  }
  return out;
}

function readBracedBody(source: string, bodyStart: number): string | null {
  if (source[bodyStart] !== "{") return null;
  let depth = 0;
  for (let p = bodyStart; p < source.length; p++) {
    const c = source[p];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyStart + 1, p);
    }
  }
  return null;
}
