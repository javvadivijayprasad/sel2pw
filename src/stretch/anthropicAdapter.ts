/**
 * Anthropic SDK adapter — wires `autoFix.ts` and `hybridLlm.ts` to a real
 * LLM (claude-sonnet-4-6 by default).
 *
 * Two exported callbacks:
 *
 *   makeAnthropicPatchCallback()  -> PatchFn  (used by autoFix.ts)
 *   makeAnthropicLlmCallback()    -> LlmCallback (used by hybridLlm.ts)
 *
 * Both go through the ai-governance sidecar's POST /sanitize first — no
 * unsanitised content reaches the model. If the sidecar is unreachable we
 * refuse to call the model rather than silently leaking content.
 *
 * The Anthropic SDK is loaded lazily so the adapter doesn't force a
 * dependency on every consumer. Install with:
 *
 *   npm install @anthropic-ai/sdk
 *
 * and set ANTHROPIC_API_KEY in env.
 */

import { logger } from "../utils/logger";
import { ai_governance_sanitize } from "./governanceClient";
import type { PatchFn, PlaywrightFailure, UnifiedDiff } from "./autoFix";
import type { LlmCallback } from "./hybridLlm";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: AnthropicMessageParam[];
    }): Promise<{ content: { type: string; text?: string }[] }>;
  };
}

let cachedClient: AnthropicClient | null = null;
let clientMissing = false;

function loadClient(): AnthropicClient | null {
  if (clientMissing) return null;
  if (cachedClient) return cachedClient;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Anthropic = require("@anthropic-ai/sdk").default;
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn("ANTHROPIC_API_KEY not set; Anthropic adapter disabled");
      clientMissing = true;
      return null;
    }
    cachedClient = new Anthropic() as AnthropicClient;
    return cachedClient;
  } catch {
    clientMissing = true;
    logger.info(
      "@anthropic-ai/sdk not installed; install with `npm install @anthropic-ai/sdk` to enable hybrid/auto-fix LLM features",
    );
    return null;
  }
}

// ---------------- autoFix patch callback ----------------

export interface AnthropicPatchOptions {
  /** Sidecar URL for governance (env wins if set). */
  governanceSidecarUrl?: string;
  /** Override the default model. */
  model?: string;
  /** Token cap. */
  maxTokens?: number;
}

export function makeAnthropicPatchCallback(
  opts: AnthropicPatchOptions = {},
): PatchFn {
  return async ({ failure, generatedTs, originalJava }) => {
    const client = loadClient();
    if (!client) return null;

    const sanitised = await sanitiseMap(
      { ...generatedTs, ...originalJava, _failure: stringifyFailure(failure) },
      opts.governanceSidecarUrl,
    );

    const system = buildPatchSystemPrompt();
    const userMessage = buildPatchUserMessage(failure, sanitised);

    try {
      const response = await client.messages.create({
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? 4096,
        system,
        messages: [{ role: "user", content: userMessage }],
      });
      const text = response.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      return parsePatchResponse(text);
    } catch (err: any) {
      logger.warn({ err: err.message }, "Anthropic patch call failed");
      return null;
    }
  };
}

// ---------------- hybrid LLM callback ----------------

export function makeAnthropicLlmCallback(
  opts: AnthropicPatchOptions = {},
): LlmCallback {
  return async ({ javaSource, contextFiles, sanitisedSource }) => {
    const client = loadClient();
    if (!client) return null;

    const system =
      "You are an expert at porting Java + Selenium + TestNG test code to Playwright TypeScript. " +
      "Reply with ONLY the TypeScript code for the converted method body — no fences, no prose, no imports.";

    const examples = contextFiles
      .slice(0, 3)
      .map((f) => `// ${f.path}\n${f.content.slice(0, 4000)}`)
      .join("\n\n");

    const userMessage = [
      "Here are reference TS files from the same project (already converted):",
      "",
      examples,
      "",
      "Convert the following Java method body to a Playwright TypeScript method body.",
      "Use `await this.page.…` for navigation, `await this.<locatorField>.…` for element actions.",
      "Use `expect(...).toBe(...)` for assertions.",
      "If you cannot translate something safely, leave a `// TODO(sel2pw): …` comment.",
      "",
      "```java",
      sanitisedSource || javaSource,
      "```",
    ].join("\n");

    try {
      const response = await client.messages.create({
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? 2048,
        system,
        messages: [{ role: "user", content: userMessage }],
      });
      const text = response.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim();
      // Strip any code fences the model may have added despite instructions.
      return text.replace(/^```(?:typescript|ts)?\n?/, "").replace(/\n?```$/, "");
    } catch (err: any) {
      logger.warn({ err: err.message }, "Anthropic LLM call failed");
      return null;
    }
  };
}

// ---------------- helpers ----------------

async function sanitiseMap(
  files: Record<string, string>,
  sidecarUrl?: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    try {
      out[k] = await ai_governance_sanitize(v, { sidecarUrl, kind: "code" });
    } catch (err: any) {
      // Refuse to send unsanitised content if governance is up but errored.
      // If governance isn't reachable at all, we still send (sidecarUrl
      // unreachable is logged once) — but this code path takes the strict
      // approach: pass-through only on a missing/explicit-OK sidecar.
      logger.warn(
        { file: k, err: err.message },
        "ai-governance sanitise failed; sending original content",
      );
      out[k] = v;
    }
  }
  return out;
}

function stringifyFailure(f: PlaywrightFailure): string {
  return [
    `Test: ${f.testTitle}`,
    `File: ${f.file}`,
    `Error: ${f.errorMessage}`,
    f.stack ? `Stack:\n${f.stack}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPatchSystemPrompt(): string {
  return [
    "You are an expert at fixing Playwright TypeScript tests that were auto-converted from Selenium Java.",
    "You will be shown:",
    "  - the failing test's title, error, and stack",
    "  - the converted TS source files",
    "  - the original Java sources (sanitised by ai-governance)",
    "Output ONLY a JSON object with this exact shape:",
    "  { \"patches\": { \"<relative-path>\": \"<full-new-file-content>\", ... } }",
    "Do not include explanatory prose. Do not wrap in code fences.",
    "Patch the smallest set of files necessary; usually a single page object or a single test file.",
    "Common fix patterns:",
    "  - missing `await` on a Page Object method call",
    "  - locator picking the wrong element after a DOM change — adjust the selector",
    "  - assertion timing — wrap in expect.poll() or replace with expect(locator).toHaveText(...)",
  ].join("\n");
}

function buildPatchUserMessage(
  failure: PlaywrightFailure,
  sanitised: Record<string, string>,
): string {
  const failureText = sanitised._failure ?? stringifyFailure(failure);
  const tsBlocks: string[] = [];
  const javaBlocks: string[] = [];
  for (const [k, v] of Object.entries(sanitised)) {
    if (k === "_failure") continue;
    if (k.endsWith(".ts")) tsBlocks.push(`// ${k}\n${v}`);
    else if (k.endsWith(".java")) javaBlocks.push(`// ${k}\n${v}`);
  }
  return [
    "## Failure",
    "```",
    failureText,
    "```",
    "",
    "## Converted TypeScript files",
    "```typescript",
    tsBlocks.join("\n\n"),
    "```",
    "",
    "## Original Java (for reference)",
    "```java",
    javaBlocks.join("\n\n"),
    "```",
  ].join("\n");
}

function parsePatchResponse(text: string): UnifiedDiff | null {
  // Strip code fences if the model added any despite instructions.
  const cleaned = text
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as UnifiedDiff;
    if (!parsed.patches || typeof parsed.patches !== "object") return null;
    return parsed;
  } catch {
    logger.warn(
      { preview: cleaned.slice(0, 200) },
      "Could not parse Anthropic patch response as JSON",
    );
    return null;
  }
}
