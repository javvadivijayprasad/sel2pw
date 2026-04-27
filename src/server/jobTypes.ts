import { ConversionSummary, ReviewItem } from "../types";

/**
 * Public types for the HTTP service. These shapes mirror the platform's
 * `packages/shared-types` entries (ConverterJob, ConverterStats, etc.) — see
 * INTEGRATION.md for the contract.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobInputSpec {
  /** "zip" (data_url is local path or s3:// URL), "git" (git URL), or "local" (already-extracted path). */
  kind: "zip" | "git" | "local";
  /** URL or local filesystem path containing the input project. */
  data_url: string;
  /** Optional integrity check (sha256:abc…). */
  checksum?: string;
  /** For "git" kind: the ref to check out. */
  ref?: string;
}

export interface ConvertOptionsRequest {
  engine?: "ast" | "hybrid";
  target?: {
    playwright_version?: string;
    typescript_version?: string;
    test_runner?: "playwright-test";
  };
  preserve_groups_as_tags?: boolean;
  emit_auth_setup?: boolean;
  emit_self_healing_shim?: boolean;
}

export interface GovernanceRequest {
  /** URL or path to ai-quality.config.yaml. */
  config_url?: string;
  /** Extra redact regexes appended to whatever the config provides. */
  redact_patterns_extra?: string[];
}

export interface ConvertRequestBody {
  input: JobInputSpec;
  options?: ConvertOptionsRequest;
  governance?: GovernanceRequest;
  /** Webhook URL invoked when the job reaches a terminal state. */
  callback_url?: string;
}

export interface ProvenanceBlock {
  service: "sel2pw";
  version: string;
  engine: "ast" | "hybrid";
  rules_version: string;
  governance_config_hash?: string;
  input_hash?: string;
  started_at: string;
  duration_ms: number;
}

export interface JobStatsBlock {
  files_scanned: number;
  page_objects_converted: number;
  test_classes_converted: number;
  test_methods_converted: number;
  review_items: { manual: number; warning: number; info: number };
}

export interface JobRecord {
  jobId: string;
  status: JobStatus;
  request: ConvertRequestBody;
  created_at: string;
  updated_at: string;
  /** Once succeeded — populated from ConversionSummary. */
  stats?: JobStatsBlock;
  /** Storage URI for the output zip (e.g. file:///… or s3://…). */
  artifact_url?: string;
  /** Storage URI for CONVERSION_REVIEW.md. */
  review_url?: string;
  /** Optional governance audit produced by ai-governance sidecar. */
  governance_audit_url?: string;
  /** Failure reason when status === "failed". */
  error?: string;
  /** Provenance, populated when a job runs. */
  provenance?: ProvenanceBlock;
}

export function summaryToStats(summary: ConversionSummary): JobStatsBlock {
  return {
    files_scanned: summary.filesScanned,
    page_objects_converted: summary.pageObjectsConverted,
    test_classes_converted: summary.testClassesConverted,
    test_methods_converted: summary.testMethodsConverted,
    review_items: {
      manual: summary.warnings.filter((w: ReviewItem) => w.severity === "manual").length,
      warning: summary.warnings.filter((w: ReviewItem) => w.severity === "warning").length,
      info: summary.warnings.filter((w: ReviewItem) => w.severity === "info").length,
    },
  };
}
