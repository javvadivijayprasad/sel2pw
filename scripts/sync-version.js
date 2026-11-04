#!/usr/bin/env node
/**
 * One version for npm and the VS Code Marketplace.
 *
 * The root package.json is the single source of truth. This script copies its version into
 * every other place that carries it, so nobody edits them by hand:
 *
 *   vscode-extension/package.json        "version"
 *   vscode-extension/package-lock.json   root "version" (two places)
 *   package-lock.json                    root "version" (two places)
 *   CITATION.cff                         version + date-released (today)
 *
 * It runs automatically as npm's `version` lifecycle hook:
 *
 *   npm version patch --no-git-tag-version     (or minor / major / 2.2.0)
 *
 * and can be run on its own with `npm run sync-version`. No network, no git.
 * The release workflow still refuses a tag that does not match both package.json files.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const d = new Date();
const today = [
  d.getFullYear(),
  String(d.getMonth() + 1).padStart(2, "0"),
  String(d.getDate()).padStart(2, "0"),
].join("-"); // local date

function edit(rel, fn) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.log(`  skip ${rel} (not found)`);
    return;
  }
  const before = fs.readFileSync(file, "utf8");
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(`  updated ${rel}`);
  } else {
    console.log(`  ok      ${rel}`);
  }
}

// Replace only the top-level "version" of a package.json, keeping formatting and line endings.
function setPackageVersion(text) {
  return text.replace(/^(\s{2}"version":\s*)"[^"]*"/m, `$1"${version}"`);
}

// Replace the root project's version in a lock file: top level and packages[""].
function setLockVersion(text) {
  return text
    .replace(/^(\s{2}"version":\s*)"[^"]*"/m, `$1"${version}"`)
    .replace(
      /("packages":\s*\{\s*""\s*:\s*\{[^{}]*?"version":\s*)"[^"]*"/,
      `$1"${version}"`,
    );
}

console.log(`sync-version: ${version}`);
edit("vscode-extension/package.json", setPackageVersion);
edit("vscode-extension/package-lock.json", setLockVersion);
edit("package-lock.json", setLockVersion);
edit("CITATION.cff", (t) =>
  t
    .replace(/^version:.*$/m, `version: ${version}`)
    .replace(/^date-released:.*$/m, `date-released: "${today}"`),
);
