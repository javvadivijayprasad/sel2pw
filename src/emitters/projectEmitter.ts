import * as path from "path";
import * as fs from "fs-extra";
import { ConvertedFile, ConversionSummary } from "../types";

/**
 * Write a complete Playwright project to `outDir`:
 *   - package.json, playwright.config.ts, tsconfig.json (from templates/)
 *   - .gitignore
 *   - pages/*.page.ts and tests/*.spec.ts (from converted files)
 *   - CONVERSION_REVIEW.md (written separately by the report module)
 */
export async function emitProject(
  outDir: string,
  files: ConvertedFile[],
  summary: ConversionSummary,
  templatesDir: string,
): Promise<void> {
  await fs.ensureDir(outDir);

  // Scaffolding files from templates.
  const tplFiles = [
    { tpl: "package.json.tmpl", out: "package.json" },
    { tpl: "playwright.config.ts.tmpl", out: "playwright.config.ts" },
    { tpl: "tsconfig.json.tmpl", out: "tsconfig.json" },
    { tpl: "gitignore.tmpl", out: ".gitignore" },
  ];

  for (const { tpl, out } of tplFiles) {
    const tplPath = path.join(templatesDir, tpl);
    if (!(await fs.pathExists(tplPath))) continue;
    const target = path.join(outDir, out);
    if (!(await fs.pathExists(target))) {
      await fs.copy(tplPath, target);
    }
  }

  // Converted source files.
  for (const f of files) {
    const target = path.join(outDir, f.relPath);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, f.source, "utf8");
  }

  // Helpful README inside the generated project.
  const readme = `# Generated Playwright Project

This project was generated from \`${summary.inputDir}\` by **sel2pw**.

## Setup

\`\`\`bash
npm install
npx playwright install
npx playwright test
\`\`\`

See \`CONVERSION_REVIEW.md\` for items that need manual cleanup before tests will run green.

## Stats

- Files scanned: ${summary.filesScanned}
- Page Objects converted: ${summary.pageObjectsConverted}
- Test classes converted: ${summary.testClassesConverted}
- Test methods converted: ${summary.testMethodsConverted}
- Review items: ${summary.warnings.length}
`;
  await fs.writeFile(path.join(outDir, "README.md"), readme, "utf8");
}
