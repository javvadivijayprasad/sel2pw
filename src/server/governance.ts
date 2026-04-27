import * as path from "path";
import * as fs from "fs-extra";
import { request } from "undici";

/**
 * ai-governance integration.
 *
 * The current AST engine doesn't send any code to an LLM, so governance is
 * advisory at v0.1: we still call the sidecar's audit endpoint to record
 * what *would* have been sent, attaching the result as `governance_audit.json`
 * next to `CONVERSION_REVIEW.md`. This makes every conversion job
 * compliance-ready by default and gives us the integration plumbing in place
 * for the Phase 5 hybrid AST+LLM engine, where it becomes load-bearing.
 *
 * Sidecar lives in the ai-governance repo (per INTEGRATION.md) at port 4900.
 */

export interface GovernanceContext {
  /** Sidecar base URL — http://localhost:4900 by default. */
  sidecarUrl: string;
  /** Local path where the resolved config YAML is cached. */
  configPath?: string;
  /** Extra redact regexes appended at request time. */
  redactPatternsExtra?: string[];
}

export interface AuditReportFile {
  service: string;
  governance_config_hash?: string;
  files_inspected: number;
  /** Patterns that fired during inspection. */
  findings: { pattern: string; file: string; count: number }[];
  /** Files skipped because of size or exclusion rules. */
  skipped: { file: string; reason: string }[];
  generated_at: string;
  /**
   * Populated when the sidecar was unreachable. The field is informational —
   * we still emit a report so downstream tooling has a deterministic shape.
   */
  sidecar_error?: string;
}

/**
 * Fetch a config URL (http(s):// or file://) into a local cache path.
 * Returns null if no URL given.
 */
export async function resolveGovernanceConfig(
  configUrl: string | undefined,
  cacheDir: string,
): Promise<string | undefined> {
  if (!configUrl) return undefined;
  await fs.ensureDir(cacheDir);
  const localName = "ai-quality.config.yaml";
  const target = path.join(cacheDir, localName);

  if (configUrl.startsWith("file://")) {
    const src = configUrl.replace(/^file:\/\//, "");
    await fs.copy(src, target, { overwrite: true });
    return target;
  }
  if (configUrl.startsWith("http://") || configUrl.startsWith("https://")) {
    const { body, statusCode } = await request(configUrl);
    if (statusCode >= 400) {
      throw new Error(`Failed to fetch governance config: HTTP ${statusCode}`);
    }
    const buf = Buffer.from(await body.arrayBuffer());
    await fs.writeFile(target, buf);
    return target;
  }
  // Treat as a local path.
  if (await fs.pathExists(configUrl)) {
    await fs.copy(configUrl, target, { overwrite: true });
    return target;
  }
  throw new Error(`Unsupported governance config_url: ${configUrl}`);
}

/**
 * Call the ai-governance sidecar's POST /audit endpoint with the project
 * directory. Returns the audit report (or a stub if the sidecar is offline,
 * because governance shouldn't gate the AST conversion at v0.1).
 */
export async function runGovernanceAudit(
  projectDir: string,
  ctx: GovernanceContext,
): Promise<AuditReportFile> {
  try {
    const fileList = await collectFiles(projectDir);
    const samples = await sampleFiles(projectDir, fileList, 10);
    const { body, statusCode } = await request(`${ctx.sidecarUrl}/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        service: "sel2pw",
        config_path: ctx.configPath,
        redact_patterns_extra: ctx.redactPatternsExtra ?? [],
        files: fileList,
        samples,
      }),
    });
    if (statusCode >= 400) {
      throw new Error(`sidecar /audit returned HTTP ${statusCode}`);
    }
    const json = (await body.json()) as AuditReportFile;
    return json;
  } catch (err: any) {
    return {
      service: "sel2pw",
      governance_config_hash: undefined,
      files_inspected: 0,
      findings: [],
      skipped: [],
      generated_at: new Date().toISOString(),
      sidecar_error: err.message,
    };
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (["target", "build", ".idea", "node_modules", ".git"].includes(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        out.push(path.relative(dir, full).replace(/\\/g, "/"));
      }
    }
  }
  return out.sort();
}

/**
 * Sample up to N small text files for the sidecar to scan. The sidecar
 * decides what's sensitive; sel2pw doesn't read content meaningfully here.
 */
async function sampleFiles(
  dir: string,
  files: string[],
  maxBytes: number,
): Promise<{ path: string; preview: string }[]> {
  const out: { path: string; preview: string }[] = [];
  for (const rel of files.slice(0, 25)) {
    const full = path.join(dir, rel);
    const stat = await fs.stat(full);
    if (stat.size > 64_000) continue;
    const buf = await fs.readFile(full, "utf8").catch(() => "");
    out.push({ path: rel, preview: buf.slice(0, maxBytes * 1024) });
  }
  return out;
}

export async function writeAuditFile(
  outputDir: string,
  audit: AuditReportFile,
): Promise<string> {
  const target = path.join(outputDir, "governance_audit.json");
  await fs.writeJson(target, audit, { spaces: 2 });
  return target;
}
