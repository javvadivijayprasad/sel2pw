/**
 * Hybrid AST + LLM engine — Phase 5 stretch.
 *
 * For the 80% of code shapes the AST handles deterministically, do nothing
 * different. For the 20% it can't (custom helper utilities, weird wait
 * patterns, framework wrappers), call an LLM with the function's source +
 * the project's already-converted files as in-context examples, ask for
 * the TS equivalent, validate the response (parses as TS, no obvious
 * unconverted Selenium imports), then drop it in.
 *
 * STATUS: scaffold. Concrete LLM integration is a separate task — this
 * module defines the interface contract and the call site so the rest of
 * the pipeline doesn't change when an LLM is wired up.
 */

import { ai_governance_sanitize } from "./governanceClient";
import { ReviewItem } from "../types";
import { logger } from "../utils/logger";

export interface LlmCallback {
  /**
   * Called by the converter with the Java function source. Implementer
   * returns TS source (or null to give up). Implementations should:
   *   1. Pass the source through `ai_governance_sanitize` first.
   *   2. Use a strict prompt that includes a few in-context examples.
   *   3. Verify the response: parses as TS, no `import` from selenium.
   */
  (input: {
    javaSource: string;
    contextFiles: { path: string; content: string }[];
    sanitisedSource: string;
  }): Promise<string | null>;
}

export interface HybridConfig {
  enabled: boolean;
  callback?: LlmCallback;
  /** ai-governance sidecar URL (defaults to env or http://localhost:4900) */
  sidecarUrl?: string;
}

/**
 * Apply LLM rewrite to a stubborn Java method body. Returns:
 *   - { ts: "…" } if the LLM converted successfully
 *   - { ts: null, warning } if no callback is wired or the call failed
 */
export async function llmRewriteMethodBody(
  javaSource: string,
  contextFiles: { path: string; content: string }[],
  config: HybridConfig,
): Promise<{ ts: string | null; warning?: ReviewItem }> {
  if (!config.enabled || !config.callback) {
    return {
      ts: null,
      warning: {
        file: "(unknown)",
        severity: "info",
        message:
          "Hybrid engine disabled — auto-conversion declined for a complex helper. Enable `--engine=hybrid` and provide an LLM callback to translate this.",
      },
    };
  }

  try {
    const sanitised = await ai_governance_sanitize(javaSource, {
      sidecarUrl: config.sidecarUrl,
      kind: "code",
    });
    const ts = await config.callback({
      javaSource,
      contextFiles,
      sanitisedSource: sanitised,
    });
    if (!ts || !looksLikeValidTs(ts)) {
      return {
        ts: null,
        warning: {
          file: "(unknown)",
          severity: "warning",
          message: "Hybrid LLM returned an unusable result; falling back to leaving the source for manual review.",
        },
      };
    }
    return { ts };
  } catch (err: any) {
    logger.warn({ err: err.message }, "hybrid LLM rewrite failed");
    return {
      ts: null,
      warning: {
        file: "(unknown)",
        severity: "warning",
        message: `Hybrid LLM call failed: ${err.message}`,
      },
    };
  }
}

function looksLikeValidTs(ts: string): boolean {
  // Very cheap sanity checks. Real validation happens via tscValidate.
  if (/import\s+.*from\s+['"]selenium-webdriver['"]/.test(ts)) return false;
  if (/^\s*$/.test(ts)) return false;
  // Balanced braces — quick sanity.
  const depth = ts.split("").reduce((d, c) => d + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
  return depth === 0;
}
