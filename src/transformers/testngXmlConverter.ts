import { ConvertedFile, ReviewItem } from "../types";

/**
 * `testng.xml` → playwright.config.ts `projects` converter.
 *
 * Maps the standard TestNG suite shape:
 *
 *   <suite name="Smoke" parallel="methods" thread-count="4">
 *     <test name="login-flows">
 *       <groups>
 *         <run><include name="smoke"/></run>
 *       </groups>
 *       <classes>
 *         <class name="com.example.tests.LoginTest"/>
 *       </classes>
 *     </test>
 *   </suite>
 *
 * to Playwright's `projects` array, with TestNG groups mapped to
 * playwright's `grep` regex (`@<group>` tag convention) so the existing
 * `// groups: smoke` comments emitted by the test class emitter are picked
 * up via Playwright's `--grep '@smoke'` workflow.
 *
 * The converter is xml-string-based to avoid a hard dependency on a real
 * XML parser — the testng.xml schema is small and stable.
 */

interface ParsedSuite {
  name: string;
  parallel?: string; // tests | methods | classes | instances | none
  threadCount?: number;
  groups: string[]; // include groups
  classes: string[];
}

export function convertTestngXml(xml: string): {
  converted: ConvertedFile;
  warnings: ReviewItem[];
  suiteCount: number;
} {
  const warnings: ReviewItem[] = [];
  const suites = parseSuites(xml);

  const projects = suites.map((s) => ({
    name: s.name,
    grep: groupsToGrep(s.groups),
    fullyParallel: s.parallel === "methods" || s.parallel === "tests",
    workers: s.threadCount,
  }));

  const lines: string[] = [];
  lines.push(`import { defineConfig, devices } from '@playwright/test';`);
  lines.push("");
  lines.push(`/**`);
  lines.push(
    ` * Generated from your testng.xml. Each <suite> becomes a Playwright`,
  );
  lines.push(` * project; <groups>/<run>/<include name="X"/> map to grep \`@X\`.`);
  lines.push(
    ` * To run just one suite:  npx playwright test --project="<suite-name>"`,
  );
  lines.push(` */`);
  lines.push(`export default defineConfig({`);
  lines.push(`  testDir: './tests',`);
  lines.push(`  fullyParallel: true,`);
  lines.push(`  reporter: [['html'], ['list']],`);
  lines.push(`  use: {`);
  lines.push(`    trace: 'on-first-retry',`);
  lines.push(`    screenshot: 'only-on-failure',`);
  lines.push(`  },`);
  lines.push(`  projects: [`);
  for (const p of projects) {
    lines.push(`    {`);
    lines.push(`      name: ${JSON.stringify(p.name)},`);
    if (p.grep) lines.push(`      grep: ${p.grep},`);
    if (p.fullyParallel !== undefined) {
      lines.push(`      fullyParallel: ${p.fullyParallel},`);
    }
    if (p.workers && p.workers > 0) {
      lines.push(`      // testng thread-count was ${p.workers}; tune via --workers`);
    }
    lines.push(`      use: { ...devices['Desktop Chrome'] },`);
    lines.push(`    },`);
  }
  lines.push(`  ],`);
  lines.push(`});`);
  lines.push("");

  if (suites.length === 0) {
    warnings.push({
      file: "testng.xml",
      severity: "warning",
      message:
        "No <suite> elements parsed from testng.xml — generated config has no projects. Verify your file is well-formed.",
    });
  }

  return {
    converted: {
      relPath: "playwright.config.ts",
      source: lines.join("\n"),
      warnings,
      kind: "config",
    },
    warnings,
    suiteCount: suites.length,
  };
}

function parseSuites(xml: string): ParsedSuite[] {
  const out: ParsedSuite[] = [];
  const suiteRe = /<suite\b([^>]*)>([\s\S]*?)<\/suite>/g;
  let sm: RegExpExecArray | null;
  while ((sm = suiteRe.exec(xml)) !== null) {
    const attrs = parseAttrs(sm[1]);
    const inner = sm[2];
    const groups = Array.from(
      inner.matchAll(/<include\s+name=['"]([^'"]+)['"]/g),
      (m) => m[1],
    );
    const classes = Array.from(
      inner.matchAll(/<class\s+name=['"]([^'"]+)['"]/g),
      (m) => m[1],
    );
    out.push({
      name: attrs["name"] ?? "default",
      parallel: attrs["parallel"],
      threadCount: attrs["thread-count"]
        ? parseInt(attrs["thread-count"], 10)
        : undefined,
      groups,
      classes,
    });
  }
  return out;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out[m[1]] = m[2];
  return out;
}

function groupsToGrep(groups: string[]): string | null {
  if (groups.length === 0) return null;
  // Playwright recommends test titles tagged like @smoke. Our test class
  // emitter writes a `// groups: smoke` comment; users typically promote
  // those into `@smoke` annotations on test titles. The grep matches either
  // form leniently.
  const escaped = groups.map((g) => g.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"));
  return `/(${escaped.join("|")})/`;
}
