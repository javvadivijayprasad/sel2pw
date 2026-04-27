import * as path from "path";
import * as fs from "fs-extra";
import archiver from "archiver";
import { Readable } from "stream";

/**
 * Artifact storage abstraction.
 *
 * `local` driver is used for dev and tests. `s3` is a stub — its real
 * implementation lives in Phase 0's "Artifact storage abstraction" follow-up
 * (we'd reuse the platform's `packages/artifact-builder` once sel2pw folds
 * into the monorepo).
 *
 * URIs use a scheme prefix:
 *   - file:///abs/path/output.zip
 *   - s3://bucket/key.zip
 */
export interface ArtifactDriver {
  /** Persist a directory of files as a zip; returns a storage URI. */
  putDirectoryAsZip(srcDir: string, destKey: string): Promise<string>;
  /** Persist a single file (e.g. CONVERSION_REVIEW.md, governance_audit.json). */
  putFile(srcPath: string, destKey: string): Promise<string>;
  /** Resolve a URI to a readable stream so the HTTP layer can serve it. */
  openRead(uri: string): Promise<{ stream: Readable; contentType: string; size?: number }>;
}

export class LocalArtifactDriver implements ArtifactDriver {
  constructor(private readonly rootDir: string) {}

  async putDirectoryAsZip(srcDir: string, destKey: string): Promise<string> {
    const target = path.join(this.rootDir, destKey);
    await fs.ensureDir(path.dirname(target));
    await zipDirectory(srcDir, target);
    return `file://${target.replace(/\\/g, "/")}`;
  }

  async putFile(srcPath: string, destKey: string): Promise<string> {
    const target = path.join(this.rootDir, destKey);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(srcPath, target, { overwrite: true });
    return `file://${target.replace(/\\/g, "/")}`;
  }

  async openRead(
    uri: string,
  ): Promise<{ stream: Readable; contentType: string; size?: number }> {
    const localPath = uri.startsWith("file://")
      ? uri.replace(/^file:\/\//, "")
      : uri;
    const stat = await fs.stat(localPath);
    const ext = path.extname(localPath).toLowerCase();
    const contentType =
      ext === ".zip"
        ? "application/zip"
        : ext === ".md"
          ? "text/markdown"
          : ext === ".json"
            ? "application/json"
            : "application/octet-stream";
    return {
      stream: fs.createReadStream(localPath),
      contentType,
      size: stat.size,
    };
  }
}

export class S3ArtifactDriver implements ArtifactDriver {
  // TODO(phase-1): implement using @aws-sdk/client-s3 or use the platform's
  // existing artifact-builder package once sel2pw folds into the monorepo.
  constructor(private readonly bucket: string) {}
  putDirectoryAsZip(): Promise<string> {
    throw new Error("S3 driver not yet implemented");
  }
  putFile(): Promise<string> {
    throw new Error("S3 driver not yet implemented");
  }
  openRead(): Promise<{ stream: Readable; contentType: string }> {
    throw new Error("S3 driver not yet implemented");
  }
}

export function makeArtifactDriver(
  config: { driver: "local" | "s3"; rootDir?: string; bucket?: string },
): ArtifactDriver {
  if (config.driver === "s3") {
    if (!config.bucket) throw new Error("s3 driver requires bucket");
    return new S3ArtifactDriver(config.bucket);
  }
  if (!config.rootDir) throw new Error("local driver requires rootDir");
  return new LocalArtifactDriver(config.rootDir);
}

async function zipDirectory(srcDir: string, destZipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(out);
    archive.directory(srcDir, false);
    archive.finalize().catch(reject);
  });
}
