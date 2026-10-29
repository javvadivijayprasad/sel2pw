import { describe, expect, it } from "vitest";
import {
  buildConversionResult,
  BuildResultArgs,
} from "../../src/reports/conversionResult";
import { ConvertedFile, JavaFile } from "../../src/types";

function javaFile(
  className: string,
  kind: JavaFile["kind"],
  relPath: string,
): JavaFile {
  return {
    path: `C:/src/${relPath}`,
    relPath,
    packageName: "com.example",
    className,
    source: "class X {}",
    kind,
  };
}

function converted(relPath: string, kind: ConvertedFile["kind"]): ConvertedFile {
  return { relPath, source: "// generated", warnings: [], kind };
}

function buildArgs(
  scannedFiles: JavaFile[],
  convertedFiles: ConvertedFile[],
): BuildResultArgs {
  return {
    inputDir: "in",
    outputDir: "out",
    sourceStack: "selenium-testng",
    scannedFiles,
    convertedFiles,
    warnings: [],
    summary: {
      inputDir: "in",
      outputDir: "out",
      filesScanned: scannedFiles.length,
      pageObjectsConverted: 0,
      testClassesConverted: 0,
      testMethodsConverted: 0,
      warnings: [],
    },
  };
}

describe("buildConversionResult file mapping", () => {
  it("keeps page objects and test classes apart when their stems collide", () => {
    const scanned = [
      javaFile("LoginPage", "page-object", "src/pages/LoginPage.java"),
      javaFile("LoginTest", "test-class", "src/tests/LoginTest.java"),
    ];
    // Page object emitted last: the old stem-only index resolved both files
    // to this one, depending on iteration order.
    const convertedFiles = [
      converted("tests/login.spec.ts", "test"),
      converted("pages/login.page.ts", "page-object"),
    ];

    const result = buildConversionResult(buildArgs(scanned, convertedFiles));

    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "src/pages/LoginPage.java",
          output: "pages/login.page.ts",
        }),
        expect.objectContaining({
          source: "src/tests/LoginTest.java",
          output: "tests/login.spec.ts",
        }),
      ]),
    );
    expect(result.stats.converted).toBe(2);
    expect(result.stats.failed).toBe(0);
  });

  it("still maps base classes to fixtures and helpers by exact basename", () => {
    const scanned = [
      javaFile("BaseTest", "base", "src/tests/BaseTest.java"),
      javaFile("LoginPage", "page-object", "src/pages/LoginPage.java"),
    ];
    const convertedFiles = [
      converted("tests/fixtures.ts", "base"),
      converted("tests/helpers/wait-utils.ts", "config"),
      converted("pages/login.page.ts", "page-object"),
    ];

    const result = buildConversionResult(buildArgs(scanned, convertedFiles));

    expect(
      result.files.find((f) => f.source === "src/tests/BaseTest.java")?.output,
    ).toBe("tests/fixtures.ts");
    expect(
      result.files.find((f) => f.source === "src/pages/LoginPage.java")?.output,
    ).toBe("pages/login.page.ts");
  });
});
