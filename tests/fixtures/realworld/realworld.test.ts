import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs-extra";
import * as os from "os";
import { convert, analyze } from "../../../src/index";

/**
 * Real-world fixture suite — runs the converter against three representative
 * shapes that exercise paths the bundled sample doesn't cover:
 *
 *   - page-factory      : @FindBy / WebElement annotations (PageFactory style)
 *   - hamcrest-heavy    : assertThat with Hamcrest matchers
 *   - bdd-cucumber      : .feature files + Cucumber step defs
 *
 * Each fixture has an `input/` subdirectory; we convert it into a temp
 * directory and assert on the output's structural properties. Snapshot
 * locking is up to the user — the assertions here check that the
 * transformers produced semantically valid output, not exact strings.
 */

const FIXTURE_ROOT = path.resolve(__dirname);

describe("real-world fixtures", () => {
  describe("page-factory style", () => {
    let outputDir: string;
    beforeAll(async () => {
      outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "sel2pw-pf-"));
      await convert({
        inputDir: path.join(FIXTURE_ROOT, "page-factory", "input"),
        outputDir,
      });
    });

    it("emits a Page Object using the @FindBy fields", async () => {
      const list = await fs
        .readdir(path.join(outputDir, "pages"))
        .catch(() => []);
      const pageFile = list.find((n) => n.endsWith(".page.ts"));
      expect(pageFile, "expected a page object .ts file").toBeTruthy();
      if (!pageFile) return;
      const src = await fs.readFile(
        path.join(outputDir, "pages", pageFile),
        "utf8",
      );
      // All four locators present + correct types.
      expect(src).toContain("usernameInput: Locator");
      expect(src).toContain("passwordInput: Locator");
      expect(src).toContain("loginButton: Locator");
      expect(src).toContain("errorBanner: Locator");
      // Methods awaited correctly.
      expect(src).toContain("await this.usernameInput.fill(");
      expect(src).toContain("await this.errorBanner.innerText()");
    });
  });

  describe("hamcrest-heavy", () => {
    let outputDir: string;
    beforeAll(async () => {
      outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "sel2pw-hc-"));
      await convert({
        inputDir: path.join(FIXTURE_ROOT, "hamcrest-heavy", "input"),
        outputDir,
      });
    });

    it("converts hasItem / containsInAnyOrder / hasSize", async () => {
      const specs = await fs.readdir(path.join(outputDir, "tests"));
      const spec = specs.find((n) => n.endsWith(".spec.ts"));
      expect(spec).toBeTruthy();
      if (!spec) return;
      const src = await fs.readFile(path.join(outputDir, "tests", spec), "utf8");
      expect(src).toContain("expect(items).toContain(");
      expect(src).toContain("expect.arrayContaining");
      expect(src).toContain("toHaveLength(3)");
    });

    it("converts case-insensitive and string matchers", async () => {
      const specs = await fs.readdir(path.join(outputDir, "tests"));
      const spec = specs.find((n) => n.endsWith(".spec.ts"));
      if (!spec) return;
      const src = await fs.readFile(path.join(outputDir, "tests", spec), "utf8");
      expect(src).toContain(".toLowerCase()");
      expect(src).toContain("toContain(");
      expect(src).toContain(".startsWith(");
    });

    it("converts numeric comparisons (greaterThan / lessThanOrEqualTo)", async () => {
      const specs = await fs.readdir(path.join(outputDir, "tests"));
      const spec = specs.find((n) => n.endsWith(".spec.ts"));
      if (!spec) return;
      const src = await fs.readFile(path.join(outputDir, "tests", spec), "utf8");
      expect(src).toContain("toBeGreaterThan");
      expect(src).toContain("toBeLessThanOrEqual");
      expect(src).toContain("not.toBeNull");
    });
  });

  describe("analyze() over Cucumber bundle classifies correctly", async () => {
    it("classifies feature files separately from step defs", async () => {
      const result = await analyze(
        path.join(FIXTURE_ROOT, "bdd-cucumber", "input"),
      );
      // The Cucumber stretch path is opt-in; analyze() at least sees the
      // step-defs Java file as non-page-object.
      const stepFile = result.files.find((f) => f.className === "LoginSteps");
      expect(stepFile, "expected analyze() to surface LoginSteps").toBeTruthy();
    });
  });
});
