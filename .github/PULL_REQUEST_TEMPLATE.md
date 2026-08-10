## What does this PR do?

<!-- One or two sentences. What behavior changes? What bug does it fix? -->

## Why?

<!-- Link the issue this closes, or briefly explain the motivation. -->

Closes #

## How was this tested?

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] `npm test` (vitest) passes locally
- [ ] `npm run lint` passes
- [ ] For transformer/emitter changes: added a unit test in `tests/` covering the new behavior
- [ ] For end-to-end changes: ran `npm run convert:sample` and inspected the diff in `examples/output-playwright/`
- [ ] For regressions in real repos: validated against at least one bundled fixture in `examples/validation-batch-v2/sources/`

## Checklist

- [ ] `CHANGELOG.md` updated with a new entry describing the change (under a new version heading if this is a release, or under "Unreleased" if not)
- [ ] Public API changes (types, CLI flags, `conversion-result.json` schema) are additive OR flagged as a breaking change with rationale
- [ ] No secrets, API keys, or absolute paths that leak usernames are checked in

## Screenshots / snippets (optional)

<!-- If the change alters emitted output, paste the before/after TS snippet. -->

**Before:**
```typescript
```

**After:**
```typescript
```
