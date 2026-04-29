import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { convert, analyze } from "@vijaypjavvadi/sel2pw";

/**
 * sel2pw VS Code extension entry point.
 *
 * Three commands, surfaced both via the command palette and the explorer
 * right-click context menu (when a folder is selected):
 *
 *   - sel2pw.convertFolder  — convert a Selenium project to Playwright in-place
 *   - sel2pw.analyzeFolder  — dry-run; show what would convert without writing
 *   - sel2pw.openReview     — open CONVERSION_REVIEW.md from a converted output
 *
 * Settings are read from the `sel2pw.*` namespace in user/workspace settings.
 * See package.json `contributes.configuration`.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sel2pw.convertFolder", convertFolderCommand),
    vscode.commands.registerCommand("sel2pw.analyzeFolder", analyzeFolderCommand),
    vscode.commands.registerCommand("sel2pw.openReview", openReviewCommand),
  );
}

export function deactivate(): void {
  // no-op
}

async function convertFolderCommand(uri?: vscode.Uri): Promise<void> {
  const inputDir = await pickFolder(uri, "Select the Selenium project folder to convert");
  if (!inputDir) return;

  const cfg = vscode.workspace.getConfiguration("sel2pw");
  const suffix = cfg.get<string>("outputSuffix") ?? "-playwright";
  const outputDir = inputDir + suffix;

  // Confirm overwrite if output already exists.
  if (fs.existsSync(outputDir)) {
    const confirm = await vscode.window.showWarningMessage(
      `Output directory already exists:\n${outputDir}\n\nOverwrite?`,
      { modal: true },
      "Overwrite",
      "Cancel",
    );
    if (confirm !== "Overwrite") return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "sel2pw — Converting Selenium → Playwright",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Scanning Java files…" });

      try {
        const result = await convert({
          inputDir,
          outputDir,
          formatOutput: cfg.get<boolean>("format") ?? true,
          validateOutput: cfg.get<boolean>("validate") ?? true,
          emitSelfHealingShim: cfg.get<boolean>("emitSelfHealingShim") ?? false,
          emitAuthSetup: cfg.get<boolean>("emitAuthSetup") ?? true,
        });

        progress.report({ increment: 100, message: "Done." });

        const stats = result.summary;
        const message =
          `Converted ${stats.filesScanned} file(s): ` +
          `${convertedCount(result.files)} converted, ` +
          `${stubbedCount(result.files)} stubbed, ` +
          `${stats.warnings.length} review item(s).`;

        const action = await vscode.window.showInformationMessage(
          message,
          "Open Output Folder",
          "Open Review Report",
        );

        if (action === "Open Output Folder") {
          await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(outputDir), {
            forceNewWindow: true,
          });
        } else if (action === "Open Review Report") {
          await openReviewIn(outputDir);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`sel2pw conversion failed: ${msg}`);
      }
    },
  );
}

async function analyzeFolderCommand(uri?: vscode.Uri): Promise<void> {
  const inputDir = await pickFolder(uri, "Select the Selenium project folder to analyze");
  if (!inputDir) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "sel2pw — Analyzing project (no files written)",
      cancellable: false,
    },
    async () => {
      try {
        const result = await analyze(inputDir);
        const channel = vscode.window.createOutputChannel("sel2pw — Analyze");
        channel.clear();
        channel.appendLine(`Project: ${inputDir}`);
        channel.appendLine(`Files scanned: ${result.filesScanned}`);
        channel.appendLine("");
        channel.appendLine("File classifications:");
        for (const f of result.files) {
          channel.appendLine(`  ${(f.kind ?? "unknown").padEnd(13)} ${f.relPath ?? f.className}`);
        }
        channel.show(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`sel2pw analyze failed: ${msg}`);
      }
    },
  );
}

async function openReviewCommand(uri?: vscode.Uri): Promise<void> {
  const folder = await pickFolder(uri, "Select the converted output folder");
  if (!folder) return;
  await openReviewIn(folder);
}

async function openReviewIn(outputDir: string): Promise<void> {
  const reviewPath = path.join(outputDir, "CONVERSION_REVIEW.md");
  if (!fs.existsSync(reviewPath)) {
    vscode.window.showWarningMessage(
      `No CONVERSION_REVIEW.md found in ${outputDir}. Run sel2pw: Convert first.`,
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(reviewPath);
  await vscode.window.showTextDocument(doc, { preview: false });

  // Also open MIGRATION_NOTES.md side-by-side if it exists.
  const notesPath = path.join(outputDir, "MIGRATION_NOTES.md");
  if (fs.existsSync(notesPath)) {
    const notesDoc = await vscode.workspace.openTextDocument(notesPath);
    await vscode.window.showTextDocument(notesDoc, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }
}

/**
 * Pick a folder — uses the right-click target if invoked from the explorer
 * context menu, otherwise prompts the user via showOpenDialog.
 */
async function pickFolder(uri: vscode.Uri | undefined, prompt: string): Promise<string | null> {
  if (uri && uri.fsPath) {
    const stat = fs.statSync(uri.fsPath);
    if (stat.isDirectory()) return uri.fsPath;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: prompt,
  });
  return picked?.[0]?.fsPath ?? null;
}

function convertedCount(files: { warnings?: { severity: string }[]; kind?: string }[]): number {
  return files.filter((f) => f.kind !== "config" || !f.kind).length;
}

function stubbedCount(files: { relPath?: string }[]): number {
  return files.filter((f) => f.relPath?.includes("_legacy-stubs")).length;
}
