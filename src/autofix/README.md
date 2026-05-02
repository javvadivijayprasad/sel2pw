# `src/autofix/` — v2.0 auto-fix loop (in development)

This directory contains the v2.0 iterative auto-fix loop — the centerpiece feature that closes the gap between v1.x's "skeleton + manual cleanup" output and a Playwright project that compiles cleanly.

**Status:** spike phase. Foundation component (`tscRunner.ts`) implemented; rest are TODO.

See `docs/ROADMAP_V2.md` Theme 1 for the full design.

## Components

| Component | File | Status |
| --- | --- | --- |
| TS error capture | `tscRunner.ts` | ✅ done (this PR) |
| Error grouping | `errorGrouper.ts` | ⏳ TODO |
| LLM patch generator | `patchGenerator.ts` | ⏳ TODO |
| Patch applier (with rollback) | `patchApplier.ts` | ⏳ TODO |
| Iteration budget / cost gates | `budget.ts` | ⏳ TODO |
| Convergence / fixed-point detection | `convergence.ts` | ⏳ TODO |
| Runtime phase (Playwright failures) | `runtimeRunner.ts` | ⏳ TODO |

## Spike target

The spike validates the architecture against **selenium14** (the hardest case in the v1.0 validation matrix — 2,894 TS errors after rule-based conversion). Acceptance: the auto-fix loop reduces selenium14's TS error count to ≤ 100, with cost ≤ $5 USD in LLM tokens, in ≤ 15 minutes wall-clock.

If the spike succeeds, the architecture is committed and the remaining components get built. If it fails (cost too high, convergence too slow, or quality regression), we re-design before sinking 12 weeks into a full implementation.

## Standalone usage (today)

`tscRunner.ts` is usable on its own as a diagnostic tool:

```typescript
import { runTsc, summariseTscRun } from '@vijaypjavvadi/sel2pw/autofix/tscRunner';

const result = await runTsc('/path/to/converted-project');
console.log(summariseTscRun(result));
// {
//   totalErrors: 2894,
//   uniqueFiles: 14,
//   byCode: { TS1005: 412, TS2304: 380, ... },
//   topFiles: [{ relPath: 'pages/web-ui.page.ts', errorCount: 1340 }, ...]
// }
```

Useful for sanity-checking that a freshly-converted project's error pattern matches what the audit script reported.
