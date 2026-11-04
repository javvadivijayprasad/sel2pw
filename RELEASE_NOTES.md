# sel2pw v2.1.1

A small patch whose main job is to put the **VS Code extension back in sync with the npm package**. The Marketplace extension (0.2.1) had been bundling engine 2.0.6; from this release both carry the same version and ship together, so the extension now includes everything in engine 2.1.x.

## Install

```bash
npx @vijaypjavvadi/sel2pw@2.1.1 convert ./my-selenium-project --out ./my-playwright-project
```

VS Code: install **sel2pw — Selenium to Playwright Converter** from the Marketplace (publisher `vijaypjavvadi`), or the `.vsix` attached to this release.

## Changed in 2.1.1

- VS Code extension version now equals the engine version (2.1.1) and bundles the engine built from this same commit.
- One release workflow with token-free publishing to npm and the Marketplace; `npm run preflight` runs exactly what CI runs. See `docs/RELEASING.md`.
- Source formatted with the project's Prettier config (no behaviour change).
- Citation uses the Zenodo concept DOI.

## Now in the extension (from engine 2.1.0)

- Stray `}` no longer left in `tests/fixtures.ts` (#26, @bfs2021).
- Correct output paths in `FILE_MAPPING.md` / `conversion-result.json` when a page object and a test share a name (#29, @bfs2021).
- `--dry-run --format=json` in the CLI (#27, @OKAN-SOFTWARE).
