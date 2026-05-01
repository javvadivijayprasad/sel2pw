import * as path from "path";
import * as fs from "fs-extra";
import { ConversionSummary } from "../types";

/**
 * Write `MIGRATION_NOTES.md` — the developer-facing migration handbook,
 * complementing CONVERSION_REVIEW.md. The review report is "what to fix
 * line-by-line"; this is "what to delete from pom.xml, what to install,
 * what changed in your CI". A separate file because reviewers and devops
 * often look at different things.
 */
export async function writeMigrationNotes(
  outputDir: string,
  inputDir: string,
  summary: ConversionSummary,
): Promise<string> {
  const target = path.join(outputDir, "MIGRATION_NOTES.md");
  const lines: string[] = [];
  lines.push(`# Migration Notes`);
  lines.push("");
  lines.push(`Source: \`${inputDir}\``);
  lines.push(`Output: \`${outputDir}\``);
  lines.push("");

  lines.push(`## Stats`);
  lines.push("");
  lines.push(`- Files scanned: **${summary.filesScanned}**`);
  lines.push(`- Page Objects converted: **${summary.pageObjectsConverted}**`);
  lines.push(`- Test classes converted: **${summary.testClassesConverted}**`);
  lines.push(`- Test methods converted: **${summary.testMethodsConverted}**`);
  lines.push("");

  lines.push(`## What to install in the new project`);
  lines.push("");
  lines.push(`\`\`\`bash`);
  lines.push(`npm install`);
  lines.push(`npx playwright install`);
  lines.push(`\`\`\``);
  lines.push("");

  lines.push(`## What you can delete from your old project`);
  lines.push("");
  lines.push(`Once the converted suite is green, the following Maven dependencies are no longer needed:`);
  lines.push("");
  lines.push(`- \`org.seleniumhq.selenium:selenium-java\``);
  lines.push(`- \`org.testng:testng\``);
  lines.push(`- \`io.cucumber:cucumber-java\` (if you used Cucumber)`);
  lines.push(`- \`org.hamcrest:hamcrest\` (assertions handled by \`expect()\`)`);
  lines.push(`- \`io.github.bonigarcia:webdrivermanager\` (Playwright manages browsers itself)`);
  lines.push("");
  lines.push(`The old \`pom.xml\` and \`testng.xml\` can be archived once you verify the Playwright suite covers the same behaviour.`);
  lines.push("");

  lines.push(`## What changed in your test runtime`);
  lines.push("");
  lines.push(
    `- **Auto-waits.** Playwright auto-waits on locators before acting; explicit \`WebDriverWait\` and \`ExpectedConditions\` were removed throughout. Every \`locator.click()\` / \`.fill()\` / \`.innerText()\` waits up to \`actionTimeout\` (default 30s) for the element to become attached, visible, stable, and able to receive events. You almost never need to write a wait yourself for an element-action.`,
  );
  lines.push(
    `- **\`Thread.sleep\` was kept (mapped to \`page.waitForTimeout\`) but flagged with TODO markers.** Each one is a Selenium-era hack that often becomes redundant under Playwright's auto-waits. Search the converted output for \`TODO(sel2pw)\` near \`waitForTimeout\` calls and verify whether each one is still needed — most can be removed without changing behavior, and tests run faster afterward.`,
  );
  lines.push(
    `- **Real conditional waits** (URL changes, network responses, custom predicates) — use \`await page.waitForURL(...)\`, \`await page.waitForResponse(...)\`, or \`await page.waitForFunction(() => ...)\` rather than \`Thread.sleep\`.`,
  );
  lines.push(
    `- **Implicit waits** (\`driver.manage().timeouts().implicitlyWait(...)\`) were removed — set \`use.actionTimeout\` and \`use.navigationTimeout\` in \`playwright.config.ts\` instead.`,
  );
  lines.push(
    `- **Async everywhere.** Every action is \`await\`ed. Page Object methods return \`Promise<T>\`.`,
  );
  lines.push(
    `- **Browser management.** Configured via \`playwright.config.ts → projects\`. Use \`BASE_URL\` env to point at staging vs prod.`,
  );
  lines.push(
    `- **Parallelism.** \`fullyParallel: true\` by default. \`testng.xml\`'s thread-count was preserved as a comment in the generated config.`,
  );
  lines.push(
    `- **Reporting.** HTML reporter emits to \`playwright-report/\`; run \`npm run report\` to view.`,
  );
  lines.push("");

  lines.push(`## CI changes`);
  lines.push("");
  lines.push(`Replace your Maven test stage:`);
  lines.push("");
  lines.push("```yaml");
  lines.push(`# before`);
  lines.push(`- run: mvn test`);
  lines.push("");
  lines.push(`# after`);
  lines.push(`- run: npm ci`);
  lines.push(`- run: npx playwright install --with-deps`);
  lines.push(`- run: npx playwright test`);
  lines.push("```");
  lines.push("");

  lines.push(`## Verifying behavioural parity`);
  lines.push("");
  lines.push(
    `The recommended approach: run *both* suites against the same staging environment for one or two sprints. Watch for tests that pass in Selenium but fail in Playwright (or vice versa). Common causes:`,
  );
  lines.push("");
  lines.push(
    `- Implicit waits in Selenium that masked race conditions — Playwright's stricter timing exposes them.`,
  );
  lines.push(
    `- \`getText()\` returning visible text in Playwright vs full text content in Selenium — use \`textContent()\` if you need the latter.`,
  );
  lines.push(
    `- Locator semantics: \`By.linkText\` is fuzzy in Selenium; we mapped it to \`getByRole('link', { name })\` which is stricter.`,
  );
  lines.push("");

  lines.push(`## See also`);
  lines.push("");
  lines.push(`- [\`CONVERSION_REVIEW.md\`](./CONVERSION_REVIEW.md) — line-level review punch list.`);
  lines.push(`- [\`README.md\`](./README.md) — how to run and configure the project.`);
  lines.push(`- Playwright docs: <https://playwright.dev/docs/intro>`);
  lines.push("");

  await fs.writeFile(target, lines.join("\n"), "utf8");
  return target;
}
