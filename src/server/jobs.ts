import * as path from "path";
import * as fs from "fs-extra";
import * as crypto from "crypto";
import { JobRecord, JobStatus } from "./jobTypes";

/**
 * JSON-file-backed job store. Each job is one file under <jobsDir>/<jobId>.json.
 *
 * MVP choice: files instead of SQLite to avoid a native dep on the Converter
 * service. The platform gateway (modern-automation-platform) keeps its own
 * SQLite job table; sel2pw's local store is only the source of truth for
 * its own work-in-progress state. Swap to better-sqlite3 in Phase 1 if write
 * concurrency becomes an issue.
 */
export class JobStore {
  constructor(private readonly jobsDir: string) {}

  async init(): Promise<void> {
    await fs.ensureDir(this.jobsDir);
  }

  newId(): string {
    // cnv_<26-char ulid-ish> — sortable by time prefix.
    const ts = Date.now().toString(36).padStart(8, "0");
    const rand = crypto.randomBytes(9).toString("base64url");
    return `cnv_${ts}${rand}`;
  }

  private pathFor(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  async create(record: JobRecord): Promise<JobRecord> {
    await fs.writeJson(this.pathFor(record.jobId), record, { spaces: 2 });
    return record;
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const p = this.pathFor(jobId);
    if (!(await fs.pathExists(p))) return null;
    return (await fs.readJson(p)) as JobRecord;
  }

  async update(
    jobId: string,
    patch: Partial<JobRecord> & { status?: JobStatus },
  ): Promise<JobRecord | null> {
    const current = await this.get(jobId);
    if (!current) return null;
    const next: JobRecord = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await fs.writeJson(this.pathFor(jobId), next, { spaces: 2 });
    return next;
  }

  async list(): Promise<JobRecord[]> {
    const files = await fs.readdir(this.jobsDir);
    const out: JobRecord[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        out.push((await fs.readJson(path.join(this.jobsDir, f))) as JobRecord);
      } catch {
        // ignore corrupt records
      }
    }
    return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
