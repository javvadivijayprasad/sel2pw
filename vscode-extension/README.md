# sel2pw — Selenium to Playwright Converter (VS Code)

Convert legacy Selenium Java/TestNG/BDD test suites to Playwright TypeScript directly from VS Code. Right-click a folder, hit **sel2pw: Convert to Playwright**, and get a complete Playwright project plus a markdown review of everything that needs human attention.

Powered by [`@vijaypjavvadi/sel2pw`](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw) — validated against 15 real-world OSS Selenium repositories with zero failed conversions across 409 Java files.

## Features

- **Right-click → Convert** in the explorer context menu. Works on any folder containing a Selenium project.
- **Right-click → Analyze** for a dry run that shows what would convert without writing files.
- **Open Conversion Review** to revisit `CONVERSION_REVIEW.md` and `MIGRATION_NOTES.md` from a previous conversion.
- **Detects**: Selenium Java + TestNG, Selenium Java + Cucumber BDD, Selenium C# + NUnit, Selenium C# + SpecFlow.
- **Configurable**: Prettier formatting, `tsc --noEmit` validation, self-healing locator shim, auth.setup.ts generation — all toggleable in settings.

## What it converts

| Selenium / TestNG | Playwright TypeScript |
| --- | --- |
| `By.id("x")` / `@FindBy` | `page.locator('#x')` / `Locator` field |
| `el.click()` / `.sendKeys()` | `await el.click()` / `.fill()` |
| `WebDriverWait...until(...)` | _removed — Playwright auto-waits_ |
| `Assert.assertEquals(a, b)` | `expect(a).toBe(b)` |
| `@Test` / `@BeforeMethod` | `test()` / `test.beforeEach()` |
| `@DataProvider` parameterised tests | typed `for` loop with `test()` inside |
| `BaseTest` superclass | `tests/fixtures.ts` Playwright fixture extension |
| `testng.xml` | `playwright.config.ts` projects with `grep` |
| `*.properties` config | `.env.example` + typed `tests/config.ts` loader |

Non-translatable utility classes (`DriverFactory`, `WaitUtils`, ExtentReports listeners, custom Excel readers, etc.) are auto-stubbed with one-paragraph migration recipes in each stub's file header.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `sel2pw.outputSuffix` | `-playwright` | Suffix appended to source folder name to derive output folder |
| `sel2pw.format` | `true` | Run Prettier over output |
| `sel2pw.validate` | `true` | Run `tsc --noEmit` over output, surface errors in review |
| `sel2pw.emitSelfHealingShim` | `false` | Wrap locators in `healOrThrow()` for runtime self-healing |
| `sel2pw.emitAuthSetup` | `true` | Generate `tests/auth.setup.ts` when LoginPage detected |
| `sel2pw.cliPath` | `""` | Override path to sel2pw CLI; leave empty to use bundled package |

## Requirements

- VS Code 1.85.0 or later
- Node.js 18+ available on the system (the extension uses the bundled `@vijaypjavvadi/sel2pw` package)

## Known limitations

- Page Object Model conventions: classes are picked up by name patterns (`*Page`, `*Section`, `*Component`). Non-conforming names need a rename pass first.
- Generic types with multiple parameters (`Map<String, List<Foo>>`) currently pass through as-is — flagged in the review report for manual correction.
- LLM fallback (Anthropic / OpenAI / Gemini) for unclassifiable files is available in the CLI but not yet exposed in this extension's UI. Coming in 0.2.0.

## Reporting issues

[GitHub issues](https://github.com/javvadivijayprasad/sel2pw/issues). When reporting a conversion bug, include:

1. The Java source file that didn't convert as expected.
2. The relevant entry from `conversion-result.json`.
3. The expected output.

We patch about one bug per real-world codebase tried — your codebase could be the next round of patches.

## License

MIT.
