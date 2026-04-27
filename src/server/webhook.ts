import * as crypto from "crypto";
import { request } from "undici";
import { JobRecord } from "./jobTypes";

/**
 * Webhook delivery on job completion.
 *
 * The platform gateway expects a POST with JSON body and an HMAC-SHA256
 * signature header so the receiver can verify origin. The signing secret is
 * shared via environment (CONVERTER_WEBHOOK_SECRET on both sides).
 */

export interface WebhookConfig {
  secret?: string;
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  /** Number of attempts (1 + N retries). */
  maxAttempts?: number;
}

export async function deliverWebhook(
  url: string,
  job: JobRecord,
  config: WebhookConfig = {},
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify({
    event: "converter.job." + job.status,
    jobId: job.jobId,
    status: job.status,
    artifact_url: job.artifact_url,
    review_url: job.review_url,
    governance_audit_url: job.governance_audit_url,
    stats: job.stats,
    provenance: job.provenance,
    error: job.error,
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-converter-event": "job." + job.status,
    "x-converter-job-id": job.jobId,
  };
  if (config.secret) {
    const sig = crypto.createHmac("sha256", config.secret).update(body).digest("hex");
    headers["x-converter-signature"] = `sha256=${sig}`;
  }

  const maxAttempts = config.maxAttempts ?? 3;
  let lastErr: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { statusCode } = await request(url, {
        method: "POST",
        headers,
        body,
        bodyTimeout: config.timeoutMs ?? 5_000,
        headersTimeout: config.timeoutMs ?? 5_000,
      });
      if (statusCode < 400) return { ok: true, statusCode };
      lastErr = `HTTP ${statusCode}`;
    } catch (err: any) {
      lastErr = err.message;
    }
    if (attempt < maxAttempts) {
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  return { ok: false, error: lastErr };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
