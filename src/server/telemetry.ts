import * as path from "path";
import * as crypto from "crypto";
import * as fs from "fs-extra";
import { logger } from "../utils/logger";

/**
 * Failure-telemetry store backed by SQLite.
 *
 * What gets recorded:
 *   - Every per-file conversion failure caught by the try/catch in index.ts.
 *   - Every file the scanner classified as "unknown" that wasn't promoted to
 *     a stub by `customUtilDetector`.
 *   - Every `manual`-severity review item (so we see what shapes the auto-
 *     converter is most often deferring on).
 *   - One row per conversion job summarising counts and source stack.
 *
 * Why: when this service runs at scale, the maintainers need a way to see
 * "this annotation pattern fails N times across M users" so the highest-
 * impact patches can be prioritised. The pattern_signature column groups
 * recurring shapes; queries like
 *
 *     SELECT pattern_signature, COUNT(*) FROM conversion_failures
 *     GROUP BY pattern_signature ORDER BY 2 DESC LIMIT 20;
 *
 * surface the most-common failures.
 *
 * Privacy: source_preview is sanitised via ai-governance (caller's
 * responsibility — pass already-sanitised text). Telemetry is local-only
 * by default; opt-in upload lives in src/post/telemetryUpload.ts.
 *
 * The SQLite dep (`better-sqlite3`) is loaded lazily and gracefully degrades
 * to a no-op store when not installed. Telemetry is never load-bearing for
 * conversion correctness.
 */

export type FailureKind =
  | "parse-error" // extractor threw
  | "unknown-classification" // classifier returned "unknown"; no stub
  | "manual-review" // emitted a manual-severity ReviewItem
  | "transformer-error" // body transform threw mid-pipeline
  | "stub-call-residual"; // post-conversion: stub still has callers

export interface FailureRecord {
  jobId: string;
  sourceFile: string; // relative path; never absolute (privacy)
  fileKind: string; // page-object / test-class / base / unknown / config
  failureKind: FailureKind;
  errorMessage?: string;
  sourceHash: string; // sha256 of input source — for dedup across jobs
  sourcePreview?: string; // first N chars, ALREADY sanitised
  patternSignature: string; // stable hash for grouping similar failures
  createdAt: string;
}

export interface JobRecord {
  jobId: string;
  sourceStack: string;
  filesScanned: number;
  filesSucceeded: number;
  filesFailed: number;
  manualCount: number;
  warningCount: number;
  infoCount: number;
  startedAt: string;
  endedAt?: string;
  status: "running" | "succeeded" | "failed";
}

export interface FailureStore {
  recordJob(record: JobRecord): void;
  recordFailure(record: FailureRecord): void;
  finishJob(jobId: string, status: "succeeded" | "failed"): void;
  listRecentFailures(limit?: number): FailureRecord[];
  listFailurePatterns(limit?: number): { signature: string; count: number; sample: FailureRecord }[];
  getStats(): {
    totalJobs: number;
    totalFailures: number;
    byFailureKind: Record<string, number>;
    byFileKind: Record<string, number>;
    successRate: number;
  };
  close(): void;
}

interface BetterSqlite3Module {
  default: new (path: string) => BetterSqlite3Database;
}
interface BetterSqlite3Database {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

let cachedSqlite: BetterSqlite3Module | null = null;
let sqliteMissing = false;

function loadSqlite(): BetterSqlite3Module | null {
  if (sqliteMissing) return null;
  if (cachedSqlite) return cachedSqlite;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedSqlite = require("better-sqlite3") as BetterSqlite3Module;
    return cachedSqlite;
  } catch {
    sqliteMissing = true;
    logger.info(
      "better-sqlite3 not installed — failure telemetry disabled (`npm install better-sqlite3` to enable).",
    );
    return null;
  }
}

/** Create a failure store. Returns a no-op store when better-sqlite3 isn't
 * available OR when the SQLite open itself fails (SQLITE_BUSY, locked file,
 * permission denied, full disk, etc.). Telemetry is best-effort by design —
 * it must never break a conversion run.
 *
 * The realworld fixtures suite triggered SQLITE_BUSY on macOS-Node-18 and
 * Windows-Node-22 cells because parallel test cases all opened the same
 * default db path with WAL mode. Catch + fall back to no-op fixes that
 * crash without changing the public contract.
 */
export function createFailureStore(dbPath: string): FailureStore {
  const sqlite = loadSqlite();
  if (!sqlite) return makeNoopStore();
  try {
    fs.ensureDirSync(path.dirname(dbPath));
    return makeSqliteStore(sqlite, dbPath);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "UNKNOWN";
    logger.warn(
      { code, dbPath, err: (err as Error).message },
      "Failed to open telemetry SQLite store — falling back to no-op. Conversion continues without failure telemetry.",
    );
    return makeNoopStore();
  }
}

// ---------------- SQLite-backed store ----------------

function makeSqliteStore(
  sqlite: BetterSqlite3Module,
  dbPath: string,
): FailureStore {
  // Parameter shape: better-sqlite3's default export is the constructor.
  // Some versions ship as { default: ... }, some as the function directly.
  const Ctor = (sqlite as unknown as { default?: typeof sqlite.default }).default ?? (sqlite as unknown as new (p: string) => BetterSqlite3Database);
  const db = new Ctor(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversion_jobs (
      jobId TEXT PRIMARY KEY,
      sourceStack TEXT NOT NULL,
      filesScanned INTEGER NOT NULL DEFAULT 0,
      filesSucceeded INTEGER NOT NULL DEFAULT 0,
      filesFailed INTEGER NOT NULL DEFAULT 0,
      manualCount INTEGER NOT NULL DEFAULT 0,
      warningCount INTEGER NOT NULL DEFAULT 0,
      infoCount INTEGER NOT NULL DEFAULT 0,
      startedAt TEXT NOT NULL,
      endedAt TEXT,
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE TABLE IF NOT EXISTS conversion_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jobId TEXT NOT NULL,
      sourceFile TEXT NOT NULL,
      fileKind TEXT NOT NULL,
      failureKind TEXT NOT NULL,
      errorMessage TEXT,
      sourceHash TEXT NOT NULL,
      sourcePreview TEXT,
      patternSignature TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (jobId) REFERENCES conversion_jobs(jobId)
    );

    CREATE INDEX IF NOT EXISTS idx_failures_signature ON conversion_failures(patternSignature);
    CREATE INDEX IF NOT EXISTS idx_failures_kind      ON conversion_failures(failureKind);
    CREATE INDEX IF NOT EXISTS idx_failures_created   ON conversion_failures(createdAt);
  `);

  const insertJob = db.prepare(`
    INSERT INTO conversion_jobs
      (jobId, sourceStack, filesScanned, filesSucceeded, filesFailed,
       manualCount, warningCount, infoCount, startedAt, endedAt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(jobId) DO UPDATE SET
      filesScanned = excluded.filesScanned,
      filesSucceeded = excluded.filesSucceeded,
      filesFailed = excluded.filesFailed,
      manualCount = excluded.manualCount,
      warningCount = excluded.warningCount,
      infoCount = excluded.infoCount,
      endedAt = excluded.endedAt,
      status = excluded.status
  `);

  const insertFailure = db.prepare(`
    INSERT INTO conversion_failures
      (jobId, sourceFile, fileKind, failureKind, errorMessage,
       sourceHash, sourcePreview, patternSignature, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const finishJobStmt = db.prepare(`
    UPDATE conversion_jobs SET status = ?, endedAt = ? WHERE jobId = ?
  `);

  const recentFailuresStmt = db.prepare(`
    SELECT jobId, sourceFile, fileKind, failureKind, errorMessage,
           sourceHash, sourcePreview, patternSignature, createdAt
    FROM conversion_failures
    ORDER BY createdAt DESC
    LIMIT ?
  `);

  const patternsStmt = db.prepare(`
    SELECT patternSignature AS signature, COUNT(*) AS count
    FROM conversion_failures
    GROUP BY patternSignature
    ORDER BY count DESC
    LIMIT ?
  `);

  const sampleByPatternStmt = db.prepare(`
    SELECT jobId, sourceFile, fileKind, failureKind, errorMessage,
           sourceHash, sourcePreview, patternSignature, createdAt
    FROM conversion_failures WHERE patternSignature = ? LIMIT 1
  `);

  const statsByFailureKindStmt = db.prepare(`
    SELECT failureKind, COUNT(*) AS count FROM conversion_failures GROUP BY failureKind
  `);
  const statsByFileKindStmt = db.prepare(`
    SELECT fileKind, COUNT(*) AS count FROM conversion_failures GROUP BY fileKind
  `);
  const totalJobsStmt = db.prepare(`SELECT COUNT(*) AS c FROM conversion_jobs`);
  const totalFailuresStmt = db.prepare(`SELECT COUNT(*) AS c FROM conversion_failures`);
  const totalSucceededStmt = db.prepare(`SELECT SUM(filesSucceeded) AS s, SUM(filesScanned) AS t FROM conversion_jobs`);

  return {
    recordJob(record) {
      insertJob.run(
        record.jobId,
        record.sourceStack,
        record.filesScanned,
        record.filesSucceeded,
        record.filesFailed,
        record.manualCount,
        record.warningCount,
        record.infoCount,
        record.startedAt,
        record.endedAt ?? null,
        record.status,
      );
    },
    recordFailure(record) {
      insertFailure.run(
        record.jobId,
        record.sourceFile,
        record.fileKind,
        record.failureKind,
        record.errorMessage ?? null,
        record.sourceHash,
        record.sourcePreview ?? null,
        record.patternSignature,
        record.createdAt,
      );
    },
    finishJob(jobId, status) {
      finishJobStmt.run(status, new Date().toISOString(), jobId);
    },
    listRecentFailures(limit = 50) {
      return recentFailuresStmt.all(limit) as FailureRecord[];
    },
    listFailurePatterns(limit = 20) {
      const rows = patternsStmt.all(limit) as { signature: string; count: number }[];
      return rows.map((r) => ({
        signature: r.signature,
        count: r.count,
        sample: sampleByPatternStmt.get(r.signature) as FailureRecord,
      }));
    },
    getStats() {
      const byFailureKind = Object.fromEntries(
        (statsByFailureKindStmt.all() as { failureKind: string; count: number }[]).map(
          (r) => [r.failureKind, r.count],
        ),
      );
      const byFileKind = Object.fromEntries(
        (statsByFileKindStmt.all() as { fileKind: string; count: number }[]).map(
          (r) => [r.fileKind, r.count],
        ),
      );
      const totalJobs = (totalJobsStmt.get() as { c: number }).c;
      const totalFailures = (totalFailuresStmt.get() as { c: number }).c;
      const tot = totalSucceededStmt.get() as { s: number | null; t: number | null };
      const successRate = tot.t && tot.s ? tot.s / tot.t : 0;
      return { totalJobs, totalFailures, byFailureKind, byFileKind, successRate };
    },
    close() {
      db.close();
    },
  };
}

function makeNoopStore(): FailureStore {
  return {
    recordJob() {},
    recordFailure() {},
    finishJob() {},
    listRecentFailures: () => [],
    listFailurePatterns: () => [],
    getStats: () => ({
      totalJobs: 0,
      totalFailures: 0,
      byFailureKind: {},
      byFileKind: {},
      successRate: 0,
    }),
    close() {},
  };
}

// ---------------- helpers ----------------

/**
 * Stable hash of a "pattern" — the shape that failed. Used so recurring
 * shapes group together. The caller decides what goes in (className shape,
 * unmatched annotation snippet, error message stripped of paths, etc.).
 */
export function patternHash(...parts: string[]): string {
  const norm = parts
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ");
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function sourceHash(content: string): string {
  return "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
}
