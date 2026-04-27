import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs-extra";
import * as os from "os";
import { convert } from "../../src/index";

/**
 * Snapshot tests over the bundled sample project. Locks down the structural
 * shape of the emitted Playwright TypeScript so accidental regressions in
 * transformers or emitters fail loudly.
 *
 * To add new fixtures: drop a new `tests/fixtures/<name>/input/` directory
 * (Java sources) and run vitest with `-u` to update snapshots.
 */
describe("emitter snapshots — bundled sample", () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "sel2pw-snap-"));
    await convert({
      inputDir: path.resolve(__dirname, "../../examples/selenium-testng-sample"),
      outputDir,
    });
  });

  it("converts the expected files", async () => {
    const list = await listFiles(outputDir);
    // Order-stable
    // Phase 2 added tests/fixtures.ts (auto-emitted from BaseTest),
    // Phase 3 added MIGRATION_NOTES.md alongside the review report,
    // Phase 10.3 added conversion-result.json (structured stats writeback).
    expect(list.sort()).toEqual(
      [
        ".gitignore",
        "CONVERSION_REVIEW.md",
        "MIGRATION_NOTES.md",
        "README.md",
        "conversion-result.json",
        "package.json",
        "pages/home.page.ts",
        "pages/login.page.ts",
        "playwright.config.ts",
        "tests/fixtures.ts",
        "tests/login.spec.ts",
        "tsconfig.json",
      ].sort(),
    );
  });

  it("LoginPage TS matches snapshot", async () => {
    const src = await fs.readFile(path.join(outputDir, "pages/login.page.ts"), "utf8");
    expect(src).toMatchSnapshot();
  });

  it("HomePage TS matches snapshot", async () => {
    const src = await fs.readFile(path.join(outputDir, "pages/home.page.ts"), "utf8");
    expect(src).toMatchSnapshot();
  });

  it("LoginTest spec matches snapshot", async () => {
    const src = await fs.readFile(path.join(outputDir, "tests/login.spec.ts"), "utf8");
    expect(src).toMatchSnapshot();
  });

  it("CONVERSION_REVIEW.md mentions the generated fixture", async () => {
    // Phase 2 changed the BaseTest handling: instead of flagging it as a
    // manual review item we now auto-emit tests/fixtures.ts and surface an
    // info-severity note pointing the user at the import change.
    const src = await fs.readFile(path.join(outputDir, "CONVERSION_REVIEW.md"), "utf8");
    expect(src).toContain("fixtures.ts");
  });

  it("emits tests/fixtures.ts from BaseTest", async () => {
    const fixturePath = path.join(outputDir, "tests", "fixtures.ts");
    expect(await fs.pathExists(fixturePath)).toBe(true);
    const src = await fs.readFile(fixturePath, "utf8");
    expect(src).toContain("test as base");
    expect(src).toContain("base.extend");
  });
});

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const next = path.join(root, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await listFiles(next, rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}
