# sel2pw — Deployment Guide

*Version 0.10.0 · April 2026 · Production server: shared with the modern-automation-platform on `app.testforge-ai.com`*

> **Summary.** `sel2pw` is the Selenium → Playwright Converter — one of the four sibling services in the modern-automation-platform alongside `test-prioritization-service`, `self-healing-stage-services`, and `ai-governance`. This document is the single reference for: how it deploys, what artefacts it ships, where the binary lives on the VPS, how the platform UI lets users download it, and how to verify a deploy.

---

## 1. Architecture Overview

`sel2pw` is a Node/TypeScript service that ships in **three forms**:

| Form | When to use | Where it lives |
| --- | --- | --- |
| **HTTP service** (port 4200) | The platform proxies through `/api/v1/converter/*` | `/var/www/testforge-ai/Converter` (systemd) |
| **`sel2pw.exe`** (single-file binary) | User downloads it from the platform UI | `/var/www/testforge-ai/downloads/sel2pw.exe` |
| **`sel2pw` npm package** | Developers using the CLI standalone | published from the same repo |

### 1.1 Components

| Component | Tech / Port | Where it lives |
| --- | --- | --- |
| `Converter` API | Node + Express + TypeScript, :4200 | `/var/www/testforge-ai/Converter` |
| `sel2pw.exe` | `pkg`-bundled Node 18 binary | `/var/www/testforge-ai/downloads/sel2pw.exe` |
| `sel2pw.zip` | exe + run.bat + sel2pw.config.yaml + README.txt | `/var/www/testforge-ai/downloads/sel2pw.zip` |
| Telemetry SQLite | local-only by default | `/var/www/testforge-ai/Converter/.sel2pw/telemetry.db` |
| `ai-governance` | sibling Python lib + sidecar | `/var/www/testforge-ai/ai-governance` |

### 1.2 Process supervision

The Converter API runs as a systemd unit `sel2pw-api.service`, mirroring the `testforge-api.service` pattern from the platform. The user-facing `sel2pw.exe` binary is not a long-lived process — it's a one-shot CLI users download and run locally.

### 1.3 Routing

- `/api/v1/converter/*` → `127.0.0.1:4200` (the gateway proxies)
- `/api/v1/downloads/sel2pw/info` → metadata about the latest `sel2pw.exe` build
- `/api/v1/downloads/sel2pw.exe` → streams the binary (JWT auth required)
- `/api/v1/downloads/sel2pw.zip` → streams the full bundle (exe + companions)

---

## 2. Server Prerequisites

This section documents the one-time setup that's already complete on `app.testforge-ai.com`. Use it as a reference when rebuilding from scratch.

### 2.1 Server

- Provider: Kamatera, Ubuntu 22.04 LTS (same VPS as the platform)
- Repo path: `/var/www/testforge-ai/Converter`
- Downloads dir: `/var/www/testforge-ai/downloads/`

### 2.2 Installed packages

```bash
# Node 20 (NodeSource), npm
node --version    # → v20.x
# pkg for exe builds
npm install -g @yao-pkg/pkg
# Optional: better-sqlite3 native build needs build-essential
apt install -y build-essential python3
```

### 2.3 systemd unit

`/etc/systemd/system/sel2pw-api.service`:

```ini
[Unit]
Description=sel2pw Converter API
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/testforge-ai/Converter
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=4200
Environment=SEL2PW_WORK_DIR=/var/www/testforge-ai/Converter/.sel2pw
Environment=AI_GOVERNANCE_SIDECAR_URL=http://localhost:4900
EnvironmentFile=-/var/www/testforge-ai/Converter/.env

[Install]
WantedBy=multi-user.target
```

After any edit:

```bash
systemctl daemon-reload
systemctl restart sel2pw-api
systemctl enable sel2pw-api
```

Logs:

```bash
journalctl -u sel2pw-api -n 100 -f
```

---

## 3. Environment variables

`.env` lives at `/var/www/testforge-ai/Converter/.env` (NOT in git). Template is `.env.example` in the repo.

| Variable | Production value / notes |
| --- | --- |
| `PORT` | `4200` |
| `SEL2PW_WORK_DIR` | `/var/www/testforge-ai/Converter/.sel2pw` |
| `AI_GOVERNANCE_SIDECAR_URL` | `http://localhost:4900` |
| `CONVERTER_WEBHOOK_SECRET` | shared secret with the platform gateway for HMAC-signed callbacks |
| `SEL2PW_ADMIN_SECRET` | guards `/admin/*` telemetry endpoints |
| `SEL2PW_TELEMETRY_DB` | usually `${SEL2PW_WORK_DIR}/telemetry.db` |
| `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` / `GOOGLE_API_KEY`) | optional, for `--llm-fallback` |

---

## 4. Standard Deployment — Push to main

Defined in `.github/workflows/deploy.yml`. On every push to `main`:

1. GitHub Actions runs `npm ci && npm run build && npm test`.
2. SSH to `VPS_HOST` and run `bash scripts/deploy-app.sh`.
3. The script: `git pull`, `npm install --legacy-peer-deps`, `npm run build`, `npm run build:exe`, copies `dist-exe/sel2pw.exe` + companions to `/var/www/testforge-ai/downloads/`, `systemctl restart sel2pw-api`.

### 4.1 What `deploy-app.sh` does

Source: `scripts/deploy-app.sh`.

```bash
git pull origin main
npm install --legacy-peer-deps
npm run build
npm test                          # 45+ vitest cases must pass
npm run build:exe                 # produces dist-exe/sel2pw.exe
mkdir -p /var/www/testforge-ai/downloads
cp dist-exe/sel2pw.exe        /var/www/testforge-ai/downloads/
cp build/run.bat              /var/www/testforge-ai/downloads/
cp build/sel2pw.config.yaml   /var/www/testforge-ai/downloads/
cp build/README.txt           /var/www/testforge-ai/downloads/
(cd /var/www/testforge-ai/downloads && zip -j sel2pw.zip sel2pw.exe run.bat sel2pw.config.yaml README.txt)
systemctl restart sel2pw-api
systemctl is-active sel2pw-api    # → must say active
```

### 4.2 GitHub Actions secrets

Set at repo → Settings → Secrets:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | IP of the Kamatera VPS |
| `VPS_USER` | `root` (or deploy user) |
| `VPS_PASSWORD` | password for `VPS_USER` |

---

## 5. User-facing download flow (platform UI)

The platform UI shows a "Migrate Selenium → Playwright" tile in the Frameworks section. When the user clicks it:

1. UI calls `GET /api/v1/downloads/sel2pw/info` — gets `{ version, sizeMB, updatedAt, downloadUrl }`.
2. UI shows a one-page wizard: choose source language (auto / java / csharp), confirm.
3. User clicks "Download bundle" → UI hits `GET /api/v1/downloads/sel2pw.zip` (JWT bearer auth) and streams the zip to the user's machine.
4. User extracts the zip and runs:
   ```cmd
   run.bat C:\path\to\my-selenium-project
   ```
   Or directly:
   ```cmd
   sel2pw.exe convert C:\path\to\my-selenium-project --out C:\path\to\my-playwright-project
   ```

The UI flow lives in `apps/platform-ui/src/pages/frameworks/migrate.tsx` (to be added — same shape as the existing TPS tile).

---

## 6. Result writeback — what the user sees after running sel2pw

Every conversion produces these files in the output directory (alongside the converted Playwright project):

| File | Purpose |
| --- | --- |
| `CONVERSION_REVIEW.md` | Human-readable line-by-line review punch list |
| `MIGRATION_NOTES.md` | What to delete from `pom.xml`, CI changes, parity playbook |
| `conversion-result.json` | **Structured per-file outcome** (Phase 10) |
| `governance_audit.json` | ai-governance audit (when sidecar reachable) |

`conversion-result.json` shape (stable contract — `schema: "sel2pw.conversion-result.v1"`):

```json
{
  "schema": "sel2pw.conversion-result.v1",
  "inputDir": "C:\\path\\to\\my-selenium-project",
  "outputDir": "C:\\path\\to\\my-playwright-project",
  "sourceStack": "java-testng",
  "generatedAt": "2026-04-26T01:23:45Z",
  "stats": {
    "filesScanned": 8,
    "converted": 5,
    "stubbed": 2,
    "skipped": 0,
    "failed": 1,
    "manualReviewItems": 3,
    "warningItems": 1,
    "infoItems": 4
  },
  "files": [
    {
      "source": "src/test/java/.../LoginTest.java",
      "output": "tests/login.spec.ts",
      "sourceKind": "test-class",
      "status": "converted",
      "reason": "Converted; one or more warnings to verify.",
      "action": "WebDriverWait removed (Playwright auto-waits). If a specific assertion was needed, add expect(locator).toBeVisible() etc.",
      "severity": "warning"
    },
    {
      "source": "src/test/java/.../ExcelUtility.java",
      "output": "tests/_legacy-stubs/excel-utility.ts",
      "sourceKind": "unknown",
      "status": "stubbed",
      "reason": "No 1:1 Playwright equivalent — typed stub generated.",
      "action": "Open the stub file's header for migration guidance. Replace each call site with a Playwright primitive, then delete the stub.",
      "severity": "manual"
    }
  ],
  "projectNotes": [
    {
      "severity": "info",
      "message": "Source stack: java-testng. Detected 8 Java files (no .feature files) — using TestNG/JUnit → Playwright Test path."
    }
  ],
  "reviewReportPath": "CONVERSION_REVIEW.md",
  "migrationNotesPath": "MIGRATION_NOTES.md"
}
```

This file is what the platform UI parses to render the post-conversion screen ("Here's what got converted, here's what didn't, here's what to do next").

---

## 7. Post-Deploy Verification

Run in order. If any fails, see Section 9.

### 7.1 Process health

```bash
systemctl is-active sel2pw-api      # → active
```

### 7.2 API health endpoint

```bash
curl -s http://localhost:4200/health
# Expect: {"status":"ok","service":"sel2pw","version":"0.10.0",...}
```

### 7.3 Downloads endpoint

```bash
curl -s -H "Authorization: Bearer $JWT" \
     https://api.testforge-ai.com/api/v1/downloads/sel2pw/info
# Expect: { "available": true, "version": "0.10.0", "artefacts": [...] }
```

### 7.4 Convert smoke test

```bash
curl -s -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"input":{"kind":"local","data_url":"/var/www/testforge-ai/Converter/examples/selenium-testng-sample"}}' \
     https://api.testforge-ai.com/api/v1/converter/convert
# Expect: 202 + jobId
```

### 7.5 sel2pw.exe smoke test

On a separate Windows machine:

```cmd
curl -O https://api.testforge-ai.com/api/v1/downloads/sel2pw.exe
sel2pw.exe convert <path-to-test-suite> --out <output-dir>
type <output-dir>\conversion-result.json
```

The `conversion-result.json` should have a non-zero `stats.converted` count.

---

## 8. Rollback

Same pattern as `test-prioritization-service`. Two options:

### 8.1 Revert on GitHub (preferred)

```bash
cd E:\EB1A_Research\Converter
git revert <bad-commit-sha>
git push origin main
```

CI re-deploys.

### 8.2 Quick checkout on the server

```bash
ssh root@<VPS_HOST>
cd /var/www/testforge-ai/Converter
git log --oneline -10
git checkout <last-good-sha>
bash scripts/deploy-app.sh
```

---

## 9. Common Operations

| Operation | Command |
| --- | --- |
| Tail API logs | `journalctl -u sel2pw-api -n 200 -f` |
| Restart API | `systemctl restart sel2pw-api` |
| Inspect telemetry | `node /var/www/testforge-ai/Converter/dist/cli.js report-stats` |
| Top failure patterns | `node /var/www/testforge-ai/Converter/dist/cli.js report-patterns -n 30` |
| Rebuild exe locally | `cd /var/www/testforge-ai/Converter && npm run build:exe` |
| Republish exe | `cp dist-exe/sel2pw.exe /var/www/testforge-ai/downloads/` |
| Repackage zip | `(cd /var/www/testforge-ai/downloads && zip sel2pw.zip sel2pw.exe run.bat sel2pw.config.yaml README.txt)` |

---

## 10. Reference — Key Paths

| What | Where |
| --- | --- |
| App root | `/var/www/testforge-ai/Converter` |
| Source | `src/` |
| Build output | `dist/` |
| Exe build output | `dist-exe/sel2pw.exe` |
| Downloads dir | `/var/www/testforge-ai/downloads/` |
| Env file | `/var/www/testforge-ai/Converter/.env` |
| systemd unit | `/etc/systemd/system/sel2pw-api.service` |
| Telemetry DB | `/var/www/testforge-ai/Converter/.sel2pw/telemetry.db` |
| Deploy script | `scripts/deploy-app.sh` |
| CI workflow | `.github/workflows/deploy.yml` |

## 11. Deploy Checklist

- [ ] Code reviewed and merged to `main`.
- [ ] GitHub Actions "Deploy to Production" run shows green.
- [ ] `systemctl is-active sel2pw-api` → `active`.
- [ ] `curl https://api.testforge-ai.com/api/v1/converter/health` returns `status: ok`.
- [ ] `curl https://api.testforge-ai.com/api/v1/downloads/sel2pw/info` returns `available: true` with the expected version.
- [ ] Download `sel2pw.exe` from a fresh machine; convert the bundled sample; verify `conversion-result.json` has `converted >= 2`.
- [ ] Tail logs ~2 minutes; no recurring errors.

*— End of document —*
