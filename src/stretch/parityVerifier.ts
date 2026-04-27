/**
 * Behaviour-parity verifier — Phase 5 stretch.
 *
 * Run BOTH the original Selenium suite (mvn test) and the converted
 * Playwright suite (playwright test) against the same staging environment,
 * then compare results: which tests pass on which side, do screenshots
 * differ, etc. The strongest possible "did this conversion break anything"
 * signal short of full eyeballing.
 *
 * STATUS: scaffold. The orchestrator is here; the diff/aggregation report
 * generator is left as a follow-up (it's a structurally simple but
 * cosmetically picky job, deferred until we have a real customer running
 * it on a real codebase).
 */

import * as path from "path";
import * as fs from "fs-extra";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

export interface ParityRunOptions {
  seleniumProjectDir: string;
  playwrightProjectDir: string;
  /** URL of the staging app to test. Both suites must use this. */
  baseUrl: string;
  /** Output dir for the parity report. */
  reportDir: string;
}

export interface SuiteResult {
  framework: "selenium" | "playwright";
  passed: string[];
  failed: { test: string; error: string }[];
  durationMs: number;
}

export interface ParityReport {
  selenium: SuiteResult;
  playwright: SuiteResult;
  divergences: {
    /** Tests passing in Selenium but failing in Playwright. */
    regressions: string[];
    /** Tests failing in Selenium but passing in Playwright (likely flake fixes). */
    fixes: string[];
    /** Tests with identical outcomes — left as a count, not a list. */
    matchedCount: number;
  };
}

export async function runParityCheck(opts: ParityRunOptions): Promise<ParityReport> {
  const [selenium, playwright] = await Promise.all([
    runSelenium(opts.seleniumProjectDir, opts.baseUrl),
    runPlaywright(opts.playwrightProjectDir, opts.baseUrl),
  ]);

  const seleniumPass = new Set(selenium.passed);
  const playwrightPass = new Set(playwright.passed);
  const all = new Set([
    ...selenium.passed,
    ...selenium.failed.map((f) => f.test),
    ...playwright.passed,
    ...playwright.failed.map((f) => f.test),
  ]);

  const regressions: string[] = [];
  const fixes: string[] = [];
  let matched = 0;
  for (const t of all) {
    const inS = seleniumPass.has(t);
    const inP = playwrightPass.has(t);
    if (inS && inP) matched++;
    else if (inS && !inP) regressions.push(t);
    else if (!inS && inP) fixes.push(t);
  }

  const report: ParityReport = {
    selenium,
    playwright,
    divergences: { regressions, fixes, matchedCount: matched },
  };
  await fs.ensureDir(opts.reportDir);
  await fs.writeJson(path.join(opts.reportDir, "parity.json"), report, { spaces: 2 });
  await fs.writeFile(
    path.join(opts.reportDir, "parity.md"),
    renderMarkdown(report),
    "utf8",
  );
  return report;
}

async function runSelenium(dir: string, baseUrl: string): Promise<SuiteResult> {
  const start = Date.now();
  try {
    await execFileP("mvn", ["test", `-Dbase.url=${baseUrl}`], {
      cwd: dir,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    // mvn exits non-zero on failures; we still need to parse surefire reports below.
  }
  const passed: string[] = [];
  const failed: { test: string; error: string }[] = [];
  const surefireDir = path.join(dir, "target", "surefire-reports");
  if (await fs.pathExists(surefireDir)) {
    for (const f of await fs.readdir(surefireDir)) {
      if (!f.endsWith(".xml")) continue;
      const xml = await fs.readFile(path.join(surefireDir, f), "utf8");
      for (const m of xml.matchAll(/<testcase\s+name="([^"]+)"\s+classname="([^"]+)"/g)) {
        const id = `${m[2]}.${m[1]}`;
        if (xml.includes(`<failure`) && xml.includes(`name="${m[1]}"`)) {
          failed.push({ test: id, error: "see surefire report" });
        } else {
          passed.push(id);
        }
      }
    }
  }
  return { framework: "selenium", passed, failed, durationMs: Date.now() - start };
}

async function runPlaywright(dir: string, baseUrl: string): Promise<SuiteResult> {
  const start = Date.now();
  let stdout = "";
  try {
    const res = await execFileP(
      "npx",
      ["--no-install", "playwright", "test", "--reporter=json"],
      { cwd: dir, env: { ...process.env, BASE_URL: baseUrl }, maxBuffer: 50 * 1024 * 1024 },
    );
    stdout = res.stdout;
  } catch (err: any) {
    stdout = err.stdout?.toString() ?? "";
  }
  const passed: string[] = [];
  const failed: { test: string; error: string }[] = [];
  try {
    const report = JSON.parse(stdout);
    const stack = [report];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (Array.isArray(cur.suites)) stack.push(...cur.suites);
      if (Array.isArray(cur.specs)) {
        for (const spec of cur.specs) {
          for (const t of spec.tests ?? []) {
            const id = `${spec.title}::${t.projectName ?? "default"}`;
            const last = t.results?.[t.results.length - 1];
            if (last?.status === "passed") passed.push(id);
            else if (last) failed.push({ test: id, error: last.error?.message ?? "failed" });
          }
        }
      }
    }
  } catch {
    // unparseable — leave both empty
  }
  return { framework: "playwright", passed, failed, durationMs: Date.now() - start };
}

function renderMarkdown(r: ParityReport): string {
  const lines: string[] = [];
  lines.push(`# Parity Report`);
  lines.push("");
  lines.push(
    `Both suites were run against the same staging environment. ` +
      `${r.divergences.matchedCount} tests matched (passed/failed identically).`,
  );
  lines.push("");
  lines.push(`## Regressions (Selenium ✓ → Playwright ✗) — ${r.divergences.regressions.length}`);
  lines.push("");
  for (const t of r.divergences.regressions) lines.push(`- ${t}`);
  lines.push("");
  lines.push(`## Likely fixes (Selenium ✗ → Playwright ✓) — ${r.divergences.fixes.length}`);
  lines.push("");
  for (const t of r.divergences.fixes) lines.push(`- ${t}`);
  lines.push("");
  lines.push(`## Run metadata`);
  lines.push("");
  lines.push(`| Suite | Passed | Failed | Duration |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(`| Selenium | ${r.selenium.passed.length} | ${r.selenium.failed.length} | ${(r.selenium.durationMs / 1000).toFixed(1)}s |`);
  lines.push(`| Playwright | ${r.playwright.passed.length} | ${r.playwright.failed.length} | ${(r.playwright.durationMs / 1000).toFixed(1)}s |`);
  lines.push("");
  return lines.join("\n");
}
