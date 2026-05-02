# sel2pw — v2.0 Roadmap

**Status:** Planning. Target: v2.0 GA in 12-15 weeks from v1.0.0 release.

This document is the canonical reference for what v2.0 includes, how it'll be built, and what it explicitly does *not* include. v2.x minor releases (2.1, 2.2, 2.3) are sketched at the end with shorter detail.

---

## Executive summary

sel2pw v1.x is the "skeleton + manual cleanup" converter. It saves typing on locators, assertions, lifecycle hooks, page-object scaffolding — but the user still spends 5-15 hours of cleanup per 100-200 file project. Real-world adoption shows this is 70-90% of the work; the remaining 10-30% is genuinely non-mechanical and can't be solved by adding more regex passes.

**v2.0 is the version that closes that last 10-30%** by adding an iterative auto-fix loop that pairs the rule-based AST converter with an LLM-driven cleanup pass + a Playwright test runner in a feedback loop. The output is no longer a skeleton — it's a Playwright project that compiles cleanly and (when an app is reachable) runs to green.

The other major themes — C# parity, plugin system, SaaS, GitHub Action — slot in as v2.x minor releases on a quarterly cadence after 2.0 lands.

---

## Why 2.0 (philosophy)

A major-version bump is justified when the *default user expectation* of the tool changes. v1.x users expect "skeleton, then I clean it up." v2.0 users will expect "I run sel2pw, optionally with `--auto-fix`, and I get either a working Playwright project or a clear list of what couldn't be auto-fixed."

That expectation shift is the breaking change. Even if the CLI flags themselves stayed identical, anyone running `sel2pw convert` against a 1.x reference would be surprised by the v2.0 default behavior. Better to mark it semver-major and write a clean migration guide than to slowly slide the defaults in 1.5 → 1.6 → 1.7 and confuse everyone.

**Pre-conditions for starting v2.0 work:**

- v1.0.0 has shipped and been live on npm for ≥ 30 days
- Weekly downloads sustained at ≥ 1,500 (real-user signal)
- At least 2 production teams have used 1.x end-to-end and reported back
- No P0 bugs (crashes, structurally invalid output) outstanding for ≥ 14 days
- Test coverage on transformers ≥ 75%

If those aren't true, more 1.x patch releases are needed before starting 2.0 architecture work.

---

## Theme 1: Iterative Auto-Fix Loop (centerpiece feature)

### Problem statement

A typical 100-file Selenium project produces ~2,500 TypeScript errors after sel2pw v1.x conversion (validated against the 15-codebase matrix). Roughly:

- 60% are "easy" — missing imports, stale Java types, idiomatic Java that didn't match a regex
- 25% are "medium" — project-specific helper references, custom constants, broken inheritance chains
- 15% are "hard" — complex generics, Java reflection, dynamic class loading, deeply-nested page-object hierarchies

A human eyeballing each error and patching it takes 1-3 minutes per error. Total cleanup: 40-100 hours for a 100-file project.

An LLM with the right context can patch most of the "easy" and "medium" categories in seconds. The "hard" 15% still need humans, but if we mechanically eliminate the other 85%, the cleanup work drops from 100 hours to 5-15 hours.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     sel2pw v2.0 pipeline                         │
└─────────────────────────────────────────────────────────────────┘

Input Java/Selenium project
         │
         ▼
┌────────────────────────────────────┐
│  PHASE 1 — Rule-based conversion   │  (existing v1.x pipeline)
│  AST → emitters → bodyTransformer  │
└────────────────────────────────────┘
         │
         ▼  TS files written to disk
┌────────────────────────────────────┐
│  PHASE 2 — TS-error fixup loop     │  (NEW in v2.0)
│  ┌──────────────────────────────┐  │
│  │ Run tsc --noEmit             │  │
│  │ Capture every error w/ ctx   │  │
│  │ For each error:              │  │
│  │   - send to LLM w/ prompt    │  │
│  │   - apply patch              │  │
│  │ Re-compile                   │  │
│  │ Loop (max 5 iterations or    │  │
│  │       fixed-point)           │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
         │
         ▼  TS clean
┌────────────────────────────────────┐
│  PHASE 3 — Runtime fixup loop      │  (NEW in v2.0)
│  ┌──────────────────────────────┐  │
│  │ npm install + playwright     │  │
│  │ install                       │  │
│  │ Run `playwright test`        │  │
│  │ For each failure:            │  │
│  │   - capture screenshot+DOM   │  │
│  │   - send to LLM              │  │
│  │   - apply patch              │  │
│  │ Re-run                        │  │
│  │ Loop (max 3 iterations)      │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
         │
         ▼
Output Playwright project (clean TS, optionally green tests)
```

### Component breakdown

#### 1.1 — TS Error Capture (`src/autofix/tscRunner.ts`)

Wraps `tsc --noEmit --pretty false --noErrorTruncation` with structured output parsing. Emits a typed array of:

```ts
interface TscError {
  filePath: string;        // absolute path
  relPath: string;         // relative to outputDir
  line: number;
  column: number;
  code: string;            // e.g. "TS2304"
  message: string;
  context: {
    before: string[];      // 3 lines before
    line: string;          // the offending line
    after: string[];       // 3 lines after
  };
  containingMethod?: string;  // best-effort: name of enclosing method
}
```

The `context` block is what gets sent to the LLM — full file content would blow the token budget on large files.

#### 1.2 — Error Grouping (`src/autofix/errorGrouper.ts`)

Many errors come in clusters: one bad import causes 50 "cannot find name" errors. Fix the import once, all 50 disappear. The grouper:

- Sorts errors by file
- Within a file, sorts by line
- Detects "cause-effect" patterns (e.g. all `TS2304: Cannot find name 'X'` in one file → one fix)
- Returns groups of `{ rootCause, derivedErrors[] }` so the LLM only sees one prompt per actual problem

This cuts LLM calls by ~5-10× on real codebases.

#### 1.3 — LLM Patch Generator (`src/autofix/patchGenerator.ts`)

Builds a prompt per error group:

```
You are fixing TypeScript errors in a Playwright test project that was
just auto-converted from Selenium Java. Apply the minimum patch to
resolve the error, preserving the original test intent.

File: pages/login.page.ts
Error: TS2304: Cannot find name 'BaseElement'
Context (lines 8-15):
  8 | import { Page, Locator } from '@playwright/test';
  9 |
 10 | export class LoginPage {
 11 |   readonly page: Page;
 12 |   readonly emailInput: BaseElement;     // ← line 13: error here
 13 |
 14 |   constructor(page: Page) {

Available class definitions in the project:
  - BaseElement at pages/base-element.page.ts (similar name match)
  - Page at @playwright/test
  - Locator at @playwright/test

Original Java for context (the 5 lines around the error in the source):
  protected BaseElement emailInput;
  // (the field came from Selenium PageFactory's @FindBy)

Output ONLY a JSON object: { "patches": [{ "line": N, "originalText": "...", "newText": "..." }, ...], "explanation": "..." }
Do not output markdown, code fences, or commentary.
```

Provider abstraction is already in `src/stretch/llmAdapter.ts` (Anthropic, OpenAI, Gemini). Reuse it. The patch generator returns:

```ts
interface PatchSet {
  patches: { line: number; originalText: string; newText: string }[];
  explanation: string;
  estimatedConfidence: number;  // 0-1, from LLM self-rating
}
```

#### 1.4 — Patch Applier (`src/autofix/patchApplier.ts`)

Applies the LLM's patches with safety rails:

- Verifies `originalText` actually exists at `line` (rejects stale patches)
- Backs up the file before each patch (so we can roll back if a patch breaks more than it fixes)
- Applies all patches in a group atomically
- Re-runs tsc on just the modified file → counts errors before vs. after
- If error count went UP (patch made things worse), rolls back

#### 1.5 — Iteration Budget (`src/autofix/budget.ts`)

Hard limits on the loop:

```ts
interface AutoFixBudget {
  maxIterations: number;        // default 5 for TS, 3 for runtime
  maxLLMCalls: number;          // default 200 per project (cost gate)
  maxLLMTokens: number;         // default 1M (cost gate)
  maxWallClockMinutes: number;  // default 30
  perFileBacklogThreshold: number;  // default 50 — skip files with >N errors
}
```

`perFileBacklogThreshold` is important: if a file has 500 errors, it's almost certainly the "manual port" category — auto-fix will burn LLM budget without converging. Skip those files, mark them in the review report, leave them as 1.x-style skeletons.

#### 1.6 — Fixed-Point Detection (`src/autofix/convergence.ts`)

After each iteration, compare `errorCount(t)` vs `errorCount(t-1)`:

- If `errorCount(t) === 0` → success, exit
- If `errorCount(t) >= errorCount(t-1)` → no progress, exit (don't burn more budget)
- If progress is made but slow (e.g. <10% reduction per iteration) → log a warning, continue

#### 1.7 — Runtime Phase (`src/autofix/runtimeRunner.ts`)

Same pattern as TS phase but for Playwright runtime errors:

- Run `playwright test --reporter=json` against a configurable target URL
- For each failed test, capture:
  - The error message + stack trace
  - Screenshot at failure
  - DOM snapshot at failure (`await page.content()`)
  - The test source code

Send to LLM with a different prompt template focused on runtime fixes (selector misses, missing waits, race conditions). Apply patches, re-run.

This phase is OPTIONAL — runs only if `--auto-fix-runtime` is passed AND a `--target-url` is provided. The TS-fixup phase is the bigger win and runs by default with `--auto-fix`.

### CLI surface (v2.0)

```bash
# v1.x equivalent — still works
sel2pw convert ./suite --out ./pw

# v2.0 default behavior
sel2pw convert ./suite --out ./pw --auto-fix

# With runtime phase
sel2pw convert ./suite --out ./pw --auto-fix --auto-fix-runtime --target-url https://staging.example.com

# Full configuration
sel2pw convert ./suite --out ./pw \
  --auto-fix \
  --auto-fix-runtime \
  --target-url https://staging.example.com \
  --llm-provider anthropic \
  --llm-model claude-sonnet-4 \
  --llm-key $ANTHROPIC_API_KEY \
  --max-llm-calls 500 \
  --max-iterations 8 \
  --skip-files-over 100   # skip files with > 100 TS errors after rule pass
```

### Implementation steps (12-week breakdown)

**Week 1-2: Foundation.**
- [ ] Create `src/autofix/` directory structure
- [ ] Implement `tscRunner.ts` with structured error capture
- [ ] Implement `errorGrouper.ts` with cluster detection
- [ ] Unit tests against fixtures from selenium1-15 outputs

**Week 3-4: Patch generator + applier.**
- [ ] Implement `patchGenerator.ts` with prompt templates
- [ ] Implement `patchApplier.ts` with rollback safety
- [ ] Hook into existing `src/stretch/llmAdapter.ts`
- [ ] End-to-end test: feed a known TS error, get a working patch

**Week 5-6: Convergence + budget logic.**
- [ ] Implement `budget.ts` with cost gates
- [ ] Implement `convergence.ts` with fixed-point detection
- [ ] Implement `convertWithAutoFix()` that ties it all together
- [ ] Test against selenium14 (the hardest case — 2,894 TS errors)

**Week 7-8: Runtime phase.**
- [ ] Implement `runtimeRunner.ts` (Playwright test execution + failure capture)
- [ ] Runtime-focused prompt templates
- [ ] DOM/screenshot capture pipeline
- [ ] Test against selenium4 (the proven-working case)

**Week 9-10: CLI integration.**
- [ ] Wire `--auto-fix` / `--auto-fix-runtime` flags into `src/cli.ts`
- [ ] Update `convert()` orchestration in `src/index.ts`
- [ ] Cost / progress reporting in real-time (terminal UI)
- [ ] Update `conversion-result.json` schema (auto-fix iteration history)

**Week 11-12: Validation + docs.**
- [ ] Run against all 15 codebases with `--auto-fix`
- [ ] Capture before/after TS error counts → blog-worthy result
- [ ] Update README, migration playbook, CONVERSION_PATTERNS reference
- [ ] Write v2.0 migration guide

**Week 13-14: Hardening + release.**
- [ ] Real-user pilot on 1-2 production codebases
- [ ] Bug fixes based on pilot feedback
- [ ] v2.0.0-rc.1 release
- [ ] v2.0.0 GA

### Acceptance criteria

v2.0 ships when:

- selenium14 (2,894 TS errors at v1.0) drops to <100 TS errors with `--auto-fix` enabled
- selenium6 (1,029 TS errors) drops to <50
- Smaller codebases (selenium4, 8) reach 0 TS errors
- selenium4 with `--auto-fix-runtime` produces a project where `npx playwright test` passes ≥80% of the converted tests against a sample app
- LLM cost per 100-file project averages ≤ $5 USD (Claude Sonnet pricing)
- Total wall-clock for a 100-file project averages ≤ 15 minutes
- 1+ external production team has run `--auto-fix` end-to-end and confirmed the output

---

## Theme 2: Default Flip + CLI Cleanup (bundled with 2.0)

Save up the small breaking changes. Ship them all in one painful release with a clear migration guide.

### Breaking changes for 2.0

1. **`--bdd-mode flatten` becomes the default.** v1.x default was `preserve` (playwright-bdd). Real-world adoption shows most teams prefer flatten. Users wanting preserve must opt in with `--bdd-mode preserve`.

2. **`--validate` (tsc) becomes default ON.** v1.x had it opt-in. v2.0 always runs `tsc --noEmit` after conversion and surfaces errors in the review report. Disable with `--no-validate`.

3. **`--validate-eslint` becomes default ON when an eslint config exists in output.** Same principle.

4. **`--format` (Prettier) becomes default ON.** Prettier output is so much nicer that it should be opt-out, not opt-in. Disable with `--no-format`.

5. **CLI flag renames:**
   - `--emit-self-healing-shim` → `--self-healing` (shorter, clearer)
   - `--emit-auth-setup` → `--auth-setup`
   - `--llm-provider` / `--llm-key` / `--llm-model` collapse into `--llm <provider:model>` with separate `--llm-key` / `LLM_API_KEY` env

6. **`conversion-result.json` schema bump to `sel2pw.conversion-result.v2`** — adds an `autoFix` block with iteration history, LLM calls, cost.

7. **Drop deprecated programmatic API exports** — anything marked `@deprecated` in 1.x source goes away.

### Migration guide outline (v1 → v2)

`docs/MIGRATION_v1_to_v2.md` published alongside the 2.0 release. Covers:

- Each breaking change with before/after examples
- Codemod / sed scripts for mechanical updates
- One-liner CLI flag mapping table
- "If you used X in 1.x, do Y in 2.x" section

---

## Theme 3: Plugin System (v2.1)

Not in 2.0. Ships as 2.1 because it's additive (no breaking changes), but the plugin loader has to be designed before 2.0 freezes the CLI bootstrap.

### Plugin API sketch

```typescript
// sel2pw.config.ts in user repo
import { definePlugin } from '@vijaypjavvadi/sel2pw';

export default definePlugin({
  // Custom helper rewrites
  helperRewrites: {
    'MyTeam.clearAndType': 'await $1.fill($2)',
    'WaitHelper.waitForElement': 'await $1.waitFor()',
    'MyAssert.equalsIgnoreCase': 'expect($1.toLowerCase()).toBe($2.toLowerCase())',
  },
  // Custom classifier patterns
  pageObjectSuffixes: ['ScreenObject', 'WebPage'],
  // Custom locator strategies
  locatorStrategies: {
    'By.dataTest': (val) => `[data-test="${val}"]`,
    'By.testId': (val) => `[data-testid="${val}"]`,
  },
  // Custom Java import mappings (for project-specific deps)
  importMappings: {
    'com.mycompany.commons.WaitUtil': null,  // strip
    'com.mycompany.helpers.Reporter': '@mycompany/playwright-reporter',
  },
});
```

sel2pw auto-discovers `sel2pw.config.ts` in the source root or `--config` flag. Plugin runs its rewrites *after* the built-in transformer pipeline, before emit.

### Implementation effort

3 weeks. Mostly API design + a Vite-style config loader.

---

## Theme 4: C# / SpecFlow First-Class Parity (v2.2)

Currently `src/parser/csharpExtractor.ts` is regex-based and handles ~80% of cases. v2.2 ships a real .NET AST sidecar.

### Architecture

```
sel2pw (Node) ←─── JSON AST ──── csharp-parser (.NET subprocess)
                                  ├─ Roslyn SyntaxTree
                                  └─ JSON serializer
```

The .NET subprocess is a small `dotnet tool` package (`sel2pw-csharp`) that reads a C# file from stdin and emits an AST as JSON. sel2pw consumes it via a child-process call.

### Coverage targets

| Feature | v1.x (regex) | v2.2 (AST) |
|---|---|---|
| `[Test]` / `[TestCase]` / `[Theory]` | ✅ | ✅ |
| `[Setup]` / `[OneTimeSetUp]` / `[TearDown]` | ✅ | ✅ |
| Selenium .NET API mappings (`IWebDriver`, `IWebElement`) | ✅ | ✅ |
| SpecFlow `[Binding]` / step methods | ⚠️ | ✅ |
| `[Parallelizable]` attribute | ❌ | ✅ |
| Generic NUnit attributes | ❌ | ✅ |
| F# input | ❌ | future |

### Implementation effort

4 weeks. The .NET subprocess is the bulk; the JS-side rewrite logic mirrors the Java pipeline.

### Why it's worth doing

Selenium .NET is roughly 40% of the enterprise market. Right now sel2pw effectively serves the Java half. C# parity opens a market that's roughly equal in size to the current addressable one.

---

## Theme 5: SaaS + GitHub Action (v2.3)

Two independent surfaces, both leverage the existing platform-internal HTTP service.

### GitHub Action

`uses: vijaypjavvadi/sel2pw-action@v1` posts the conversion review as a PR comment when run on a PR. Includes the `conversion-result.json` summary stats and a link to download the converted artifacts.

```yaml
# .github/workflows/playwright-convert.yml
on:
  pull_request:
    paths: ['src/test/java/**']
jobs:
  convert:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vijaypjavvadi/sel2pw-action@v1
        with:
          input: src/test/java
          output: pw-tests
          auto-fix: true
          llm-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Hosted SaaS

`sel2pw.com`. Upload a zip → run conversion server-side → download a zip with the converted Playwright project + a CI config + an estimate of cleanup hours.

- Free tier: 1 project per day, public projects only, watermarked output
- Paid tier ($49/mo or $199 one-time): private projects, no watermark, priority queue, unlimited
- Enterprise: SSO, audit log, on-prem deployment

### Implementation effort

GitHub Action: 1 week.
SaaS: 8 weeks (auth, billing, queue, frontend, ops).

The GitHub Action is the better starting point — discoverability + zero ops. SaaS only makes sense if there's clear demand from the GitHub Action funnel.

---

## What WON'T be in 2.0 (explicit)

Setting expectations to avoid scope creep:

- **F# / Kotlin / Scala input** — cool but no demand
- **Cypress / WebdriverIO input** — different tools, different problem
- **TestNG → JUnit conversion** — out of scope (sel2pw is about runtime migration, not Java framework migration)
- **Playwright → Selenium** — wrong direction
- **GUI test recorder** — Playwright already has `npx playwright codegen`
- **Visual regression migration** — not enough teams use Selenium for visual regression
- **Cucumber → Gherkin language conversion** — sel2pw consumes Gherkin, doesn't generate it
- **Custom test reporters** — write your own using Playwright's reporter API

---

## Acceptance criteria for tagging v2.0.0

All must clear:

1. **Auto-fix loop performance gates** (Theme 1 acceptance criteria above)
2. **All breaking changes from Theme 2 implemented and migration guide written**
3. **Test coverage on `src/autofix/` ≥ 80%** (this is new code, has to be solid)
4. **Real-user pilot completed** — at least one external production team has run `--auto-fix` on their Selenium suite and reported back
5. **Cost per 100-file project ≤ $5 USD average** (Claude Sonnet pricing)
6. **CI green for 30 consecutive days on the new auto-fix paths**
7. **`docs/MIGRATION_v1_to_v2.md` published**
8. **Updated CHANGELOG, README, STATUS.md to reflect v2.0**
9. **No P0 bugs outstanding**

---

## Timeline (ideal)

| Phase | Weeks | Milestone |
|---|---|---|
| v1.x stabilization | Weeks 1-4 post-1.0 | Real-user feedback patches, no new features |
| v2.0 design + spike | Weeks 5-6 | Spike auto-fix loop on selenium14 (the hardest case). Validate the architecture works before committing to 12 weeks of build. |
| v2.0 build phase | Weeks 7-18 | Full implementation of Themes 1 + 2 |
| v2.0 hardening + pilot | Weeks 19-20 | External team pilot, RC release |
| **v2.0.0 GA** | **Week 21** | **Coordinated announcement** |
| v2.1 (plugin system) | Weeks 22-24 | Additive |
| v2.2 (C# AST) | Weeks 25-28 | Additive |
| v2.3 (GitHub Action) | Week 29 | Additive |
| v2.3 (SaaS, if demand) | Weeks 30-37 | Operational lift |

Realistic if you treat sel2pw as a 10-15 hour/week commitment. Faster if you go full-time.

---

## How to use this document

This roadmap is the source of truth for sel2pw v2.x. Anyone — contributors, users, employers, EB1A reviewers — can read it and understand the trajectory.

**Update it when:**
- A theme moves from "planned" to "in progress" (add target date)
- A theme is descoped (move to "what won't be in 2.0")
- A new theme is added (justify it against the same criteria as the existing five)

**Don't update it when:**
- Implementation details change (those go in commit messages and CHANGELOG)
- Bugs are discovered in 1.x (those go in issues / patches, not the roadmap)
- A user asks for a feature (only update if you're committing to it)

The roadmap is a contract with future-you and the community. Keep it honest, keep it dated, keep it small.

---

*Last updated: post-v0.11.4 release. Next review: after v1.0.0 ships.*
