#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * scripts/clone-validation-batch-v2.js
 *
 * Second-round validation matrix. Clones 13 real-world Selenium/TestNG
 * frameworks into examples/validation-batch-v2/, runs `sel2pw convert`
 * against each, captures TypeScript error counts, and writes a baseline
 * + a human-readable summary table.
 *
 * After v0.11.x → v1.0.0 we have 15 fixture codebases in the matrix,
 * but they are mostly "pure Selenium UI" repos. Production frameworks
 * pull in JDBC, REST Assured, Allure, JavaMail, TestContainers, Appium,
 * cloud SDKs, etc. — this batch is targeted at exactly those gaps.
 *
 * Tiers:
 *   1. Database + JDBC          (DB calls inside Selenium tests)
 *   2. UI + API hybrid          (RestAssured alongside Selenium)
 *   3. Production-grade         (ExtentReports + Allure + Jenkins + Email)
 *   4. Mobile / cross-platform  (Appium + cloud grid)
 *   5. BDD heavy                (Cucumber feature files)
 *
 * Usage:
 *   node scripts/clone-validation-batch-v2.js              # fast mode (default)
 *   node scripts/clone-validation-batch-v2.js --full       # also npm install + full tsc
 *   node scripts/clone-validation-batch-v2.js --skip-clone # use cached clones
 *   node scripts/clone-validation-batch-v2.js --only=jdbc-pure,master-selenium
 *   node scripts/clone-validation-batch-v2.js --list       # print matrix and exit
 *
 * Fast mode: skips `npm install` in each output dir. tsc still runs and
 * catches syntax + unresolved-name errors, but type-resolution errors
 * that depend on @playwright/test types will be over-reported. Use --full
 * for a precise count once the fast pass shows acceptable baseline shape.
 *
 * Output:
 *   examples/validation-batch-v2/sources/<slug>/             - cloned repo
 *   examples/validation-batch-v2/outputs/<slug>-playwright/  - converted output
 *   examples/validation-batch-v2/batch-v2-baseline.json      - structured results
 *   examples/validation-batch-v2/batch-v2-summary.md         - human-readable
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const fs = require('fs-extra');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BATCH_ROOT = path.join(REPO_ROOT, 'examples', 'validation-batch-v2');
const SOURCES_DIR = path.join(BATCH_ROOT, 'sources');
const OUTPUTS_DIR = path.join(BATCH_ROOT, 'outputs');
const CLI = path.join(REPO_ROOT, 'dist', 'cli.js');

// Try to load the v2.0 spike's tscRunner for structured error parsing.
// If not present (dist not built / autofix module missing) fall back to
// counting `error TS\d+:` lines in the shell tsc output.
let tscRunner = null;
try {
  // eslint-disable-next-line global-require
  tscRunner = require(path.join(REPO_ROOT, 'dist', 'autofix', 'tscRunner.js'));
} catch (e) {
  console.warn('[batch] tscRunner module not loadable — using shell fallback.');
}

const REPOS = [
  // Tier 1 — Database + JDBC
  { slug: 'jdbc-learning',       tier: 1, kind: 'DB+UI BDD',       url: 'https://github.com/cihat-kose/cucumber-jdbc-ui-db-learning-path.git' },
  { slug: 'jdbc-test-lab',       tier: 1, kind: 'DB+UI BDD',       url: 'https://github.com/cihat-kose/cucumber-jdbc-ui-db-test-lab.git' },
  { slug: 'jdbc-pure',           tier: 1, kind: 'DB inline',       url: 'https://github.com/kush1107/SeleniumDatabaseTesting_JDBC.git' },

  // Tier 2 — UI + API hybrid
  { slug: 'ui-api-pavleciric',   tier: 2, kind: 'UI+API BDD',      url: 'https://github.com/pavleciric89/UI-API-test-automation-framework.git' },
  { slug: 'ui-api-bookknight',   tier: 2, kind: 'UI+API BDD',      url: 'https://github.com/TheBookKnight/java-selenium-cucumber-restassured.git' },
  { slug: 'ui-api-chiranjeevi',  tier: 2, kind: 'UI+API BDD',      url: 'https://github.com/Chiranjeevi521/testng-cucumber-selenium-restassured.git' },

  // Tier 3 — Production-grade
  { slug: 'master-selenium',     tier: 3, kind: 'Production',      url: 'https://github.com/rajatt95/MasterSeleniumFramework.git' },
  { slug: 'anhtester-selenium',  tier: 3, kind: 'Production',      url: 'https://github.com/anhtester/AutomationFrameworkSelenium.git' },
  { slug: 'eliasnogueira-lean',  tier: 3, kind: 'TestContainers',  url: 'https://github.com/eliasnogueira/selenium-java-lean-test-architecture.git' },

  // Tier 4 — Mobile / cross-platform
  { slug: 'appium-maciejd',      tier: 4, kind: 'Appium+Web+API',  url: 'https://github.com/maciejd/appium-selenium-testng-framework.git' },
  { slug: 'appium-gauravkarvir', tier: 4, kind: 'Appium+SauceLabs', url: 'https://github.com/gauravkarvir/cucumber_testng_java.git' },

  // Tier 5 — BDD heavy
  { slug: 'bdd-nisvek',          tier: 5, kind: 'BDD',             url: 'https://github.com/NisVek-Automation/Selenium-Java-TestNG-BDD.git' },
  { slug: 'bdd-anhtester',       tier: 5, kind: 'BDD',             url: 'https://github.com/anhtester/AutomationFrameworkCucumberTestNG.git' },
];

const ARGS = parseArgs(process.argv.slice(2));

async function main() {
  if (ARGS.list) {
    console.log('Validation batch v2 — 13 repos:\n');
    for (const r of REPOS) {
      console.log(`  Tier ${r.tier}  ${r.slug.padEnd(22)} ${r.kind.padEnd(20)} ${r.url}`);
    }
    return;
  }

  console.log('[batch] sel2pw validation batch v2');
  console.log('[batch] Project root:', REPO_ROOT);
  console.log('[batch] Output dir:  ', BATCH_ROOT);
  console.log('[batch] Mode:        ', ARGS.full ? 'full (npm install + tsc)' : 'fast (tsc only)');

  if (!(await fs.pathExists(CLI))) {
    console.error(`[batch] FATAL: ${CLI} not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  await fs.ensureDir(SOURCES_DIR);
  await fs.ensureDir(OUTPUTS_DIR);

  const repos = ARGS.only
    ? REPOS.filter((r) => ARGS.only.includes(r.slug))
    : REPOS;

  console.log('[batch] Repos in this run:', repos.length);

  const results = [];
  const startedAt = new Date();

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    console.log(`\n[batch] [${i + 1}/${repos.length}] ${repo.slug}  (tier ${repo.tier} · ${repo.kind})`);

    const result = {
      slug: repo.slug,
      tier: repo.tier,
      kind: repo.kind,
      url: repo.url,
      startedAt: new Date().toISOString(),
    };

    // ---- Step 1: clone ----------------------------------------------------
    const srcDir = path.join(SOURCES_DIR, repo.slug);
    const hasGit = await fs.pathExists(path.join(srcDir, '.git'));

    if (hasGit || ARGS.skipClone) {
      console.log('[batch]   clone   skipped (cached)');
      result.cloneStatus = hasGit ? 'cached' : 'skipped-missing';
    } else {
      try {
        await execFileP('git', ['clone', '--depth', '1', repo.url, srcDir], {
          shell: true,
          maxBuffer: 50 * 1024 * 1024,
        });
        result.cloneStatus = 'ok';
        console.log('[batch]   clone   ok');
      } catch (e) {
        result.cloneStatus = 'failed';
        result.cloneError = firstLines(e.stderr || e.message, 3);
        console.error('[batch]   clone   FAILED:', firstLines(e.message, 1));
        results.push(result);
        continue;
      }
    }

    // ---- Step 2: convert --------------------------------------------------
    const outDir = path.join(OUTPUTS_DIR, `${repo.slug}-playwright`);
    if (await fs.pathExists(outDir)) {
      await fs.remove(outDir);
    }

    const tConv = Date.now();
    try {
      const { stdout } = await execFileP(
        'node',
        [CLI, 'convert', srcDir, '--out', outDir],
        {
          shell: true,
          maxBuffer: 100 * 1024 * 1024,
          cwd: REPO_ROOT,
        },
      );
      result.convertStatus = 'ok';
      result.convertMs = Date.now() - tConv;

      // sel2pw prints a summary line; pluck file counts if available.
      const filesMatch = stdout.match(/(\d+)\s+(?:files?|outputs?)\s+(?:written|emitted)/i);
      if (filesMatch) result.tsFilesEmitted = parseInt(filesMatch[1], 10);

      console.log(`[batch]   convert ok    (${result.convertMs}ms)`);
    } catch (e) {
      result.convertStatus = 'failed';
      result.convertMs = Date.now() - tConv;
      result.convertError = firstLines(
        (e.stderr && e.stderr.toString()) || e.message,
        5,
      );
      console.error('[batch]   convert FAILED:', firstLines(e.message, 1));
      results.push(result);
      continue;
    }

    // ---- Step 3: npm install (full mode only) -----------------------------
    if (ARGS.full) {
      const tInst = Date.now();
      try {
        await execFileP(
          'npm',
          ['install', '--no-audit', '--no-fund', '--silent', '--prefer-offline'],
          {
            shell: true,
            cwd: outDir,
            maxBuffer: 100 * 1024 * 1024,
          },
        );
        result.installStatus = 'ok';
        result.installMs = Date.now() - tInst;
        console.log(`[batch]   install ok    (${result.installMs}ms)`);
      } catch (e) {
        result.installStatus = 'failed';
        result.installError = firstLines(e.message, 3);
        console.warn('[batch]   install FAILED — tsc errors will be over-reported');
      }
    }

    // ---- Step 4: tsc ------------------------------------------------------
    const tTsc = Date.now();
    try {
      if (tscRunner) {
        const tscResult = await tscRunner.runTsc(outDir);
        const summary = tscRunner.summariseTscRun(tscResult);
        result.tscOk = tscResult.ok;
        result.tscErrorCount = tscResult.errorCount;
        result.tscByCode = summary.byCode;
        result.tscTopFiles = summary.topFiles.slice(0, 5);
      } else {
        const tscOut = await runTscShellFallback(outDir);
        result.tscOk = tscOut.errorCount === 0;
        result.tscErrorCount = tscOut.errorCount;
        result.tscByCode = tscOut.byCode;
      }
      result.tscMs = Date.now() - tTsc;
      console.log(`[batch]   tsc     ${result.tscErrorCount} errors  (${result.tscMs}ms)`);
    } catch (e) {
      result.tscOk = false;
      result.tscErrorCount = -1;
      result.tscError = firstLines(e.message, 3);
      console.error('[batch]   tsc     ERROR:', firstLines(e.message, 1));
    }

    result.completedAt = new Date().toISOString();
    results.push(result);
  }

  // ---- Aggregate & write artifacts ----------------------------------------
  const totalTsErrors = results.reduce(
    (s, r) => s + Math.max(0, r.tscErrorCount ?? 0),
    0,
  );
  const converted = results.filter((r) => r.convertStatus === 'ok').length;

  const aggregate = {
    schema: 'sel2pw-validation-batch-v2/1.0',
    mode: ARGS.full ? 'full' : 'fast',
    cliPath: CLI,
    cliVersion: await readCliVersion(),
    runStartedAt: startedAt.toISOString(),
    runCompletedAt: new Date().toISOString(),
    totalRepos: results.length,
    converted,
    totalTsErrors,
    errorsByTier: aggregateErrorsByTier(results),
    errorsByCode: aggregateErrorsByCode(results),
    results,
  };

  await fs.writeJSON(path.join(BATCH_ROOT, 'batch-v2-baseline.json'), aggregate, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(BATCH_ROOT, 'batch-v2-summary.md'),
    renderMarkdown(aggregate),
  );

  console.log('\n[batch] ─── DONE ───');
  console.log(`[batch] Converted:       ${converted}/${results.length}`);
  console.log(`[batch] Total TS errors: ${totalTsErrors}`);
  console.log(`[batch] Baseline:        ${path.join(BATCH_ROOT, 'batch-v2-baseline.json')}`);
  console.log(`[batch] Summary:         ${path.join(BATCH_ROOT, 'batch-v2-summary.md')}`);
}

// ---------- helpers --------------------------------------------------------

function parseArgs(argv) {
  const out = { full: false, skipClone: false, only: null, list: false };
  for (const a of argv) {
    if (a === '--full') out.full = true;
    else if (a === '--skip-clone') out.skipClone = true;
    else if (a === '--list') out.list = true;
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length).split(',');
  }
  return out;
}

function firstLines(s, n) {
  return String(s || '').split(/\r?\n/).slice(0, n).join(' | ');
}

async function readCliVersion() {
  try {
    const pkg = await fs.readJSON(path.join(REPO_ROOT, 'package.json'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function aggregateErrorsByTier(results) {
  const tiers = {};
  for (const r of results) {
    if (!Number.isFinite(r.tscErrorCount) || r.tscErrorCount < 0) continue;
    tiers[r.tier] = (tiers[r.tier] ?? 0) + r.tscErrorCount;
  }
  return tiers;
}

function aggregateErrorsByCode(results) {
  const merged = {};
  for (const r of results) {
    if (!r.tscByCode) continue;
    for (const [code, n] of Object.entries(r.tscByCode)) {
      merged[code] = (merged[code] ?? 0) + n;
    }
  }
  // top 15 codes
  return Object.fromEntries(
    Object.entries(merged)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15),
  );
}

async function runTscShellFallback(outDir) {
  // Mirrors what tscRunner does internally — kept here so the script
  // works even when the autofix module isn't built yet.
  let raw = '';
  try {
    const r = await execFileP(
      'npx',
      ['--no-install', 'tsc', '-p', outDir, '--noEmit', '--pretty', 'false', '--noErrorTruncation'],
      { shell: true, cwd: outDir, maxBuffer: 100 * 1024 * 1024 },
    );
    raw = r.stdout + r.stderr;
  } catch (e) {
    raw = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
  }

  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;
  const byCode = {};
  let count = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    count++;
    const code = m[4];
    byCode[code] = (byCode[code] ?? 0) + 1;
  }
  return { errorCount: count, byCode };
}

function renderMarkdown(agg) {
  const sorted = agg.results
    .slice()
    .sort((a, b) => a.tier - b.tier || a.slug.localeCompare(b.slug));

  const rows = sorted.map((r) => {
    const status = r.convertStatus === 'ok' ? 'ok' : 'FAILED';
    const ts =
      r.convertStatus !== 'ok'
        ? '—'
        : r.tscErrorCount < 0
          ? 'err'
          : String(r.tscErrorCount);
    const top = r.tscByCode
      ? Object.entries(r.tscByCode)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([c, n]) => `${c}:${n}`)
          .join(' ')
      : '';
    return `| ${r.tier} | \`${r.slug}\` | ${r.kind} | ${status} | ${ts} | ${top} |`;
  });

  const tierLines = Object.entries(agg.errorsByTier)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([t, n]) => `- Tier ${t}: **${n}** errors`)
    .join('\n');

  const codeLines = Object.entries(agg.errorsByCode)
    .map(([code, n]) => `- \`${code}\` — ${n}`)
    .join('\n');

  return `# Validation Batch v2 — Baseline

Generated: ${agg.runCompletedAt}
CLI version: \`${agg.cliVersion}\`
Mode: **${agg.mode}**  (\`fast\` = tsc only, \`full\` = npm install + tsc)

**Converted:** ${agg.converted}/${agg.totalRepos}
**Total TS errors:** ${agg.totalTsErrors}

## Per-repo results

| Tier | Slug | Kind | Convert | TS errors | Top codes |
| ---: | --- | --- | :---: | ---: | --- |
${rows.join('\n')}

## Errors by tier

${tierLines || '_no data_'}

## Top TS error codes

${codeLines || '_no data_'}

## Notes

- \`fast\` mode skips \`npm install\` in each output dir, so type-resolution
  errors (TS2307 \`Cannot find module '@playwright/test'\`, TS2304 \`Cannot
  find name 'expect'\`) will be inflated. Use \`--full\` for a precise count.
- BDD repos default to \`--bdd-mode preserve\` which requires \`playwright-bdd\`
  at the output. They will show high error counts in fast mode — this is
  expected and not a regression.
- The baseline is committed so CI can compare against it. To refresh:
  \`node scripts/clone-validation-batch-v2.js --skip-clone\` (re-converts
  but re-uses the cached source clones).
`;
}

main().catch((e) => {
  console.error('[batch] FATAL:', e);
  process.exit(1);
});
