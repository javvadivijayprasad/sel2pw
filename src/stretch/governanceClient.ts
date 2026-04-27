import { request } from "undici";

/**
 * Tiny client for the ai-governance sidecar (POST /sanitize).
 *
 * Used by the hybrid LLM engine to scrub Java source before any LLM call.
 * If the sidecar is unreachable we surface the original content so the
 * caller can decide whether to proceed or abort — governance failures
 * shouldn't silently leak unsanitised content.
 */

export interface SanitizeOptions {
  sidecarUrl?: string;
  configPath?: string;
  kind?: "code" | "log" | "dom";
}

export async function ai_governance_sanitize(
  content: string,
  opts: SanitizeOptions = {},
): Promise<string> {
  const url =
    opts.sidecarUrl ??
    process.env.AI_GOVERNANCE_SIDECAR_URL ??
    "http://localhost:4900";
  const { body, statusCode } = await request(`${url}/sanitize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: opts.kind ?? "code",
      content,
      config_path: opts.configPath,
    }),
  });
  if (statusCode >= 400) {
    throw new Error(`ai-governance /sanitize HTTP ${statusCode}`);
  }
  const json = (await body.json()) as { sanitised?: string };
  return json.sanitised ?? content;
}
