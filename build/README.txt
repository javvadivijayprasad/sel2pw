sel2pw — Selenium Java/TestNG -> Playwright TypeScript Converter
================================================================

This bundle contains:

  sel2pw.exe          - the converter, single-file executable (no Node install needed)
  run.bat             - convenience wrapper for Windows users
  sel2pw.config.yaml  - sample configuration; copy and edit, OR use env vars
  README.txt          - this file

Quick start
-----------

Windows:
  run.bat C:\projects\my-selenium-suite

Or directly:
  sel2pw.exe convert C:\projects\my-selenium-suite --out C:\projects\my-playwright-suite

The output directory will contain:
  pages\<name>.page.ts            converted Page Objects
  tests\<name>.spec.ts            converted spec files
  tests\fixtures.ts               (if your project had a BaseTest superclass)
  tests\_legacy-stubs\            typed stubs for utilities sel2pw can't fully translate
  CONVERSION_REVIEW.md            line-by-line review punch list
  MIGRATION_NOTES.md              pom.xml deletions, CI changes, parity playbook
  conversion-result.json          structured per-file outcome (for scripting)
  package.json + playwright.config.ts + tsconfig.json   ready-to-run Playwright project

After conversion, finish the migration:
  cd <output>
  npm install
  npx playwright install
  npx playwright test

Three things to expect
----------------------

1. Most conversion is automatic. By the 0.10 release sel2pw handles the common
   90% of Selenium TestNG/JUnit code shapes — Page Objects, lifecycle hooks,
   assertions, locators, Cucumber step defs, custom utility detection.

2. Some files need a manual port. CONVERSION_REVIEW.md groups every item by
   file and severity:
     - manual    you must rewrite this section
     - warning   converted; please double-check semantics
     - info      heads-up about a non-trivial mapping (e.g. WebDriverWait removed)

3. Some files become typed stubs. ExcelReader, DriverFactory, ExtentReporter
   etc. don't have 1:1 Playwright equivalents — sel2pw generates a stub at
   tests\_legacy-stubs\<name>.ts whose file header documents how to migrate
   each call site to a Playwright primitive (xlsx, fixtures, the built-in
   HTML reporter, etc.).

LLM fallback (optional)
-----------------------

For files the AST pipeline can't classify, sel2pw can call an LLM to attempt
a translation. Pick a provider and supply the API key:

  set ANTHROPIC_API_KEY=sk-ant-...
  sel2pw.exe convert <input> --out <output> --llm-fallback

Supported providers: anthropic (default), openai, gemini.
See sel2pw.config.yaml for the full option list.

Telemetry (local-only by default)
---------------------------------

sel2pw records every parse error / unknown classification / manual review
item to a local SQLite database (.sel2pw/telemetry.db) so you can run:

  sel2pw.exe report-failures
  sel2pw.exe report-patterns
  sel2pw.exe report-stats

across multiple conversion runs to see which patterns recur. Source content
never leaves your machine unless you explicitly run:

  sel2pw.exe telemetry-share --endpoint <url>

which uploads only pattern hashes + counts (no source, no paths, no errors).

Documentation
-------------

  GitHub:           https://github.com/<org>/Converter
  Issues:           https://github.com/<org>/Converter/issues
  Deployment guide: docs/Sel2pw_Deployment_Guide.md

Built from sel2pw v0.10.0.
