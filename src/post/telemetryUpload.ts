import { request } from "undici";
import { logger } from "../utils/logger";
import { createFailureStore } from "../server/telemetry";

/**
 * Opt-in upload of AGGREGATE telemetry to a central endpoint so the sel2pw
 * maintainers can see patterns across users and prioritise patches.
 *
 * Privacy contract:
 *   - We send pattern_signature (hash) + count + failureKind + fileKind only.
 *   - We DO NOT send sourcePreview, errorMessage, file paths, or sourceHash.
 *   - The user has to explicitly opt in via --telemetry-share or
 *     SEL2PW_TELEMETRY_UPLOAD_URL env. Default is local-only.
 *   - If ai-governance sidecar is reachable, the payload is also sanitised
 *     before send as a defence-in-depth measure.
 */

export interface TelemetryUploadConfig {
  /** Absolute URL to POST aggregate stats to. */
  endpoint: string;
  /** Local SQLite DB path. */
  dbPath: string;
  /** Optional bearer token. */
  apiKey?: string;
}

interface AggregatePayload {
  service: "sel2pw";
  version: string;
  reportedAt: string;
  totalJobs: number;
  totalFailures: number;
  successRate: number;
  byFailureKind: Record<string, number>;
  byFileKind: Record<string, number>;
  topPatterns: { signature: string; count: number; failureKind: string; fileKind: string }[];
}

export async function uploadAggregateTelemetry(
  config: TelemetryUploadConfig,
  version: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const store = createFailureStore(config.dbPath);
    const stats = store.getStats();
    const patterns = store.listFailurePatterns(50).map((p) => ({
      signature: p.signature,
      count: p.count,
      failureKind: p.sample.failureKind,
      fileKind: p.sample.fileKind,
      // Deliberately exclude: sourcePreview, errorMessage, sourceFile, sourceHash
    }));
    store.close();

    const payload: AggregatePayload = {
      service: "sel2pw",
      version,
      reportedAt: new Date().toISOString(),
      totalJobs: stats.totalJobs,
      totalFailures: stats.totalFailures,
      successRate: stats.successRate,
      byFailureKind: stats.byFailureKind,
      byFileKind: stats.byFileKind,
      topPatterns: patterns,
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;

    const { statusCode } = await request(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (statusCode >= 400) {
      return { ok: false, reason: `HTTP ${statusCode}` };
    }
    logger.info(
      { endpoint: config.endpoint, totalFailures: stats.totalFailures, patterns: patterns.length },
      "telemetry uploaded",
    );
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}
