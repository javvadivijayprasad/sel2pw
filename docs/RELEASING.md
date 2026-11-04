# Releasing

One version number, one workflow, one tag.

A release is the tag `vX.Y.Z`. The version lives in one place, the root `package.json`; everything else is copied from it. It ships `@vijaypjavvadi/sel2pw` to npm, the `sel2pw-vscode` extension to the VS Code Marketplace, and a GitHub release (which Zenodo archives), all from `.github/workflows/release.yml`. The tag, `package.json` and `vscode-extension/package.json` must carry the same number; the workflow refuses a tag that does not match both. The extension is packaged with the engine built from the same commit, so the Marketplace build always bundles exactly the npm version released with it.

## Each release

From the repository root (`E:\EB1A_Research\Application\Converter`):

```
npm run preflight                        1. exactly what CI checks: format, lint, typecheck, build, test

npm version patch --no-git-tag-version  2. bump the version (patch / minor / major, or e.g. 2.2.0).
                                            package.json is the one source of truth; npm's `version`
                                            hook runs scripts/sync-version.js, which copies it into
                                            vscode-extension/package.json, both lock files and
                                            CITATION.cff (version + today's date).
                                         then by hand: CHANGELOG.md, vscode-extension/CHANGELOG.md,
                                            RELEASE_NOTES.md (the GitHub release body)

git add <the files above, by name>       3. never `git add -A`
git commit -m "chore(release): vX.Y.Z — <title>"
git push                                    -> the check job runs on main (Windows + Ubuntu); wait for green

git tag vX.Y.Z
git push origin vX.Y.Z                   4. -> check, then publish: npm, Marketplace, GitHub release, Zenodo
```

Then check: `npm view @vijaypjavvadi/sel2pw version`; the Marketplace page shows the new version; the GitHub release exists with the `.vsix` attached; Zenodo has a new version under the concept DOI. Nothing in the repo needs editing afterwards: `CITATION.cff` and the README use the concept DOI.

Keep the CHANGELOG section and `RELEASE_NOTES.md` saying the same thing.

## Dry run

Actions → release → **Run workflow** (dry run ticked by default): runs every check and packages the `.vsix` (downloadable as an artifact) but publishes nothing.

## Rules that save a release

- **Run `preflight` before every commit to main.** It is the same list CI runs. `format:check` is part of it: format with `npm run format` (the project's pinned Prettier), never a bare `npx prettier`.
- **Push the tag only after the commit it points at is green on main.** To move a tag: `git tag -d vX.Y.Z; git push origin :refs/tags/vX.Y.Z`, then tag again.
- **Re-running a failed release is safe.** Each publish step checks first and skips if that version is already out. Fix the cause and use *Re-run failed jobs*.
- **A published npm version cannot be replaced.** If a release is broken, publish a fixed PATCH and `npm deprecate @vijaypjavvadi/sel2pw@X.Y.Z "broken; use X.Y.Z+1"`.
- **Commit release files by name.** On Windows, `git status` lists many files that only differ in line endings.

## Credentials (set once, never in the repo)

- **npm: trusted publishing, no token.** npmjs.com → `@vijaypjavvadi/sel2pw` → Settings → Trusted Publisher → GitHub Actions: owner `javvadivijayprasad`, repository `sel2pw`, workflow `release.yml`, environment blank, **Allow npm publish** ticked. No `NPM_TOKEN` secret and no `NODE_AUTH_TOKEN` (with a token present, npm prefers it and fails with EOTP).
- **Marketplace: trusted publishing, no token.** marketplace.visualstudio.com/manage → publisher `vijaypjavvadi` → *Trusted Publishing* → Create: policy name `sel2pwReleaseWorkflow`, provider GitHub Actions, owner `javvadivijayprasad`, repository `sel2pw`, workflow `release.yml`, environment blank. The workflow runs `vsce publish --oidc` (vsce 4.1+). No `VSCE_PAT`.
- **GitHub release:** the workflow's own token.
- **Zenodo:** zenodo.org → GitHub → the switch for `sel2pw` is on. Concept DOI: `10.5281/zenodo.20450292`.

If a publish step fails on credentials, the manual fallback from your machine is `npm publish --access public` in the repo root, or in `vscode-extension/`: `npx @vscode/vsce@4.1.0 package` then `npx @vscode/vsce@4.1.0 publish --packagePath sel2pw-vscode-X.Y.Z.vsix` after `npx @vscode/vsce login vijaypjavvadi`. Then *Re-run failed jobs* so the remaining steps complete.

## Version bumps

Semantic versioning. New CLI option or feature: MINOR. Fixes, docs, tests, release tooling: PATCH. Removing or changing an option, the `conversion-result.json` schema, or output layout: MAJOR.
