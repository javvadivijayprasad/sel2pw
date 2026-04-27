# Contributing to sel2pw

Thanks for considering a contribution. The fastest way to land a useful PR is to start small — adding a single new transformer rule with a unit test is a great first issue.

## Local development

```bash
npm install
npm run build
npm test
npm run lint
```

The bundled sample project at `examples/selenium-testng-sample/` is the canonical end-to-end fixture. After any change to a transformer or emitter, run:

```bash
npm run convert:sample
```

and inspect the output under `examples/output-playwright/`. Snapshot tests will tell you about regressions; if your change is intentional, run `npm test -- -u` to update them.

## How the pipeline is organised

```
src/
  scanner/    — find + classify .java files
  parser/     — Java source → IR (javaAst.ts is canonical, javaExtractor.ts is regex fallback)
  transformers/ — IR + raw Java body → TS source fragments
  emitters/   — IR → ConvertedFile (page object, test class, fixture, project scaffold)
  post/       — Prettier, tsc validate, TODO markers, auth.setup.ts
  reports/    — CONVERSION_REVIEW.md, MIGRATION_NOTES.md
  server/     — HTTP service (Express, jobs, artifacts, governance, webhooks)
  utils/      — logger, indent helper, naming
```

Transformers should be **pure** (`(input) → output + warnings`). Emitters compose transformer outputs into TS source. Side effects (fs, network, child_process) live in `post/` and `server/` only.

## Adding a new Selenium → Playwright mapping

1. Decide whether it's a "basic" mapping (regex over a single statement: `apiMap.ts`) or "advanced" (cross-line, context-sensitive: `advancedApiMap.ts`).
2. Add the rule with a comment explaining the source/target shapes.
3. Add a unit test under `tests/transformers/` — at least one happy case, one edge case, one false-positive guard.
4. If the new mapping affects the bundled sample's output, regenerate the snapshot with `npm test -- -u`.
5. Update [`PRODUCTION_TASKS.md`](./PRODUCTION_TASKS.md) and [`CHANGELOG.md`](./CHANGELOG.md).

## Reporting bugs

Include:

- The Java source that didn't convert correctly (minimised to under 30 lines).
- The actual output (or the error).
- The expected output (in TS).

We'll add it to the fixtures suite once fixed.

## Releasing

Releases are tagged via Changesets:

```bash
npx changeset            # describe the change
npx changeset version    # bumps versions
git commit -am "release"
git tag vX.Y.Z
git push --tags          # triggers npm publish workflow
```

## Style

- TypeScript strict mode.
- ESLint + Prettier — `npm run format` before pushing.
- No bare `any`. Use `unknown` and narrow with type guards.
- Keep functions small and pure where possible. The pipeline is testable because transformer/emitter modules don't touch the filesystem.
