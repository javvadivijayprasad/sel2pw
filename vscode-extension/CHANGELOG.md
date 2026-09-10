# sel2pw VS Code Extension — Changelog

## [0.2.0] — Sync with sel2pw 2.x (canonical Playwright layout, FILE_MAPPING, --dry-run preview, this.driver fix, Sauce Labs strip, Hamcrest ordering)

The bundled `@vijaypjavvadi/sel2pw` CLI dependency bumps from `^0.10.6` to `^2.0.6`. That pulls in every conversion-quality improvement from the v1.0.x → v2.0.6 npm release cycle:

### Bundled CLI improvements (from the sel2pw npm package)

- **Canonical Playwright output structure by default** (v2.0.0): output lands in `pages/`, `tests/fixtures.ts`, `types/enums.ts`, `types/errors.ts`, `data/models.ts` — matches the layout most Playwright projects use.
- **`FILE_MAPPING.md` emitted per conversion** (v2.0.1): human-readable table of source Java → output TS, grouped by status (converted / aggregated / skipped / stubbed). The "Analyze (dry run)" command now surfaces this table in the output panel.
- **`--dry-run` preview** (v2.0.4): the "Analyze" command now shows the full mapping preview inline instead of just a summary.
- **Selenium infrastructure correctly skipped** (v1.0.8): `DriverManager`, `BrowserFactory`, `TargetFactory` no longer emit broken translations — Playwright's `page` fixture replaces them.
- **Sauce Labs cloud APIs stripped** (v2.0.3): `SauceOptions`, `SauceSession`, `MutableCapabilities`, `RemoteWebDriver`, `driver.executeScript("sauce:...")` etc. now cleared from `@BeforeMethod` / `@AfterMethod` hooks instead of leaking as undefined symbols.
- **`this.driver.X` leak fix** (v2.0.5): the apiMap rewrite chain now normalises `this.driver` → `driver` first, so calls like `this.driver.get(url)` no longer produce `this.await this.page.goto(url)` syntax errors.
- **Hamcrest matcher ordering fix** (v2.0.6): `assertThat(items, hasItem("x"))` now correctly rewrites to `expect(items).toContain("x")` instead of leaking Hamcrest matcher calls into the output. Affects all Hamcrest 2-arg forms (`hasItem`, `hasSize`, `containsInAnyOrder`, `equalToIgnoringCase`, `greaterThan`, etc.).
- **Java enum / exception / record aggregation** (v2.0.0-v2.0.6): enums land in `types/enums.ts`, exceptions in `types/errors.ts`, records in `data/models.ts` — one shared file per kind instead of one file per source.
- **Page Object inheritance preserved** (v2.0.0): `class ChildPage extends ParentPage` now emits the TS equivalent with `super(page)` in the constructor. Infrastructure-named parents (DriverFactory etc.) are correctly excluded.
- **README migration-patterns reference** (v2.0.6): the sel2pw package's README now includes a 90-mapping categorised reference — useful when clicking through from the extension's Marketplace listing.

### Extension changes

- No source code changes — this is a dependency-refresh release. All existing commands (`Convert to Playwright`, `Analyze (dry run)`, `Open Conversion Review`) continue to work as before; they simply invoke a smarter converter underneath.
- Settings unchanged — no config migration required.

### Roadmap

- 0.3.0 — LLM fallback UI (Anthropic / OpenAI / Gemini, API keys via VS Code secret storage). Deferred from the original 0.2.0 slot; kept in the queue.
- 0.4.0 — Inline diff view for `--diff` mode.
- 0.5.0 — Conversion results tree view in the side panel.

---

## [0.1.0] — Initial release

First public release. Surfaces the `@vijaypjavvadi/sel2pw` CLI as VS Code commands.

### Features
- `sel2pw: Convert to Playwright` command — right-click any folder in the explorer or invoke from the command palette.
- `sel2pw: Analyze (dry run)` command — preview classifications without writing files.
- `sel2pw: Open Conversion Review` command — re-open `CONVERSION_REVIEW.md` and `MIGRATION_NOTES.md` side-by-side from a converted output folder.
- Settings under `sel2pw.*` for output suffix, Prettier formatting, tsc validation, self-healing shim, auth-setup emission.
- Output panel for analyze results.
- Progress notifications during conversion.

### Implementation
- TypeScript extension using the `vscode` API.
- Calls `@vijaypjavvadi/sel2pw` directly as a library — no shell-out, no Node version mismatch issues.
- Bundles the converter as a runtime dependency (~12 MB total extension size).

### Roadmap
- 0.2.0 — LLM fallback UI (Anthropic / OpenAI / Gemini, with API key entry from VS Code's secret storage).
- 0.3.0 — Inline diff view for `--diff` mode.
- 0.4.0 — Conversion results tree view in the side panel.
