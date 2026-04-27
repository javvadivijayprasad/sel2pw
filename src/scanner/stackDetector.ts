import * as path from "path";
import fg from "fast-glob";

/**
 * The four source stacks sel2pw can convert (Phase 8 onwards).
 *
 * - `java-testng`           — Java + Selenium + TestNG / JUnit Page Objects
 * - `java-bdd-cucumber`     — same as above + Cucumber `.feature` files and
 *                              `@Given/@When/@Then` step definitions
 * - `csharp-nunit`          — C# + Selenium + NUnit / MSTest / xUnit
 * - `csharp-bdd-specflow`   — same as C# above + SpecFlow `.feature` + `[Binding]`
 *
 * Defaults to `java-testng` when nothing else clearly matches — the original
 * MVP target stack and the most common shape in the wild.
 */
export type SourceStack =
  | "java-testng"
  | "java-bdd-cucumber"
  | "csharp-nunit"
  | "csharp-bdd-specflow";

export interface StackDetection {
  stack: SourceStack;
  /** Counts of the file extensions that drove the decision. */
  evidence: {
    javaFiles: number;
    csharpFiles: number;
    featureFiles: number;
  };
  /** Why we picked this stack (1–2 lines, surfaced to the user). */
  reason: string;
}

/**
 * Walk the input directory and decide which stack it is. Pure file-shape
 * heuristic — fast and dependency-free. If the user passes `--lang csharp`
 * or `--lang java` on the CLI, that overrides this detection.
 */
export async function detectSourceStack(inputDir: string): Promise<StackDetection> {
  const abs = path.resolve(inputDir);
  const ignore = ["**/target/**", "**/build/**", "**/bin/**", "**/obj/**", "**/.idea/**", "**/node_modules/**"];

  const javaFiles = (await fg(["**/*.java"], { cwd: abs, ignore })).length;
  const csharpFiles = (await fg(["**/*.cs"], { cwd: abs, ignore })).length;
  const featureFiles = (await fg(["**/*.feature"], { cwd: abs, ignore })).length;

  const evidence = { javaFiles, csharpFiles, featureFiles };

  // C# wins if it dominates AND there's no Java; Java wins otherwise.
  // Mixed projects (rare) fall back to whichever has more source files.
  const csharpDominant = csharpFiles > 0 && csharpFiles >= javaFiles;
  const javaDominant = javaFiles > 0 && javaFiles >= csharpFiles;

  if (csharpDominant) {
    if (featureFiles > 0) {
      return {
        stack: "csharp-bdd-specflow",
        evidence,
        reason: `Detected ${csharpFiles} C# files and ${featureFiles} .feature files — using SpecFlow → playwright-bdd path.`,
      };
    }
    return {
      stack: "csharp-nunit",
      evidence,
      reason: `Detected ${csharpFiles} C# files (no .feature files) — using NUnit/MSTest → Playwright Test path.`,
    };
  }

  if (javaDominant) {
    if (featureFiles > 0) {
      return {
        stack: "java-bdd-cucumber",
        evidence,
        reason: `Detected ${javaFiles} Java files and ${featureFiles} .feature files — using Cucumber → playwright-bdd path.`,
      };
    }
    return {
      stack: "java-testng",
      evidence,
      reason: `Detected ${javaFiles} Java files (no .feature files) — using TestNG/JUnit → Playwright Test path.`,
    };
  }

  return {
    stack: "java-testng",
    evidence,
    reason: "No clear language signal — defaulting to java-testng.",
  };
}
