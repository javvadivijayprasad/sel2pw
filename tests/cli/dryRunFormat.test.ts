import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const inputDir = path.join(repoRoot, "examples/selenium-testng-sample");
const tempRoot = mkdtempSync(path.join(tmpdir(), "sel2pw-dryrun-json-"));

afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

function cli(args: string[], beforeInput: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      "-r",
      "ts-node/register/transpile-only",
      "src/cli.ts",
      "convert",
      ...beforeInput,
      inputDir,
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, LOG_LEVEL: "info" },
    },
  );
}

describe("convert --dry-run output formats", () => {
  it("prints only valid conversion-result JSON and creates no output files", () => {
    const outputDir = path.join(tempRoot, "json-preview");
    const run = cli(["--out", outputDir, "--dry-run", "--format=json"]);

    expect(run.status).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.schema).toBe("sel2pw.conversion-result.v1");
    expect(result.files).toEqual(expect.any(Array));
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.projectNotes).toEqual(expect.any(Array));
    expect(result.stats.filesScanned).toBeGreaterThan(0);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("keeps Markdown preview as the default", () => {
    const outputDir = path.join(tempRoot, "markdown-preview");
    const run = cli(["--out", outputDir, "--dry-run"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("─── Preview: would emit ───");
    expect(run.stdout).toContain("# File Mapping");
    expect(existsSync(outputDir)).toBe(false);
  });

  it("preserves the existing bare --format Prettier flag", () => {
    const outputDir = path.join(tempRoot, "legacy-format");
    const run = cli(["--out", outputDir, "--dry-run", "--format"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("# File Mapping");
    expect(existsSync(outputDir)).toBe(false);
  });

  it("does not swallow the positional input when bare --format comes first", () => {
    const outputDir = path.join(tempRoot, "legacy-format-before-input");
    const run = cli(["--out", outputDir, "--dry-run"], ["--format"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("# File Mapping");
    expect(existsSync(outputDir)).toBe(false);
  });

  it("accepts an explicit Markdown preview format", () => {
    const outputDir = path.join(tempRoot, "explicit-markdown");
    const run = cli(["--out", outputDir, "--dry-run", "--format=markdown"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("# File Mapping");
    expect(existsSync(outputDir)).toBe(false);
  });

  it("rejects a JSON output format outside dry-run mode", () => {
    const outputDir = path.join(tempRoot, "non-dry-run");
    const run = cli(["--out", outputDir, "--format=json"]);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("--format=json requires --dry-run");
    expect(existsSync(outputDir)).toBe(false);
  });

  it("matches the files and notes in the regular conversion-result.json", () => {
    const outputDir = path.join(tempRoot, "regular-conversion");
    const regular = cli(["--out", outputDir]);
    const preview = cli(["--out", outputDir, "--dry-run", "--format=json"]);

    expect(regular.status).toBe(0);
    expect(preview.status).toBe(0);
    const saved = JSON.parse(
      readFileSync(path.join(outputDir, "conversion-result.json"), "utf8"),
    );
    const dryRun = JSON.parse(preview.stdout);
    // The existing converter can choose different output paths for source
    // classes sharing a filename stem (e.g. LoginPage and LoginTest) across
    // separate runs. Compare the stable report fields here; this feature
    // intentionally reuses the same report builder, not its naming logic.
    const stableFields = (file: Record<string, unknown>) => {
      const { output: _output, ...rest } = file;
      return rest;
    };
    expect(dryRun.files.map(stableFields)).toEqual(saved.files.map(stableFields));
    expect(dryRun.projectNotes).toEqual(saved.projectNotes);
    expect(dryRun.stats).toEqual(saved.stats);
  });
});
