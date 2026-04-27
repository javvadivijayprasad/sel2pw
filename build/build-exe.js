/* eslint-disable */
/**
 * Build sel2pw.exe (and Linux/macOS counterparts) using @yao-pkg/pkg.
 *
 * Mirrors the test-prioritization-service tps-tool.spec / pyinstaller flow:
 *   - Bundles dist/cli.js + templates/ + examples/ into one self-contained
 *     binary the user can run with no Node install.
 *   - Output: dist-exe/sel2pw.exe  (Windows)
 *             dist-exe/sel2pw-linux  (Linux)
 *             dist-exe/sel2pw-macos  (macOS)
 *   - Runtime: the CLI lives at the same `dist/cli.js` entry it always has;
 *     pkg's bootstrap hands argv to it. So `sel2pw.exe convert <in> --out <out>`
 *     works exactly like `node dist/cli.js convert <in> --out <out>`.
 *
 * Usage:
 *   npm run build           # produces dist/
 *   npm run build:exe       # this script — produces dist-exe/
 *
 * Optional dependency: @yao-pkg/pkg (the maintained fork of vercel/pkg).
 *   npm install -D @yao-pkg/pkg
 *
 * If the dep isn't installed, this script prints how to install it and
 * exits 0 — so CI builds don't fail when only TS compilation is needed.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "dist-exe");

if (!fs.existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

let pkgEntry;
try {
  pkgEntry = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");
} catch {
  try {
    pkgEntry = require.resolve("pkg/lib-es5/bin.js");
  } catch {
    console.log("");
    console.log("@yao-pkg/pkg not installed — skipping exe build.");
    console.log("Install with:  npm install -D @yao-pkg/pkg");
    console.log("Then re-run:   npm run build:exe");
    console.log("");
    process.exit(0);
  }
}

fs.mkdirSync(OUT, { recursive: true });

// Read pkg config and execute pkg with the right targets.
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "pkg.config.json"), "utf8"));
const targets = (cfg.pkg && cfg.pkg.targets) ? cfg.pkg.targets : ["node18-win-x64"];

console.log(`Building sel2pw exe for: ${targets.join(", ")}`);

// Inject pkg config into a temporary copy of package.json — pkg reads from there.
const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
pkgJson.pkg = cfg.pkg;
const tmpPkgPath = path.join(__dirname, "_pkg-temp-package.json");
fs.writeFileSync(tmpPkgPath, JSON.stringify(pkgJson, null, 2));

// Packages that pkg's V8-bytecode compiler chokes on. Marking them as
// public-packages forces pkg to bundle them as plain JS source (slightly
// larger binary, runs identically).
//
//   - chevrotain: package.json has `module` but no `main`; pkg warns
//   - java-parser: depends on chevrotain
//   - prettier: uses ESM-like patterns that fail bytecode gen
//   - ts-algebra: prettier's dep, same issue
//
// `--fallback-to-source` is the safety net for any other package the
// bytecode compiler can't handle — the binary will simply run JS source
// for that file instead of crashing at load time.
const PUBLIC_PACKAGES = ["chevrotain", "java-parser", "prettier", "ts-algebra"];

// `--public-packages '*'` is the most reliable setting: every package gets
// bundled as plain JS source (skipping bytecode generation entirely).
// Slightly larger binary (~5–10 MB extra) but avoids every bytecode-gen
// failure that pkg can throw. If you want smaller binaries, swap '*' for
// PUBLIC_PACKAGES.join(",") to whitelist only the known-broken ones.
const args = [
  pkgEntry,
  "--config", tmpPkgPath,
  "--output", path.join(OUT, "sel2pw"),
  "--targets", targets.join(","),
  "--compress", cfg.pkg && cfg.pkg.compress ? cfg.pkg.compress : "Brotli",
  "--public-packages", "*",
  "--no-bytecode",
  path.join(DIST, "cli.js"),
];

// Reference kept for the targeted-fix variant — if you need bytecode for
// most packages but want to skip the known-broken ones, replace the two
// flags above with:  `--public-packages ${PUBLIC_PACKAGES.join(",")}`.
void PUBLIC_PACKAGES;

try {
  execFileSync(process.execPath, args, { stdio: "inherit", cwd: ROOT });
} catch (err) {
  console.error("pkg build failed:", err.message);
  process.exit(1);
} finally {
  // Always clean up the temp package.json so we don't pollute the repo.
  try { fs.unlinkSync(tmpPkgPath); } catch {}
}

// Inventory what got built.
const built = fs.readdirSync(OUT).filter((f) => /^sel2pw(\.exe)?(-linux|-macos)?$/.test(f));
console.log("");
console.log("Built artefacts:");
for (const f of built) {
  const stat = fs.statSync(path.join(OUT, f));
  console.log(`  ${path.join("dist-exe", f).padEnd(40)} ${(stat.size / (1024 * 1024)).toFixed(1)} MB`);
}

// Copy companion files alongside the binaries — config sample, run.bat, README.
const companions = ["sel2pw.config.yaml", "run.bat", "README.txt"];
for (const c of companions) {
  const src = path.join(__dirname, c);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT, c));
    console.log(`  ${path.join("dist-exe", c).padEnd(40)} (companion)`);
  }
}

console.log("");
console.log("Done. To distribute, zip the contents of dist-exe/ and serve via the");
console.log("platform's GET /api/v1/downloads/sel2pw.exe endpoint.");
