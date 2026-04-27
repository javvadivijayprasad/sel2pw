import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as path from "path";
import { ProvenanceBlock } from "./jobTypes";

/**
 * Build the provenance block. Shape mirrors what `test-case-generation-service`
 * returns so the platform UI's job-detail view renders both with one component.
 */
export interface ProvenanceInputs {
  version: string;
  engine: "ast" | "hybrid";
  rulesVersion: string;
  governanceConfigPath?: string;
  inputDir: string;
  startedAt: Date;
}

export async function buildProvenance(
  inputs: ProvenanceInputs,
): Promise<ProvenanceBlock> {
  const durationMs = Date.now() - inputs.startedAt.getTime();
  const inputHash = await hashDirectory(inputs.inputDir);
  const govHash = inputs.governanceConfigPath
    ? await hashFile(inputs.governanceConfigPath)
    : undefined;

  return {
    service: "sel2pw",
    version: inputs.version,
    engine: inputs.engine,
    rules_version: inputs.rulesVersion,
    governance_config_hash: govHash,
    input_hash: inputHash,
    started_at: inputs.startedAt.toISOString(),
    duration_ms: durationMs,
  };
}

async function hashFile(p: string): Promise<string | undefined> {
  if (!(await fs.pathExists(p))) return undefined;
  const buf = await fs.readFile(p);
  return "sha256:" + crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Stable hash of a directory tree's contents. We sort entries so the result
 * is deterministic across platforms.
 */
async function hashDirectory(dir: string): Promise<string | undefined> {
  if (!(await fs.pathExists(dir))) return undefined;
  const hash = crypto.createHash("sha256");
  const entries: string[] = [];
  await collect(dir, dir, entries);
  entries.sort();
  for (const rel of entries) {
    hash.update(rel);
    hash.update("\0");
    const buf = await fs.readFile(path.join(dir, rel));
    hash.update(buf);
    hash.update("\0");
  }
  return "sha256:" + hash.digest("hex");
}

async function collect(root: string, cur: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(cur, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(cur, e.name);
    if (e.isDirectory()) {
      if (["target", "build", ".idea", "node_modules", ".git"].includes(e.name)) continue;
      await collect(root, full, out);
    } else if (e.isFile()) {
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
}
