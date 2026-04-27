import express, { Request, Response, NextFunction } from "express";
import * as path from "path";
import * as fs from "fs-extra";
import { execFile } from "child_process";
import { promisify } from "util";

import { convert, analyze } from "./index";
import { JobStore } from "./server/jobs";
import {
  ConvertRequestBody,
  JobRecord,
  summaryToStats,
} from "./server/jobTypes";
import {
  ArtifactDriver,
  makeArtifactDriver,
} from "./server/artifacts";
import { buildProvenance } from "./server/provenance";
import {
  resolveGovernanceConfig,
  runGovernanceAudit,
  writeAuditFile,
} from "./server/governance";
import { deliverWebhook } from "./server/webhook";
import { createFailureStore } from "./server/telemetry";

const PKG = require("../package.json"); // eslint-disable-line @typescript-eslint/no-require-imports
const RULES_VERSION = "selenium-mappings@2026-04-25";
const execFileP = promisify(execFile);

interface ServerConfig {
  port: number;
  workDir: string;
  jobsDir: string;
  cacheDir: string;
  artifactRoot: string;
  governanceSidecarUrl: string;
  webhookSecret?: string;
  /** Path to the telemetry SQLite DB (auto-derived from workDir if unset). */
  telemetryDbPath: string;
  /** Optional shared secret guarding /admin/*. */
  adminSecret?: string;
}

function loadConfig(): ServerConfig {
  const workDir =
    process.env.SEL2PW_WORK_DIR ?? path.resolve(process.cwd(), ".sel2pw");
  return {
    port: parseInt(process.env.PORT ?? "4200", 10),
    workDir,
    jobsDir: path.join(workDir, "jobs"),
    cacheDir: path.join(workDir, "cache"),
    artifactRoot: path.join(workDir, "artifacts"),
    governanceSidecarUrl:
      process.env.AI_GOVERNANCE_SIDECAR_URL ?? "http://localhost:4900",
    webhookSecret: process.env.CONVERTER_WEBHOOK_SECRET,
    telemetryDbPath:
      process.env.SEL2PW_TELEMETRY_DB ?? path.join(workDir, "telemetry.db"),
    adminSecret: process.env.SEL2PW_ADMIN_SECRET,
  };
}

export async function createApp(): Promise<{
  app: express.Express;
  config: ServerConfig;
}> {
  const config = loadConfig();
  await fs.ensureDir(config.workDir);
  await fs.ensureDir(config.jobsDir);
  await fs.ensureDir(config.cacheDir);
  await fs.ensureDir(config.artifactRoot);

  const jobStore = new JobStore(config.jobsDir);
  await jobStore.init();
  const artifacts = makeArtifactDriver({
    driver: "local",
    rootDir: config.artifactRoot,
  });

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // ----- /health -----
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "sel2pw",
      version: PKG.version,
      rules_version: RULES_VERSION,
    });
  });

  // ----- POST /analyze (sync) -----
  app.post("/analyze", asyncHandler(async (req, res) => {
    const body = req.body as { input?: { kind: string; data_url: string } };
    if (!body?.input?.data_url) {
      return res.status(400).json({ error: "input.data_url is required" });
    }
    const inputDir = await materialiseInput(body.input, config);
    try {
      const result = await analyze(inputDir);
      res.json(result);
    } finally {
      // analyze() doesn't write anything; clean up materialised input.
      await fs.remove(inputDir).catch(() => undefined);
    }
  }));

  // ----- POST /convert (async — enqueue, run in background) -----
  app.post("/convert", asyncHandler(async (req, res) => {
    const body = req.body as ConvertRequestBody;
    if (!body?.input?.data_url) {
      return res.status(400).json({ error: "input.data_url is required" });
    }

    const jobId = jobStore.newId();
    const now = new Date().toISOString();
    const job: JobRecord = await jobStore.create({
      jobId,
      status: "queued",
      request: body,
      created_at: now,
      updated_at: now,
    });

    // Run in background — we don't block the HTTP response on conversion.
    setImmediate(() => {
      runJob(jobId, body, { jobStore, artifacts, config }).catch((err) => {
        console.error(`[sel2pw] job ${jobId} crashed`, err);
      });
    });

    res.status(202).json({ jobId: job.jobId, status: job.status });
  }));

  // ----- GET /jobs/:id -----
  app.get("/jobs/:id", asyncHandler(async (req, res) => {
    const job = await jobStore.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job not found" });
    res.json(job);
  }));

  // ----- GET /jobs/:id/artifact -----
  app.get("/jobs/:id/artifact", asyncHandler(async (req, res) => {
    const job = await jobStore.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job not found" });
    if (job.status !== "succeeded" || !job.artifact_url) {
      return res.status(409).json({ error: "artifact not ready", status: job.status });
    }
    const { stream, contentType, size } = await artifacts.openRead(job.artifact_url);
    res.setHeader("content-type", contentType);
    res.setHeader("content-disposition", `attachment; filename="${job.jobId}.zip"`);
    if (size) res.setHeader("content-length", String(size));
    stream.pipe(res);
  }));

  // ----- GET /jobs/:id/review -----
  app.get("/jobs/:id/review", asyncHandler(async (req, res) => {
    const job = await jobStore.get(req.params.id);
    if (!job) return res.status(404).json({ error: "job not found" });
    if (!job.review_url) return res.status(409).json({ error: "review not ready" });
    const { stream, contentType } = await artifacts.openRead(job.review_url);
    res.setHeader("content-type", contentType);
    stream.pipe(res);
  }));

  // ----- POST /feedback -----
  app.post("/feedback", asyncHandler(async (req, res) => {
    const body = req.body as { jobId?: string; rating?: number; notes?: string };
    if (!body.jobId) return res.status(400).json({ error: "jobId required" });
    const target = path.join(config.workDir, "feedback.jsonl");
    await fs.appendFile(
      target,
      JSON.stringify({ ...body, received_at: new Date().toISOString() }) + "\n",
    );
    res.status(204).end();
  }));

  // ----- /admin/* — failure telemetry (Phase 9) -----
  // Behind a shared-secret header; no auth = endpoints disabled. The
  // platform gateway terminates user-facing auth and forwards a fixed
  // `x-sel2pw-admin` header for these calls.
  const adminGuard = (req: Request, res: Response, next: NextFunction): void => {
    if (!config.adminSecret) {
      res.status(404).json({ error: "admin endpoints disabled" });
      return;
    }
    if (req.header("x-sel2pw-admin") !== config.adminSecret) {
      res.status(401).json({ error: "unauthorised" });
      return;
    }
    next();
  };

  app.get("/admin/failures", adminGuard, asyncHandler(async (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50", 10);
    const store = createFailureStore(config.telemetryDbPath);
    res.json(store.listRecentFailures(limit));
    store.close();
  }));

  app.get("/admin/patterns", adminGuard, asyncHandler(async (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "20", 10);
    const store = createFailureStore(config.telemetryDbPath);
    res.json(store.listFailurePatterns(limit));
    store.close();
  }));

  app.get("/admin/stats", adminGuard, asyncHandler(async (_req, res) => {
    const store = createFailureStore(config.telemetryDbPath);
    res.json(store.getStats());
    store.close();
  }));

  // ----- error handler -----
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[sel2pw] unhandled", err);
    res.status(500).json({ error: err.message });
  });

  return { app, config };
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// -------------------------- worker --------------------------

interface WorkerDeps {
  jobStore: JobStore;
  artifacts: ArtifactDriver;
  config: ServerConfig;
}

async function runJob(
  jobId: string,
  body: ConvertRequestBody,
  { jobStore, artifacts, config }: WorkerDeps,
): Promise<void> {
  const startedAt = new Date();
  await jobStore.update(jobId, { status: "running" });

  let inputDir: string | undefined;
  let outputDir: string | undefined;
  try {
    inputDir = await materialiseInput(body.input, config);
    outputDir = path.join(config.workDir, "out", jobId);
    await fs.ensureDir(outputDir);

    const governanceConfigPath = await resolveGovernanceConfig(
      body.governance?.config_url,
      path.join(config.cacheDir, "governance", jobId),
    );

    const { summary } = await convert({
      inputDir,
      outputDir,
      emitSelfHealingShim: body.options?.emit_self_healing_shim ?? false,
    });

    // Audit (best-effort — does not gate success at v0.1).
    const audit = await runGovernanceAudit(inputDir, {
      sidecarUrl: config.governanceSidecarUrl,
      configPath: governanceConfigPath,
      redactPatternsExtra: body.governance?.redact_patterns_extra,
    });
    const auditPath = await writeAuditFile(outputDir, audit);

    // Provenance (mirrors test-case-generation-service shape).
    const provenance = await buildProvenance({
      version: PKG.version,
      engine: body.options?.engine ?? "ast",
      rulesVersion: RULES_VERSION,
      governanceConfigPath,
      inputDir,
      startedAt,
    });

    // Persist artifacts.
    const artifactUrl = await artifacts.putDirectoryAsZip(
      outputDir,
      `${jobId}/output.zip`,
    );
    const reviewUrl = await artifacts.putFile(
      path.join(outputDir, "CONVERSION_REVIEW.md"),
      `${jobId}/CONVERSION_REVIEW.md`,
    );
    const govUrl = await artifacts.putFile(
      auditPath,
      `${jobId}/governance_audit.json`,
    );

    const updated = await jobStore.update(jobId, {
      status: "succeeded",
      stats: summaryToStats(summary),
      artifact_url: artifactUrl,
      review_url: reviewUrl,
      governance_audit_url: govUrl,
      provenance,
    });

    if (body.callback_url && updated) {
      const result = await deliverWebhook(body.callback_url, updated, {
        secret: config.webhookSecret,
      });
      if (!result.ok) {
        console.warn(`[sel2pw] webhook delivery failed for ${jobId}: ${result.error}`);
      }
    }
  } catch (err: any) {
    console.error(`[sel2pw] job ${jobId} failed`, err);
    const updated = await jobStore.update(jobId, {
      status: "failed",
      error: err.message ?? String(err),
    });
    if (body.callback_url && updated) {
      await deliverWebhook(body.callback_url, updated, {
        secret: config.webhookSecret,
      }).catch(() => undefined);
    }
  } finally {
    if (inputDir && body.input.kind !== "local") {
      await fs.remove(inputDir).catch(() => undefined);
    }
  }
}

/**
 * Resolve the input spec into a local directory. Supports:
 *   - kind:"local"  → data_url is already a path on disk.
 *   - kind:"zip"    → expects a local zip path; extracts under cacheDir.
 *   - kind:"git"    → clones via system git binary (requires git in PATH).
 *
 * For zip downloads from http(s)/s3 we'd fetch first; that's a Phase 0
 * follow-up — at v0.1 the platform gateway is expected to land the zip
 * locally before calling /convert.
 */
async function materialiseInput(
  input: { kind: string; data_url: string; ref?: string; checksum?: string },
  config: ServerConfig,
): Promise<string> {
  if (input.kind === "local") {
    if (!(await fs.pathExists(input.data_url))) {
      throw new Error(`local input not found: ${input.data_url}`);
    }
    return input.data_url;
  }
  if (input.kind === "zip") {
    const target = path.join(config.cacheDir, "inputs", `${Date.now()}`);
    await fs.ensureDir(target);
    // Use system unzip if available; fall back to a Node fallback in Phase 0 follow-up.
    await execFileP("unzip", ["-q", "-o", input.data_url, "-d", target]);
    return target;
  }
  if (input.kind === "git") {
    const target = path.join(config.cacheDir, "inputs", `${Date.now()}`);
    await execFileP("git", ["clone", "--depth", "1", input.data_url, target]);
    if (input.ref) {
      await execFileP("git", ["-C", target, "checkout", input.ref]);
    }
    return target;
  }
  throw new Error(`unsupported input kind: ${input.kind}`);
}

// -------------------------- main --------------------------

if (require.main === module) {
  createApp().then(({ app, config }) => {
    app.listen(config.port, () => {
      console.log(
        `sel2pw HTTP service listening on :${config.port} (work dir ${config.workDir})`,
      );
    });
  });
}
