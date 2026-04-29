# sel2pw VS Code Extension — Changelog

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
