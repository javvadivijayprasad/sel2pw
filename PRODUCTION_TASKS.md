# sel2pw — Production-Ready Task List

A roadmap from MVP scaffold (where we are) → 1.0 production release. Tasks are grouped into six phases. Phase 0 wires the Converter into the **modern-automation-platform** alongside `test-case-generation-service`, `self-healing-stage-services`, and `ai-governance` (see [INTEGRATION.md](./INTEGRATION.md)). Phases 1 and 2 are blockers for a credible 1.0; Phase 3 is the polish that makes adopters trust it; Phase 4 is distribution; Phase 5 is the bigger bets.

Effort scale: **S** = ~1 day, **M** = ~2–5 days, **L** = ~1–2 weeks, **XL** = ~3+ weeks.

---

## Phase 0 — Platform integration (make sel2pw a platform-citizen service)

**Goal:** the Converter is reachable via the platform gateway, honours the same governance config as the other services, returns the same provenance shape, and stores artifacts the same way. See [INTEGRATION.md](./INTEGRATION.md) for the architecture and API contract.

- [x] **Express HTTP service layer** (M). New `src/server.ts` with the seven endpoints from INTEGRATION.md (`/health`, `/analyze`, `/convert`, `/jobs/:id`, `/jobs/:id/artifact`, `/jobs/:id/review`, `/feedback`). Existing `convert()` from `src/index.ts` becomes the worker.
- [x] **Job runner with persistence** (M). SQLite (better-sqlite3) for status, mirroring how `modern-automation-platform` already persists framework-generation jobs. States: `queued → running → succeeded | failed`.
- [x] **Artifact storage abstraction** (S). `local` driver for dev, `s3` driver for prod, same interface as the platform's `packages/artifact-builder`.
- [x] **Provenance block in every response** (S). Match the shape returned by `test-case-generation-service`: `{ service, version, engine, rules_version, governance_config_hash, input_hash, started_at, duration_ms }`.
- [x] **`ai-governance` Python sidecar** (M). Add a `service/` module **inside the `ai-governance` repo itself** with a FastAPI app at `:4900` exposing `POST /sanitize` and `POST /audit` (thin wrappers around `GovernanceFilter`). Mirrors how `test-case-generation-service` and `self-healing-stage-services` already pair library code with a FastAPI service in the same repo. Ship a Docker image from there. Node services (incl. sel2pw) call it over HTTP; Python services keep importing the library directly.
- [x] **Honour `governance.config_url` in `/convert`** (S). Download → cache → pass into the pipeline; emit `governance_audit.json` next to `CONVERSION_REVIEW.md`.
- [x] **Gateway routes** (S). Add `apps/framework-generator-api/src/routes/converter.routes.ts` to `modern-automation-platform`; mount at `/api/v1/converter`. Apply the same auth, rate limit, quota middleware the other two services use. Env: `CONVERTER_BASE_URL=http://localhost:4200`.
- [x] **Webhook delivery on job completion** (S). POST to `callback_url` from the convert request; signed payload; reuse the platform's webhook helper.
- [x] **`--emit-self-healing-shim` AST option** (M). When set, locator fields are emitted via `healOrThrow(page, { preferred, context })` from a thin `@platform/sdk-self-healing` runtime client, so converted suites integrate with `self-healing-stage-services` automatically.
- [x] **Shared types** (S). Add `ConverterJob`, `ConverterStats`, `ConverterReviewItem`, `ConverterProvenance` to the platform's `packages/shared-types` so the gateway, UI, and service all compile against the same shapes.
- [x] **Dockerfile + docker-compose** (S). Multi-stage build (Node 20-alpine), exposes 4200, plus an entry in the platform's docker-compose.dev.yml so `docker compose up` brings the whole stack including sel2pw.
- [x] **Health/readiness endpoint plumbed into the platform service registry** (S). Match the pattern that `self-healing-stage-services` uses.
- [ ] **UI: a "Migrate Selenium → Playwright" wizard** (M). Frontend work in `apps/platform-ui` — upload zip / paste git URL → progress bar reading job status → download zip + render `CONVERSION_REVIEW.md`.
- [x] **Cross-service smoke test** (S). End-to-end Playwright test against the platform: upload sample → poll job → download zip → assert files present. Lives in the platform's e2e suite.

---

## Phase 1 — Hardening (the regex extractor is brittle, fix that first)

**Goal:** the conversion engine is robust enough to run unattended against real-world codebases without crashing or silently producing garbage.

- [x] **Replace regex extractor with a real Java AST parser** (L). Swap `src/parser/javaExtractor.ts` for `java-parser` (npm, Chevrotain-based) and walk the CST. The IR boundary in `types.ts` is already the right shape — the rest of the pipeline shouldn't change.
- [x] **Handle nested classes, anonymous classes, lambdas** (M). Today's extractor assumes one top-level class per file and gets confused by inner `new Runnable() { … }` blocks.
- [ ] **Generic types with multiple parameters** (S). `Map<String, List<Foo>>` currently breaks the type translator.
- [x] **Unit tests for every transformer** (M). Vitest is already configured. Each rewrite in `apiMap.ts` / `assertionMap.ts` / `locatorMapper.ts` needs at least 3 cases: simple, edge, "should-not-match" (false positive guard).
- [x] **Snapshot tests for emitter output** (M). Lock down generated TS for the bundled sample + 4–5 additional representative shapes (Page Factory, multiple page objects, lifecycle on superclass, parameterised tests, etc.).
- [x] **Round-trip test fixtures** (M). Build a `tests/fixtures/` tree of paired `input.java` / `expected-output.ts` files; the test runner does the conversion and diffs against expected.
- [x] **Error recovery** (S). When a single file fails to parse, log it and continue — never abort the whole conversion.
- [x] **Structured logging** (S). Replace `chalk` console output with a real logger (pino) so CI can ingest JSON.
- [ ] **Performance pass** (S). Profile against a 1k-file project; cache regex compilation; ensure scanner is async-parallel.
- [x] **ESLint + Prettier on the converter codebase** (S).
- [x] **`tsc --noEmit` strict mode passes with zero warnings** (S).

## Phase 2 — Coverage gaps (auto-convert the things currently flagged for manual review)

**Goal:** drastically reduce the size of `CONVERSION_REVIEW.md` for typical projects.

- [x] **`@DataProvider` → parameterised tests** (M). Detect `@DataProvider` methods, extract the returned `Object[][]`, emit a `for (const row of rows()) { test('name ' + row[0], …) }` loop.
- [x] **BaseTest → Playwright fixture** (L). Extract shared setup/teardown into `tests/fixtures.ts` with extended `test` export. Recognise the common patterns: WebDriver creation, login helpers, test data factories.
- [x] **`testng.xml` → Playwright projects** (M). Suite definitions, parallel mode, groups → playwright.config.ts `projects` + `grep` tags.
- [x] **Selenium `Actions` chains** (M). `Actions(driver).moveToElement(el).click().perform()` → `await locator.hover(); await locator.click();`
- [x] **`JavascriptExecutor.executeScript(...)`** (S). Map to `await page.evaluate(() => …)`, including the args-passing pattern.
- [x] **iframe `switchTo().frame(...)`** (M). Track frame context across statements; rewrite subsequent locator chains to `frameLocator(...)`.
- [x] **Alert / dialog handling** (S). Detect `switchTo().alert()` and emit `page.on('dialog', d => d.accept())` with placement guidance.
- [x] **File upload / download** (S). `sendKeys(filePath)` on `<input type=file>` → `setInputFiles(filePath)`; download patterns → `page.waitForEvent('download')`.
- [x] **Cookies, local storage, session** (S). Map driver cookie APIs to `context.cookies()` / `context.addCookies()`.
- [x] **Multiple windows/tabs** (M). `driver.getWindowHandles()` / `switchTo().window(...)` → `context.on('page', …)` + `pages[]`.
- [x] **Hamcrest matchers** (M). `assertThat(actual, hasItem(...))`, `containsInAnyOrder`, `equalToIgnoringCase` — common patterns, mappable to `expect()` matchers.
- [x] **JUnit (in addition to TestNG)** (S). `@Before`, `@After`, `@BeforeAll`, `@AfterAll`, JUnit `Assert.*` are mostly trivial.
- [x] **Custom WebDriver utility classes** (M). Detect `DriverFactory`, `DriverManager`, custom `Wait` helpers — strip them and emit a "removed by sel2pw" stub the user can grep for.
- [x] **Property files → `.env`** (S). Convert `config.properties` to `.env` with a tiny loader emitted into `tests/config.ts`.
- [ ] **TestNG listeners → Playwright reporters** (S). Emit a stub reporter for common listener patterns; flag custom ones.

## Phase 3 — Output quality (make adopters love it)

**Goal:** the generated project compiles green, lints clean, and reads like code a Playwright dev would have written.

- [x] **Run Prettier on every generated file** (S). Currently we hand-format; that's brittle. Pipe through prettier with the user's config if present.
- [ ] **Run ESLint on output and surface any warnings in the review report** (S).
- [x] **`tsc --noEmit` on the generated project as part of the pipeline** (S). Block the `convert` command from claiming success if the output doesn't typecheck (with a `--no-validate` escape hatch).
- [x] **Preserve Javadoc and inline `//` comments** (M). Carry comments through into the TS output, attached to the right method.
- [x] **TODO markers at unconverted spots** (S). Wherever bodyTransformer raises a `manual` warning, leave a `// TODO(sel2pw): …` comment in the output, so the user finds it without cross-referencing the report.
- [x] **Generate `auth.setup.ts` from login Page Objects** (M). Recognise the "log in once, save state" pattern and emit a Playwright [storageState](https://playwright.dev/docs/auth) setup file.
- [x] **Page Object factory option** (S). `--pom-style=factory` emits a single bag exposing all pages so tests do `pages.login.x()` instead of newing each one.
- [ ] **Better TS types for params** (S). Today we map `String → string` etc., but custom DTOs pass through unchanged — add an option to generate `.d.ts` stubs for them.
- [x] **Diff mode** (S). `sel2pw convert --diff` shows what *would* change without writing files.
- [x] **Migration report** (S). Beyond `CONVERSION_REVIEW.md`, emit `MIGRATION_NOTES.md` with the full list of removed/replaced dependencies, what to delete from `pom.xml`, and a copy-paste `npm install` command.

## Phase 4 — Distribution & operational concerns

**Goal:** people can `npm install -g sel2pw` and trust the tool.

- [x] **GitHub repo + license** (S). MIT license file, CONTRIBUTING.md, CODE_OF_CONDUCT.md.
- [x] **CI: GitHub Actions** (S). Matrix run on Node 18/20/22, on Ubuntu/macOS/Windows. Steps: install, lint, build, vitest, snapshot diff.
- [x] **Coverage gate** (S). Codecov or similar; fail PR if coverage drops below ~80%.
- [x] **Release workflow** (S). Tag → `npm publish` with provenance.
- [x] **Semantic versioning + CHANGELOG** (S). Use Changesets or release-please.
- [x] **Dependency security** (S). Dependabot + CodeQL workflows.
- [ ] **`npx sel2pw analyze` works without install** (S). Make sure `bin/` and `files` in package.json are right.
- [x] **Docker image** (S). Optional but useful for CI users — `docker run sel2pw …`.
- [ ] **Pre-built binary via `pkg` or `@vercel/ncc`** (M). Single-file binary for users without Node.
- [ ] **VS Code extension wrapper** (M). Right-click a Java test file → "Convert to Playwright". Calls the CLI under the hood.
- [x] **API reference docs (typedoc)** (S). For users consuming `convert()` programmatically.
- [ ] **Migration playbook / blog post** (M). End-to-end walkthrough on a real open-source project — most credible adoption signal.
- [ ] **FAQ / Common Patterns cookbook** (M). "How do I migrate XYZ pattern?" with input + output examples.

## Phase 5 — Stretch (the parts that make this 10× more interesting)

- [x] **BDD: Cucumber `.feature` + Java step defs → `playwright-bdd`** (XL). Phase 0.2 in the README. Step definitions are functions with `@Given/@When/@Then` annotations — the conversion is similar to test methods, but the real work is the [playwright-bdd](https://github.com/vitalets/playwright-bdd) integration.
- [x] **C# / SpecFlow support** (XL). Roslyn-based parser sidecar OR LLM-based extractor. SpecFlow ↔ playwright-bdd is a relatively clean mapping.
- [x] **Auto-fix loop** (XL). Run the generated Playwright tests headlessly, capture failures, feed each failure (with the original Java code, the converted TS, and the failure trace) into an LLM with surgical-edit instructions, re-run, iterate. This is the killer feature — turns "skeleton + manual cleanup" into "actually green tests on first run".
- [x] **Hybrid AST + LLM engine** (L). For helpers and utility classes the AST can't map (custom waits, `DriverFactory`, parameter resolvers), fall through to an LLM with the function's source + the project's other converted files as context. Keep AST for the deterministic 80%.
- [ ] **Web service: upload zip → download converted project** (L). Hosted demo at sel2pw.dev. Sandboxed conversion. Auth optional. Most accessible path for non-developers.
- [x] **Behaviour parity verifier** (XL). Run both the original Selenium tests and the converted Playwright tests against the same target app, compare pass/fail and screenshots, surface divergences. The strongest possible "did this conversion break anything" signal.
- [ ] **Telemetry (opt-in)** (S). Anonymous metrics on which warnings fire most often → guides which gaps to close next.
- [ ] **Marketplace listing** (S). After Phase 4, list on the [Playwright community tools](https://playwright.dev/docs/test-cli) page.

---

## Sequencing rationale

If you can only afford one phase before showing this to teams, do **Phase 1**. The regex extractor is genuinely the weakest link — every other improvement compounds on it. Phase 2 is the obvious next step once the foundation is solid. Phase 3 is what makes the difference between "this saved me a week" and "this saved me a month." Phase 4 is mechanical. Phase 5 is where it goes from a useful tool to a category-defining one.

A reasonable 1.0 release: Phase 1 (all) + Phase 2 (DataProvider, BaseTest, Actions, executeScript, iframe, alert) + Phase 3 (Prettier, tsc validate, TODO markers) + Phase 4 (CI, semver, README polish). That's roughly 6–8 weeks of focused work.
