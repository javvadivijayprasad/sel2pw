# sel2pw — Current Status

A point-in-time snapshot. CHANGELOG.md is the authoritative history; this file is "where are we right now, what works, what's pending, what's deferred".

Last updated after Phase 10.3 (selenium8 milestone — full classification of every file in an 8th real-world codebase). 0.6.x verified locally with 45/45 tests green. 0.7.x output polish. 0.8.x multi-language + multi-LLM + 7 real-codebase patches. 0.9.0 failure-telemetry SQLite. 0.10.0 mirrors the TPS / ai-governance distribution pattern — `npm run build:exe` produces `dist-exe/sel2pw.exe`; platform downloads endpoints at `/api/v1/downloads/sel2pw.exe`; structured `conversion-result.json` writeback. **0.10.3 closes selenium8: 11/11 files classified, 0 failed, 0 skipped — every stub paired with concrete migration guidance.**

### Validation matrix across 8 real-world codebases

| Project | Files | Failed | Skipped | Notes |
| --- | --- | --- | --- | --- |
| selenium1 (naveenanimation20) | 4 | 0 | 0 | clean |
| selenium2 (cgjangid) | 2 | 0 | 0 | clean |
| selenium3 (AlfredStenwin) | 35 | 0 | ~5 | decorator hierarchy stress |
| selenium4 (vibssingh) | 8 | 0 | 0 | clean |
| selenium5 (swtestacademy ExcelReadWrite) | 11 | 0 | 0 | drove Phase 8.4–8.7 |
| selenium6 (aeshamangukiya hybrid) | 21 | 0 | ~3 | broadest framework |
| selenium7 (Infosys) | 4 | 0 | 0 | clean |
| selenium8 (yadsandy Data-Driven) | 11 | **0** | **0** | drove Phase 10.2–10.3 |

Every codebase's failures became a one-line apiMap rule, classifier widening, or detector pattern. The next codebase that surfaces a new shape is the next round of patches — that's the loop.

## What ships today (verified shipped)

### Pipeline (`src/`)

- Scan → parse → classify → transform → emit → post-process → review.
- AST extractor (`java-parser` + Chevrotain) is canonical. Regex extractor remains as a per-file fallback when the AST throws or `java-parser` isn't installed. Per-file try/catch in `index.ts` so one bad source never aborts the whole run.
- Locator mapping: `By.id/css/xpath/name/linkText/partialLinkText/tagName/className` + `@FindBy`.
- WebDriver/WebElement API mappings: navigation, click/fill/clear/text/attribute/visibility/enabled/selected, `WebDriverWait` removal, `Thread.sleep`.
- Assertions: TestNG `Assert.*` and Hamcrest `assertThat(actual, matcher)` — scan-based parser handles commas-in-strings and parens-in-args.
- Advanced API: `Actions` chains, `JavascriptExecutor`, `switchTo().frame/alert`, cookies, file upload via `Paths.get`/`new File`.
- Lifecycle: TestNG (`@BeforeMethod/Class/Suite/Test`, `@AfterMethod/Class/Suite/Test`) and JUnit 4/5 (`@Before/@After`, `@BeforeEach/@AfterEach`, `@BeforeAll/@AfterAll`).
- `@DataProvider` → typed parameterised `for` loop.
- BaseTest superclass → `tests/fixtures.ts` (Playwright fixture extension).
- `testng.xml` → `playwright.config.ts` projects with `grep` tags.
- `*.properties` → `.env.example` + `tests/config.ts` typed loader.
- Page Object emitter with optional `--emit-self-healing-shim` (wraps locators in `healOrThrow` from `@platform/sdk-self-healing`).

### Post-processing (`src/post/`)

- Optional Prettier pass (`--format`).
- Optional `tsc --noEmit` validation gate (`--validate`) with errors attached to the review report.
- Optional `auth.setup.ts` generator (`--emit-auth-setup`) when a `LoginPage` is detected.
- `// TODO(sel2pw): …` markers (default on; disable with `--no-todo-markers`).

### Reports (`src/reports/`)

- `CONVERSION_REVIEW.md` — line-level review punch list grouped by file and severity.
- `MIGRATION_NOTES.md` — what to delete from `pom.xml`, what to install, runtime semantic changes, CI changes, parity playbook.

### HTTP service (`src/server.ts`, `src/server/`)

Reachable through the `modern-automation-platform` gateway at `/api/v1/converter/*`.

- `GET /health`, `POST /analyze`, `POST /convert`, `GET /jobs/:id`, `GET /jobs/:id/artifact`, `GET /jobs/:id/review`, `POST /feedback`.
- Job runner (JSON file persistence under `<workdir>/jobs/`).
- Artifact storage abstraction (local driver implemented; S3 stubbed).
- Provenance block matches `test-case-generation-service` shape.
- Honours `governance.config_url`, calls the `ai-governance` sidecar's `/audit`, attaches `governance_audit.json`.
- HMAC-signed webhook delivery with retries.

### Cross-repo

- `ai-governance/service/` — FastAPI sidecar with `/health`, `/sanitize`, `/audit`. Docker image at `service/Dockerfile`.
- `modern-automation-platform/apps/framework-generator-api/src/routes/converter.routes.ts` — gateway proxy mounted at `/api/v1/converter` in `app.ts`.
- `modern-automation-platform/packages/shared-types/src/index.ts` — `ConverterJob`, `ConverterStats`, `ConverterReviewItem`, `ConverterProvenance`.

### Distribution

- LICENSE (MIT), CONTRIBUTING.md, .github/workflows/ci.yml (matrix Node 18/20/22 × Linux/macOS/Windows), .github/workflows/release.yml (tag → npm publish --provenance), .github/dependabot.yml, .changeset/config.json, typedoc.json.

### Stretch scaffolds (`src/stretch/`)

- Cucumber BDD → playwright-bdd (`bdd.ts`).
- Auto-fix loop (`autoFix.ts`) with run-once + parse-failures + apply-diff machinery.
- Hybrid AST + LLM (`hybridLlm.ts` + `governanceClient.ts`).
- **Real Anthropic adapter (`anthropicAdapter.ts`) — 0.6.0.** Provides `makeAnthropicPatchCallback()` for autoFix and `makeAnthropicLlmCallback()` for the hybrid engine. Governance sanitise is enforced in code before any model call. Lazy-loads `@anthropic-ai/sdk` so the converter still installs without it.
- Behaviour-parity verifier (`parityVerifier.ts`).
- C# / SpecFlow design doc (`csharp/README.md`).

### Phase 6 additions

- `src/transformers/advancedApiMap.ts → rewriteWindowHandles` — multi-window/tab (`getWindowHandles`, `getWindowHandle`, `switchTo().window`).
- `src/transformers/customUtilDetector.ts` — detects DriverFactory / DriverManager / Wait helpers; emits typed stubs at `tests/_legacy-stubs/<name>.ts`.
- `src/transformers/commentPreserver.ts` — Javadoc + inline comment primitives (`findJavadocBeforeMethod`, `indexAllJavadocs`, `stripFileHeader`). Emitter wiring is the next pass.
- `src/emitters/pageBagEmitter.ts` — opt-in `--pom-style=factory` emits `pages/index.ts` + `tests/fixtures.pages.ts`.
- `tests/fixtures/realworld/` — three representative shapes (page-factory, hamcrest-heavy, bdd-cucumber) + a vitest suite that converts each into a temp dir and asserts on structural properties.

## Verification matrix

| Step | Where it ran | Status |
| --- | --- | --- |
| Sandbox-only Node verifier (`scripts/verify.js`) | Cloud sandbox (no npm) | ✅ passes — confirms conversion logic on bundled sample |
| `npm install` | User's local Windows machine | ✅ confirmed working |
| `npm run lint` | User's local | ✅ clean (0.5.1+) |
| `tsc --noEmit` | User's local | ✅ clean (0.5.1+) |
| `npm test` | User's local | ✅ **45/45 green** (0.6.2) — 40 unit/snapshot + 5 real-world fixture tests |
| `npm run test:update` | User's local | ✅ regenerates snapshots reliably (added 0.6.2) |
| `npm run smoke` | User's local | ⏳ requires both `npm run serve` AND ai-governance sidecar at :4900 — not yet exercised |
| Full platform Docker compose stack | User's local | ⏳ not yet exercised |
| `autoFix` with real Anthropic SDK | Anywhere | ⏳ requires `npm install @anthropic-ai/sdk` + `ANTHROPIC_API_KEY` |

## Pending re-runs on user's machine

After pulling the 0.5.1 patches:

```bash
npm install              # picks up @typescript-eslint v8 bump
npm run lint             # should be clean now
npm test -- -u           # FIRST run only — creates .snap files
npm test                 # subsequent runs — should be 40/40 green
```

## Known deferred items (explicit, not lost)

Phase 6 closed multi-window/tab semantics, custom-utility detection, comment-preservation primitives, and page-bag style. Remaining deferrals:

1. **Platform UI wizard** (Phase 0). Frontend work in `apps/platform-ui` — depends on the platform's existing component library; the Converter API surface it'll consume is locked.
2. **C# / SpecFlow implementation** (Phase 5, XL). Design doc only at `src/stretch/csharp/README.md`. Needs a real .NET dev environment.
3. **Performance profiling pass** (Phase 1, S). Needs a real 1k-file project to measure against.
4. **Generic types with multiple parameters** (Phase 1, S). `Map<String, List<Foo>>` currently passes through as-is.
5. **TestNG listeners → Playwright reporters** (Phase 2, S). Custom listener porting bespoke per project.
6. **Custom DTO `.d.ts` stubs** (Phase 3, S). Limited demand.
7. **Comment-preservation emitter pass** (Phase 6 partial). The primitives are in `commentPreserver.ts`; the emitter-side wiring (attach `findJavadocBeforeMethod` output to each method) is one focused PR.
8. **ESLint on output + surface in review** (Phase 3, S). `tsc` validation lands; ESLint over the generated output is the matching pass.
9. **`npx sel2pw analyze` works without install** (Phase 4, S). Verify `bin` + `files` in `package.json`.
10. **Pre-built binary via `pkg`/`@vercel/ncc`** (Phase 4, M). Targets users without Node — small audience for an internal tool.
11. **VS Code extension** (Phase 4, M). Useful but separate distribution concern.
12. **Marketing docs** (Phase 4, M each). Migration-playbook blog post, FAQ / Common Patterns cookbook.
13. **Telemetry** (Phase 4, S). Opt-in metrics on warnings — needs a hosted endpoint.
14. **Marketplace listing** (Phase 4, S). Post-1.0 comms work.
15. **Hosted web-service** (Phase 5, L). Standalone web demo — the platform-internal HTTP service already exists.

## What I'd do next, in priority order

1. **Re-run `npm install && npm run lint && npm test`** locally to confirm 0.5.1 patches land clean.
2. **`npm run smoke`** end-to-end (start the converter + ai-governance sidecar). This is the highest-value untested path right now.
3. **Run `node dist/cli.js convert` against a real legacy Selenium suite** you have — the bundled sample is comprehensive but small. Real codebases will exercise the AST fallback, the Hamcrest mapper, and the BaseTest extractor in ways the sample doesn't.
4. **Wire up an LLM callback into `src/stretch/autoFix.ts:patchFromFailure`** and try the convert → run → patch loop on the project from step 3. This is where sel2pw becomes "saves a month" rather than "saves a week".
5. **Decide on the standalone-vs-monorepo fold-in** (locked decision: standalone until Phase 1 stabilises, fold in after). Now that Phases 1–5 are complete the fold-in is unblocked.

## Files of interest

- [`README.md`](./README.md) — what it does, how to run, mapping table
- [`CHANGELOG.md`](./CHANGELOG.md) — full version history (0.1.0 → 0.5.1)
- [`PRODUCTION_TASKS.md`](./PRODUCTION_TASKS.md) — live task list with checkboxes (40 done, 18 pending)
- [`INTEGRATION.md`](./INTEGRATION.md) — platform integration architecture, gateway wiring, governance flow
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — local dev, pipeline architecture, how to add a new mapping
