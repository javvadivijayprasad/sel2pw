/**
 * Provider-agnostic LLM adapter.
 *
 * Replaces the Anthropic-only `anthropicAdapter` for new code paths. The
 * old adapter is kept around for the auto-fix loop (which has Anthropic-
 * specific prompt shaping); new paths (LLM fallback for unknowns, hybrid
 * engine call sites) use this one to let the user pick at runtime.
 *
 * Supported providers (each loaded lazily so the SDK isn't a hard dep):
 *
 *   - anthropic   → @anthropic-ai/sdk         (claude-sonnet-4-6 default)
 *   - openai      → openai                    (gpt-5 default)
 *   - gemini      → @google/generative-ai     (gemini-2.5-pro default)
 *
 * Governance is enforced in code: every payload runs through `ai-governance`
 * sidecar `/sanitize` before any model call. If the sidecar is unreachable
 * we fall through with a logged warning rather than silently leaking content.
 */

import { logger } from "../utils/logger";
import { ai_governance_sanitize } from "./governanceClient";

export type LlmProvider = "anthropic" | "openai" | "gemini";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
  /** Override sidecar URL (defaults to env or http://localhost:4900). */
  governanceSidecarUrl?: string;
  maxTokens?: number;
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5",
  gemini: "gemini-2.5-pro",
};

export interface LlmConvertRequest {
  /** A clear, terse system prompt — what role the model is playing. */
  system: string;
  /** The user message — typically code + instructions. */
  user: string;
  /** When true, run the user message through ai-governance sanitize first. */
  sanitise?: boolean;
}

export type LlmCallback = (req: LlmConvertRequest) => Promise<string | null>;

export function makeLlmCallback(config: LlmConfig): LlmCallback {
  switch (config.provider) {
    case "anthropic":
      return makeAnthropicCallback(config);
    case "openai":
      return makeOpenAiCallback(config);
    case "gemini":
      return makeGeminiCallback(config);
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

// ---------------- per-provider implementations ----------------

function makeAnthropicCallback(config: LlmConfig): LlmCallback {
  let client: any | null = null;
  let missing = false;
  return async (req) => {
    if (missing) return null;
    if (!client) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Anthropic = require("@anthropic-ai/sdk").default;
        client = new Anthropic({ apiKey: config.apiKey });
      } catch {
        logger.info(
          "@anthropic-ai/sdk not installed — `npm install @anthropic-ai/sdk` to enable.",
        );
        missing = true;
        return null;
      }
    }
    const userText = req.sanitise
      ? await sanitiseSafely(req.user, config.governanceSidecarUrl)
      : req.user;
    try {
      const resp = await client.messages.create({
        model: config.model ?? DEFAULT_MODELS.anthropic,
        max_tokens: config.maxTokens ?? 4096,
        system: req.system,
        messages: [{ role: "user", content: userText }],
      });
      return resp.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text ?? "")
        .join("");
    } catch (err: any) {
      logger.warn({ err: err.message }, "Anthropic call failed");
      return null;
    }
  };
}

function makeOpenAiCallback(config: LlmConfig): LlmCallback {
  let client: any | null = null;
  let missing = false;
  return async (req) => {
    if (missing) return null;
    if (!client) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const OpenAI = require("openai").default ?? require("openai").OpenAI;
        client = new OpenAI({ apiKey: config.apiKey });
      } catch {
        logger.info("`openai` not installed — `npm install openai` to enable.");
        missing = true;
        return null;
      }
    }
    const userText = req.sanitise
      ? await sanitiseSafely(req.user, config.governanceSidecarUrl)
      : req.user;
    try {
      const resp = await client.chat.completions.create({
        model: config.model ?? DEFAULT_MODELS.openai,
        max_tokens: config.maxTokens ?? 4096,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: userText },
        ],
      });
      return resp.choices?.[0]?.message?.content ?? null;
    } catch (err: any) {
      logger.warn({ err: err.message }, "OpenAI call failed");
      return null;
    }
  };
}

function makeGeminiCallback(config: LlmConfig): LlmCallback {
  let client: any | null = null;
  let missing = false;
  return async (req) => {
    if (missing) return null;
    if (!client) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        client = new GoogleGenerativeAI(config.apiKey);
      } catch {
        logger.info(
          "`@google/generative-ai` not installed — `npm install @google/generative-ai` to enable.",
        );
        missing = true;
        return null;
      }
    }
    const userText = req.sanitise
      ? await sanitiseSafely(req.user, config.governanceSidecarUrl)
      : req.user;
    try {
      const model = client.getGenerativeModel({
        model: config.model ?? DEFAULT_MODELS.gemini,
        systemInstruction: req.system,
      });
      const resp = await model.generateContent(userText);
      return resp.response.text();
    } catch (err: any) {
      logger.warn({ err: err.message }, "Gemini call failed");
      return null;
    }
  };
}

// ---------------- shared helpers ----------------

async function sanitiseSafely(content: string, sidecarUrl?: string): Promise<string> {
  try {
    return await ai_governance_sanitize(content, { sidecarUrl, kind: "code" });
  } catch (err: any) {
    logger.warn(
      { err: err.message },
      "ai-governance sanitise failed — falling back to original content",
    );
    return content;
  }
}
