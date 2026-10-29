---
title: "fix(reports): FILE_MAPPING.md shows the wrong output file when a page object and a test share a name (LoginPage / LoginTest)"
labels: ["bug", "good first issue"]
---

**What's wrong**

The converted files are correct, but the reports sometimes say a test class went to the page-object file. Run a dry run on the bundled sample:

```bash
npm install && npm run build
node dist/cli.js convert examples/selenium-testng-sample --out ./tmp-check --dry-run
```

The File Mapping table shows:

```
| src/test/java/com/example/pages/LoginPage.java | → | pages/login.page.ts | page-object |
| src/test/java/com/example/tests/LoginTest.java | → | pages/login.page.ts | test-class |   <-- wrong
```

`LoginTest.java` actually becomes `tests/login.spec.ts`, and that file is written correctly. Only the report is wrong. The same wrong path appears in `FILE_MAPPING.md` and `conversion-result.json`, because both are built from the same data.

**Why it happens**

In `src/reports/conversionResult.ts`, `buildConversionResult()` indexes the emitted files in a `Map` keyed only by the name stem. It strips `.page` and `.spec` first, so `pages/login.page.ts` and `tests/login.spec.ts` both get the key `login`, and whichever is added last overwrites the other. Then `fileOutcomeFor()` looks up `login` for both `LoginPage` and `LoginTest`, and both get the same file. Because it depends on the order of the files, the wrong one can change between runs.

**Where to look**

- `src/reports/conversionResult.ts`: the `convertedByStem` map (around line 97) and the lookup in `fileOutcomeFor()` (around line 161).

One simple fix is to keep the suffix in the key: use `login.page` for page objects and `login.spec` for test classes, and look up `${stem}.page` or `${stem}.spec` based on `file.kind`. Keep `fixtures` working for base classes.

**Done when**

- [ ] The dry run above shows `LoginTest.java → tests/login.spec.ts`.
- [ ] A unit test covers a page object and a test class that share a stem, and checks that each maps to its own file.
- [ ] `npm test` and `npm run lint` pass.
- [ ] Bonus: in `tests/cli/dryRunFormat.test.ts` (added in #27), the parity test currently ignores the `output` field because of this bug. Once fixed, remove that workaround so the test compares `output` too.

---

**New here?** Comment on this issue to claim it, and we'll assign it to you. Setup takes about five minutes: see [CONTRIBUTING.md](https://github.com/javvadivijayprasad/sel2pw/blob/main/CONTRIBUTING.md). Questions are welcome in the comments, and no question is too small.
