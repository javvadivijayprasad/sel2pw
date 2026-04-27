# C# / SpecFlow / NUnit support — design

This directory will hold the C# source-side parser and converter when Phase 5 lands the second-language path. It's not implemented yet; this README locks the design choices so when work starts it doesn't bikeshed.

## Approach

Roslyn (`Microsoft.CodeAnalysis.CSharp`) is the only sane Source-side parser for C# — robust, official, used by Visual Studio. We don't try to bind it from Node. Instead:

- A small **.NET sidecar** at `services/csharp-parser/` (separate repo or, eventually, a sibling to `ai-governance`'s sidecar) exposes `POST /parse` accepting C# source and returning the same IR shape sel2pw uses today (`PageObjectIR`, `TestClassIR`).
- Node-side `src/stretch/csharp/parserClient.ts` calls the sidecar and feeds the IR into the existing emitter pipeline. The transformers + emitters already operate on the IR, so no other module changes.

This mirrors the pattern we use for `ai-governance`: Python lib lives in its native repo with a thin HTTP shell. Same for C#: Roslyn lives in .NET.

## Source frameworks covered

| C# framework | Approximate .NET version | Maps to |
| --- | --- | --- |
| Selenium WebDriver (`OpenQA.Selenium`) | any | Same Selenium → Playwright mappings |
| NUnit (`[Test]`, `[SetUp]`, `[TearDown]`) | any | TestNG-flavoured lifecycle in IR |
| MSTest (`[TestMethod]`, `[TestInitialize]`) | any | TestNG-flavoured lifecycle in IR |
| xUnit (`[Fact]`, `[Theory]`) | 2+ | TestNG-flavoured + parameterised tests |
| SpecFlow (`[Given]`, `[When]`, `[Then]`) | 3+ | playwright-bdd (same as Cucumber path) |

## C#-specific quirks the converter must handle

- **PascalCase methods.** Lowercase Java naming convention assumptions need to be relaxed — e.g. C# `LoginButton.Click()` should become TS `loginButton.click()`.
- **Property syntax.** `element.Text` instead of `element.GetText()` — needs an extra rewrite rule.
- **`async`/`await` already in source.** Tests written against modern WebDriver (.NET) often already use async; the conversion is partly cosmetic in those cases.
- **`ChromeDriver` defaults via `WebDriverManager`-equivalent (`Selenium.WebDriver.ChromeDriver` NuGet).** Strip from BaseTest equivalents.

## Current status

Not started. This README is the design spec. Implementation tasks:

1. Stand up a .NET 8 minimal-API project at `services/csharp-parser/`.
2. Implement `POST /parse` returning the existing `PageObjectIR` / `TestClassIR` shape.
3. Add `src/stretch/csharp/parserClient.ts` (Node client).
4. Extend `apiMap.ts` with C#-specific patterns (Property syntax, Pascal→camel rewrites).
5. Add `--lang=csharp` flag to the CLI and HTTP service.

Estimated effort: XL (4+ weeks for a working MVP).
