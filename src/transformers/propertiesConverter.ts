import * as path from "path";
import * as fs from "fs-extra";
import fg from "fast-glob";
import { ConvertedFile } from "../types";

/**
 * Java `.properties` → `.env` converter.
 *
 * Common Java pattern: a `config.properties` (or env-specific files) loaded
 * via `Properties.load(new FileInputStream("config.properties"))`. We
 * translate the most common syntax onto a `.env`-style file consumable by
 * `dotenv` from Node, plus a tiny `tests/config.ts` loader for type-safe
 * access in the converted Playwright project.
 */

export async function convertPropertiesFiles(
  inputDir: string,
): Promise<ConvertedFile[]> {
  const matches = await fg(["**/*.properties"], {
    cwd: inputDir,
    absolute: true,
    ignore: ["**/target/**", "**/build/**", "**/.idea/**", "**/node_modules/**"],
  });
  if (matches.length === 0) return [];

  const out: ConvertedFile[] = [];
  const merged: Record<string, string> = {};

  for (const filePath of matches) {
    const text = await fs.readFile(filePath, "utf8");
    const baseName = path.basename(filePath, ".properties");
    const isDefault = baseName === "config" || baseName === "application";
    const lines = text.split(/\r?\n/);
    const envBody = renderEnv(lines, baseName, merged, isDefault);
    out.push({
      relPath: isDefault ? ".env.example" : `.env.${baseName}.example`,
      source: envBody,
      warnings: [],
      kind: "config",
    });
  }

  if (Object.keys(merged).length > 0) {
    out.push({
      relPath: "tests/config.ts",
      source: renderConfigLoader(merged),
      warnings: [],
      kind: "config",
    });
  }

  return out;
}

function renderEnv(
  lines: string[],
  source: string,
  merged: Record<string, string>,
  contributesToConfigTs: boolean,
): string {
  const out: string[] = [];
  out.push(`# Generated from ${source}.properties by sel2pw.`);
  out.push(`# Copy to .env and edit values, or set them in your CI.`);
  out.push("");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }
    if (line.startsWith("#") || line.startsWith("!")) {
      out.push(line.replace(/^!/, "#"));
      continue;
    }
    const m = /^([\w.-]+)\s*[=:]\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].replace(/\./g, "_").toUpperCase();
    const value = m[2].trim();
    out.push(`${key}=${shellQuote(value)}`);
    if (contributesToConfigTs) merged[key] = value;
  }
  return out.join("\n") + "\n";
}

function shellQuote(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function renderConfigLoader(merged: Record<string, string>): string {
  const keys = Object.keys(merged).sort();
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * Type-safe config wrapper around environment variables.`);
  lines.push(` * Auto-generated from your .properties files by sel2pw.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`function required(name: string): string {`);
  lines.push(`  const v = process.env[name];`);
  lines.push(`  if (v === undefined || v === '') {`);
  lines.push("    throw new Error(`Missing required env var: ${name}`);");
  lines.push(`  }`);
  lines.push(`  return v;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`function optional(name: string, fallback = ''): string {`);
  lines.push(`  return process.env[name] ?? fallback;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const config = {`);
  for (const k of keys) {
    const fallback = merged[k];
    if (fallback) {
      lines.push(
        `  ${camelCase(k)}: optional(${JSON.stringify(k)}, ${JSON.stringify(fallback)}),`,
      );
    } else {
      lines.push(`  ${camelCase(k)}: required(${JSON.stringify(k)}),`);
    }
  }
  lines.push(`} as const;`);
  lines.push(``);
  return lines.join("\n");
}

function camelCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_-]/)
    .map((part, i) =>
      i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}
