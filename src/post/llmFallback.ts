import { ConvertedFile, JavaFile, ReviewItem } from "../types";
import { LlmCallback, LlmConfig, makeLlmCallback } from "../stretch/llmAdapter";

/**
 * LLM fallback — for files the AST/regex pipeline couldn't classify or
 * convert, run the user-selected LLM over the source and try to produce a
 * Playwright TypeScript file.
 *
 * Triggered by --llm-fallback on the CLI. Targets:
 *   - files with kind === "unknown" that didn't match the custom-utility detector
 *   - any file the per-file try/catch in index.ts failed on (logged + skipped)
 *
 * Each LLM call goes through `ai-governance` sanitise. The output is added
 * to the `converted` list with `kind: "test"` (or "page-object" if the
 * model declares one) and a review item documenting which provider/model
 * was used so the user has a clear provenance trail.
 */

export interface LlmFallbackOptions {
  config: LlmConfig;
  /** Page Object files already converted — used as in-context examples. */
  contextFiles: ConvertedFile[];
}

export async function runLlmFallback(
  unknownFiles: JavaFile[],
  opts: LlmFallbackOptions,
): Promise<{ files: ConvertedFile[]; warnings: ReviewItem[] }> {
  const out: ConvertedFile[] = [];
  const warnings: ReviewItem[] = [];
  if (unknownFiles.length === 0) return { files: out, warnings };

  const callback = makeLlmCallback(opts.config);
  const examples = pickContextExamples(opts.contextFiles, 3);

  for (const file of unknownFiles) {
    const result = await convertOne(file, callback, examples, opts.config);
    if (result) {
      out.push(result);
      warnings.push({
        file: file.path,
        severity: "info",
        message: `LLM-converted via ${opts.config.provider} (${opts.config.model ?? "default model"}). Review the output carefully — the AST pipeline couldn't classify this file.`,
      });
    } else {
      warnings.push({
        file: file.path,
        severity: "manual",
        message: `LLM fallback declined to convert this file (${opts.config.provider}). Port manually.`,
      });
    }
  }
  return { files: out, warnings };
}

async function convertOne(
  file: JavaFile,
  callback: LlmCallback,
  examples: string,
  config: LlmConfig,
): Promise<ConvertedFile | null> {
  const ext = file.path.toLowerCase().endsWith(".cs") ? "csharp" : "java";
  const system = [
    `You are an expert at porting ${ext === "csharp" ? "C#/Selenium/NUnit/SpecFlow" : "Java/Selenium/TestNG"} test code to Playwright TypeScript.`,
    "Reply with ONLY the TypeScript source code — no fences, no prose, no commentary.",
    "Use Playwright primitives (page.locator, page.goto, expect, test) idiomatically.",
    "Use `await` everywhere — every action and assertion is async.",
    "Where you can't translate something safely, leave a `// TODO(sel2pw-llm):` comment.",
  ].join("\n");

  const user = [
    `Convert this ${ext} source to Playwright TypeScript.`,
    "",
    "## Reference (already-converted files in the same project)",
    examples,
    "",
    "## Source to convert",
    `\`\`\`${ext}`,
    file.source,
    "```",
  ].join("\n");

  const ts = await callback({ system, user, sanitise: true });
  if (!ts || !looksLikeUsableTs(ts)) return null;

  const cleaned = ts
    .replace(/^```(?:typescript|ts)?\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  // Decide an output path: page-objects under pages/, otherwise tests/llm/.
  const looksLikePage =
    /\bclass\s+\w+Page\b/.test(cleaned) || /Page$/.test(file.className);
  const baseName = kebab(file.className.replace(/Page$/, ""));
  const relPath = looksLikePage
    ? `pages/${baseName}.page.ts`
    : `tests/llm/${baseName}.spec.ts`;

  return {
    relPath,
    source: addProvenanceHeader(cleaned, config, file),
    warnings: [],
    kind: looksLikePage ? "page-object" : "test",
  };
}

function pickContextExamples(files: ConvertedFile[], n: number): string {
  return files
    .filter((f) => f.relPath.endsWith(".ts"))
    .slice(0, n)
    .map((f) => `// ${f.relPath}\n${f.source.slice(0, 4000)}`)
    .join("\n\n");
}

function looksLikeUsableTs(ts: string): boolean {
  if (!ts.trim()) return false;
  if (/import\s+.*from\s+['"]selenium-webdriver['"]/.test(ts)) return false;
  // Balanced braces sanity check.
  const depth = ts
    .split("")
    .reduce((d, c) => d + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
  return depth === 0;
}

function addProvenanceHeader(ts: string, config: LlmConfig, source: JavaFile): string {
  const header = [
    "/**",
    " * Auto-converted by sel2pw LLM fallback.",
    ` * Source:   ${source.relPath}`,
    ` * Provider: ${config.provider}`,
    ` * Model:    ${config.model ?? "(default)"}`,
    " *",
    " * The AST pipeline couldn't classify this file. Output produced by an",
    " * LLM and may need review — particularly around assertion semantics,",
    " * locator strategies, and async handling.",
    " */",
    "",
  ].join("\n");
  return header + ts + "\n";
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
