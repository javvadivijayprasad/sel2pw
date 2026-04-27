import * as path from "path";
import * as fs from "fs-extra";
import { ConversionSummary } from "../types";

/**
 * Write CONVERSION_REVIEW.md — a markdown report grouping warnings by file
 * and severity so the user has a punch list of things to fix manually.
 */
export async function writeReviewReport(
  outDir: string,
  summary: ConversionSummary,
): Promise<string> {
  const reportPath = path.join(outDir, "CONVERSION_REVIEW.md");

  // Split warnings into per-file vs project-wide. The latter use a directory
  // path or an absent file name (e.g. the testng.xml or .properties converters
  // attribute their notes to the input dir, and tscValidate uses the output
  // dir). Grouping all of those under a single "Project-wide" heading reads
  // much better than letting directory names appear as if they were files.
  const projectWide = summary.warnings.filter((w) => isProjectWideFile(w.file));
  const perFile = summary.warnings.filter((w) => !isProjectWideFile(w.file));
  const grouped = groupBy(perFile, (w) => w.file);
  const order: ("manual" | "warning" | "info")[] = ["manual", "warning", "info"];

  const lines: string[] = [];
  lines.push("# Conversion Review");
  lines.push("");
  lines.push(`Source: \`${summary.inputDir}\``);
  lines.push(`Output: \`${summary.outputDir}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Files scanned: **${summary.filesScanned}**`);
  lines.push(`- Page Objects converted: **${summary.pageObjectsConverted}**`);
  lines.push(`- Test classes converted: **${summary.testClassesConverted}**`);
  lines.push(`- Test methods converted: **${summary.testMethodsConverted}**`);
  lines.push(`- Review items: **${summary.warnings.length}**`);
  lines.push(
    `  - manual: ${summary.warnings.filter((w) => w.severity === "manual").length}`,
  );
  lines.push(
    `  - warning: ${summary.warnings.filter((w) => w.severity === "warning").length}`,
  );
  lines.push(
    `  - info: ${summary.warnings.filter((w) => w.severity === "info").length}`,
  );
  lines.push("");
  lines.push("## Severity legend");
  lines.push("");
  lines.push("- **manual** — auto-conversion not possible; you must rewrite this section.");
  lines.push("- **warning** — converted but please double-check semantics.");
  lines.push("- **info** — heads-up about a non-trivial mapping (e.g. WebDriverWait removed).");
  lines.push("");
  lines.push("## Items by file");
  lines.push("");

  if (projectWide.length > 0) {
    lines.push(`### Project-wide`);
    lines.push("");
    lines.push("| Severity | Note |");
    lines.push("| --- | --- |");
    const items = projectWide.sort(
      (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
    );
    for (const item of items) {
      const note = item.message.replace(/\|/g, "\\|");
      lines.push(`| ${item.severity} | ${note} |`);
    }
    lines.push("");
  }

  if (Object.keys(grouped).length === 0 && projectWide.length === 0) {
    lines.push("_No review items — clean conversion._");
    lines.push("");
  } else if (Object.keys(grouped).length === 0) {
    // project-wide only — already rendered
  } else {
    for (const file of Object.keys(grouped).sort()) {
      lines.push(`### \`${path.basename(file)}\``);
      lines.push("");
      lines.push("| Severity | Line | Note |");
      lines.push("| --- | --- | --- |");
      const items = grouped[file].sort(
        (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
      );
      for (const item of items) {
        const note = item.message.replace(/\|/g, "\\|");
        lines.push(`| ${item.severity} | ${item.line ?? "-"} | ${note} |`);
      }
      lines.push("");
    }
  }

  lines.push("## Cheatsheet — Selenium → Playwright");
  lines.push("");
  lines.push("| Selenium / TestNG | Playwright TS |");
  lines.push("| --- | --- |");
  lines.push("| `driver.get(url)` | `await page.goto(url)` |");
  lines.push("| `driver.findElement(By.id(\"x\")).click()` | `await page.locator('#x').click()` |");
  lines.push("| `element.sendKeys(\"...\")` | `await locator.fill('...')` |");
  lines.push("| `element.getText()` | `await locator.innerText()` |");
  lines.push("| `Assert.assertEquals(a, b)` | `expect(a).toBe(b)` |");
  lines.push("| `@Test` | `test('...', async ({ page }) => { ... })` |");
  lines.push("| `@BeforeMethod` | `test.beforeEach(...)` |");
  lines.push("| `@DataProvider` | parameterised loop over rows |");
  lines.push("| `WebDriverWait.until(...)` | _removed — Playwright auto-waits_ |");
  lines.push("| `JavascriptExecutor.executeScript(js)` | `await page.evaluate(() => js)` |");
  lines.push("| `Actions(driver).moveToElement(el).perform()` | `await locator.hover()` |");
  lines.push("");

  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}

/**
 * Decide whether a review item's `file` field points at an actual source file
 * or at a directory / project-wide context. We treat anything without a known
 * source-file extension as project-wide. Source extensions: .java, .ts, .xml,
 * .properties, .feature.
 */
function isProjectWideFile(file: string): boolean {
  if (!file) return true;
  const base = file.split(/[\\/]/).pop() ?? "";
  if (!base.includes(".")) return true;
  return !/\.(java|ts|tsx|xml|properties|feature|md|json)$/i.test(base);
}

function groupBy<T, K extends string | number>(
  arr: T[],
  fn: (t: T) => K,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = String(fn(item));
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}
