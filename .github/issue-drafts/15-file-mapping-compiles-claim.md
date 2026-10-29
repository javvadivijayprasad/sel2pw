---
title: "docs(reports): FILE_MAPPING.md says converted files 'compile as-is', which is not checked"
labels: ["good first issue", "documentation"]
---

**What's wrong**

Every `FILE_MAPPING.md` has a **Converted** section that starts with:

> Java source had a 1:1 Playwright translation. Output file compiles as-is.

sel2pw does not check that. It only compiles the output when you pass `--validate`, and many converted files still have TypeScript errors to clean up. The README asks users to run `npx tsc --noEmit` for exactly this reason. So the sentence overclaims, and someone reading the report could trust it too much.

**Where to look**

`src/reports/fileMapping.ts`, around line 69: the `blurb` text for the `converted` section.

**What to do**

Replace the sentence with wording that says what actually happened, for example:

> Java source was translated to a Playwright TypeScript file. Run `npx tsc --noEmit` in the output folder to see whether it compiles, and check `CONVERSION_REVIEW.md` for anything that needs a manual fix.

Feel free to improve that wording. Keep it short and accurate.

**How to check**

```bash
npm install && npm run build
node dist/cli.js convert examples/selenium-testng-sample --out ./tmp-check --dry-run
```

The "Converted" section in the preview should show your new text.

**Done when**

- [ ] The blurb no longer claims the output compiles.
- [ ] `npm test` passes. If a snapshot test fails only because of this text, update it with `npm test -- -u` and mention that in your pull request.
- [ ] `npm run lint` passes.

---

**New here?** Comment on this issue to claim it, and we'll assign it to you. Setup takes about five minutes: see [CONTRIBUTING.md](https://github.com/javvadivijayprasad/sel2pw/blob/main/CONTRIBUTING.md). Questions are welcome in the comments, and no question is too small.
