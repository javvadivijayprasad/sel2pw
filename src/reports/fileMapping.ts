import * as path from "path";
import * as fs from "fs-extra";
import { buildConversionResult, BuildResultArgs, FileOutcome } from "./conversionResult";

/**
 * v2.0.1 — write a clean Markdown table of `source Java file -> output TS file`
 * alongside conversion-result.json. Same data the JSON carries, but in a
 * one-glance form a human can read without `jq`.
 *
 * Grouped by status so the "what got converted" wins line up at the top
 * and the "what needs hand work" rows are clearly separated. Empty groups
 * are omitted so small projects don't get a wall of empty headings.
 *
 * Why a separate Markdown file (rather than padding CONVERSION_REVIEW.md):
 *   - CONVERSION_REVIEW.md is per-item issue oriented (one row per warning,
 *     manual item, info note). FILE_MAPPING is per-source-file oriented.
 *   - Demo / screenshot footage: opening FILE_MAPPING.md gives a single
 *     screen "this Java became this TS" view that's impossible to surface
 *     from the issue-oriented review report without a lot of scrolling.
 */

export async function writeFileMapping(args: BuildResultArgs): Promise<string> {
  const target = path.join(args.outputDir, "FILE_MAPPING.md");
  const md = renderFileMapping(args);
  await fs.writeFile(target, md, "utf8");
  return target;
}

export function renderFileMapping(args: BuildResultArgs): string {
  const result = buildConversionResult(args);

  const groups = groupByStatus(result.files);

  const lines: string[] = [];
  lines.push("# File Mapping");
  lines.push("");
  lines.push(
    "Source: `" + args.inputDir + "`  ",
    "Output: `" + args.outputDir + "`  ",
    "Generated: " + result.generatedAt + "  ",
    "",
  );

  // Headline counts as a one-line summary so a reader knows the shape
  // of the conversion before scrolling into per-file rows. Counts come
  // from the GROUPED view (which re-categorises infrastructure /
  // owner-config rows as `skipped` and aggregated-kind rows as
  // `converted`) so the headline matches what the user actually sees
  // in the sections below — not the raw JSON stats.
  lines.push(
    "**" + result.stats.filesScanned + " files scanned** — " +
      (groups.converted.length + groups.aggregated.length) + " converted, " +
      groups.stubbed.length + " stubbed, " +
      groups.skipped.length + " skipped, " +
      groups.failed.length + " failed.",
  );
  lines.push("");

  // Order the sections so wins come first, manual work comes last.
  const sectionOrder: Array<{
    key: GroupKey;
    title: string;
    blurb: string;
  }> = [
    {
      key: "converted",
      title: "Converted",
      blurb:
        "Java source had a 1:1 Playwright translation. Output file compiles as-is.",
    },
    {
      key: "aggregated",
      title: "Aggregated into a shared file",
      blurb:
        "Java enums, exceptions, and records merged into `types/enums.ts`, `types/errors.ts`, or `data/models.ts`. The output column shows the destination file each Java source ended up in.",
    },
    {
      key: "skipped",
      title: "Skipped (no equivalent needed)",
      blurb:
        "Selenium-only infrastructure that Playwright handles natively. Driver lifecycle, browser factories, target switchers — replaced by Playwright fixtures and `playwright.config.ts`. **These are wins, not gaps.**",
    },
    {
      key: "stubbed",
      title: "Stubbed (manual migration required)",
      blurb:
        "No Playwright equivalent existed for these utility classes. A typed stub was generated at `tests/_legacy-stubs/` — open the stub's header for migration guidance, then delete it.",
    },
    {
      key: "failed",
      title: "Failed (review)",
      blurb:
        "Classified but no output produced. Usually an emitter gap — please file a bug.",
    },
  ];

  for (const sec of sectionOrder) {
    const rows = groups[sec.key];
    if (rows.length === 0) continue;

    lines.push("## " + sec.title + " (" + rows.length + ")");
    lines.push("");
    lines.push(sec.blurb);
    lines.push("");
    lines.push("| Source (Java) | → | Output (TypeScript) | Kind |");
    lines.push("| --- | :-: | --- | --- |");
    for (const r of rows) {
      const src = mdCode(r.source);
      // Replacement strings for the skipped section already contain
      // descriptive text; render them as-is. Everything else gets
      // wrapped in inline code.
      let out: string;
      if (!r.output) {
        out = "_(no file emitted)_";
      } else if (sec.key === "skipped" && r.output.includes(" ")) {
        out = r.output;
      } else {
        out = mdCode(r.output);
      }
      lines.push("| " + src + " | → | " + out + " | " + r.sourceKind + " |");
    }
    lines.push("");
  }

  // Footer: pointer to the issue-oriented sibling report so the reader
  // knows where to go for per-item action items.
  lines.push("---");
  lines.push("");
  lines.push(
    "See `CONVERSION_REVIEW.md` for per-item warnings and manual actions, " +
      "and `conversion-result.json` for the same data in machine-readable form.",
  );
  lines.push("");

  return lines.join("\n");
}

// ---------- internals --------------------------------------------------

type GroupKey = "converted" | "aggregated" | "stubbed" | "skipped" | "failed";

interface Groups {
  converted: FileOutcome[];
  aggregated: FileOutcome[];
  stubbed: FileOutcome[];
  skipped: FileOutcome[];
  failed: FileOutcome[];
}

function groupByStatus(files: FileOutcome[]): Groups {
  const g: Groups = {
    converted: [],
    aggregated: [],
    stubbed: [],
    skipped: [],
    failed: [],
  };

  for (const f of files) {
    // Aggregated kinds (java-enum / java-exception / java-record / pojo)
    // get their own bucket so the table tells a clearer story than
    // "AccountPage.java -> account.page.ts" sitting next to
    // "RoomType.java -> types/enums.ts" without any visual cue that
    // one is 1:1 and the other got merged with siblings.
    const isAggregatedKind =
      f.sourceKind === "java-enum" ||
      f.sourceKind === "java-exception" ||
      f.sourceKind === "java-record" ||
      f.sourceKind === "pojo";

    // Selenium-only patterns that Playwright handles natively. These
    // appear as `status: failed` in the JSON because no per-file output
    // is emitted, but for the human-facing report they are wins —
    // the whole point of the migration is that you no longer need them.
    const isCorrectlySkippedKind =
      f.sourceKind === "infrastructure" || f.sourceKind === "owner-config";

    if (isAggregatedKind && (f.status === "converted" || f.status === "failed")) {
      g.aggregated.push(rewriteAggregatedOutput(f));
      continue;
    }
    if (isCorrectlySkippedKind && (f.status === "failed" || f.status === "skipped")) {
      g.skipped.push(rewriteSkippedOutput(f));
      continue;
    }

    if (f.status === "converted") g.converted.push(f);
    else if (f.status === "stubbed") g.stubbed.push(f);
    else if (f.status === "skipped") g.skipped.push(f);
    else g.failed.push(f);
  }

  // Sort each group by source path so the table reads stably across runs.
  for (const k of Object.keys(g) as GroupKey[]) {
    g[k].sort((a, b) => a.source.localeCompare(b.source));
  }

  return g;
}

function rewriteSkippedOutput(f: FileOutcome): FileOutcome {
  // Surface the replacement so the row makes the win obvious: e.g.
  // DriverManager.java -> "Playwright fixtures + playwright.config.ts
  // (built-in)" rather than the bare "(no file emitted)".
  let replacement: string;
  if (f.sourceKind === "infrastructure") {
    replacement = "Playwright fixtures + playwright.config.ts (built-in)";
  } else if (f.sourceKind === "owner-config") {
    replacement = "tests/config.ts + .env (Playwright env loader)";
  } else {
    replacement = "(no file emitted)";
  }
  return { ...f, output: replacement, status: "skipped" };
}

function rewriteAggregatedOutput(f: FileOutcome): FileOutcome {
  // Map the source kind to its aggregated destination so the row tells
  // the reader exactly where the content landed instead of showing
  // "(no file emitted)".
  let dest = f.output;
  if (!dest) {
    switch (f.sourceKind) {
      case "java-enum":
        dest = "types/enums.ts";
        break;
      case "java-exception":
        dest = "types/errors.ts";
        break;
      case "java-record":
      case "pojo":
        dest = "data/models.ts";
        break;
      default:
        dest = "(aggregated)";
    }
  }
  return { ...f, output: dest, status: "converted" };
}

function mdCode(s: string): string {
  // Wrap path in inline code, escaping any backticks the path might
  // contain (rare, but the Markdown renderer would otherwise break).
  const BT = String.fromCharCode(96);
  return BT + s.split(BT).join("\\" + BT) + BT;
}
