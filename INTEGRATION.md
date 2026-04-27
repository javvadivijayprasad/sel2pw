# Platform Integration

`sel2pw` (the Converter in this repo) is one service in a four-service test-quality platform. This document maps how it plugs in.

## Platform topology

```
                       ┌──────────────────────────────────┐
                       │  modern-automation-platform      │
                       │  Node/Express gateway + UI       │
                       │  Port 3000                       │
                       │                                  │
                       │  /api/v1/auth                    │
                       │  /api/v1/framework               │
                       │  /api/v1/test-case-generation ───┼──► test-case-generation-service
                       │  /api/v1/self-healing       ─────┼──► self-healing-stage-services
                       │  /api/v1/converter          ─────┼──► sel2pw  (NEW)
                       │  /api/v1/test-prioritization     │
                       │                                  │
                       │  SQLite (jobs)  ·  Redis (cache) │
                       └──────────────────────────────────┘
                                       │
              ┌────────────────────────┼─────────────────────────┐
              ▼                        ▼                         ▼
   ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
   │ test-case-generation │  │ self-healing-stage   │  │   sel2pw (Converter) │
   │ Python · FastAPI     │  │ Python · FastAPI     │  │   Node · Express     │
   │ Port 4100            │  │ Port 8003            │  │   Port 4200 (NEW)    │
   │ Anthropic SDK        │  │ XGBoost · sklearn    │  │   AST + (later) LLM  │
   └─────────┬────────────┘  └──────────┬───────────┘  └──────────┬───────────┘
             │                          │                         │
             └──────────────┬───────────┴─────────────────────────┘
                            ▼
                ┌──────────────────────────┐
                │   ai-governance (lib)    │
                │   Python package         │
                │   YAML-driven sanitiser  │
                └──────────────────────────┘
```

**Where each service fits in a customer's journey:**

| Stage | Service | What it does |
| --- | --- | --- |
| 1. Generate | `test-case-generation-service` | New test cases authored from requirements |
| 2. Migrate | **`sel2pw`** | Existing Selenium/TestNG suites lifted to Playwright |
| 3. Stabilise | `self-healing-stage-services` | Broken locators auto-healed at run time |
| 4. Govern | `ai-governance` | Every step's payload sanitised before any LLM call |
| — Orchestrate | `modern-automation-platform` | Auth, jobs, UI, artifact storage, gateway |

## Service contract — `/api/v1/converter`

The Converter exposes a small REST surface that mirrors the existing pattern in `test-case-generation-service` (sync probe + async job model + provenance).

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/health` | Liveness/readiness |
| `POST` | `/analyze` | Sync — scan input, return classification + stats (no writes) |
| `POST` | `/convert` | Async — start a conversion job, returns `jobId` |
| `GET`  | `/jobs/{jobId}` | Poll job status (`queued` / `running` / `succeeded` / `failed`) |
| `GET`  | `/jobs/{jobId}/artifact` | Download the converted Playwright project as a zip |
| `GET`  | `/jobs/{jobId}/review` | The `CONVERSION_REVIEW.md` content as JSON |
| `POST` | `/feedback` | Record reviewer feedback (mirrors test-case-generation-service) |

### Request shape — `POST /convert`

```json
{
  "input": {
    "kind": "zip",                   // or "git" or "s3"
    "data_url": "s3://…/input.zip",  // or git URL + ref
    "checksum": "sha256:…"
  },
  "options": {
    "engine": "ast",                 // "ast" | "hybrid" (when LLM fallback lands)
    "target": {
      "playwright_version": "1.45",
      "typescript_version": "5.4",
      "test_runner": "playwright-test"
    },
    "preserve_groups_as_tags": true,
    "emit_auth_setup": true
  },
  "governance": {
    "config_url": "s3://…/ai-quality.config.yaml",
    "redact_patterns_extra": ["INTERNAL_TOKEN_.*"]
  },
  "callback_url": "https://platform/api/v1/webhook/converter-job-done"
}
```

### Response shape — `GET /jobs/{jobId}`

```json
{
  "jobId": "cnv_01HXY…",
  "status": "succeeded",
  "stats": {
    "files_scanned": 412,
    "page_objects_converted": 87,
    "test_classes_converted": 134,
    "test_methods_converted": 1056,
    "review_items": { "manual": 12, "warning": 31, "info": 88 }
  },
  "artifact_url": "s3://…/cnv_01HXY/output.zip",
  "review_url":   "s3://…/cnv_01HXY/CONVERSION_REVIEW.md",
  "provenance": {
    "service": "sel2pw",
    "version": "0.2.0",
    "engine": "ast",
    "rules_version": "selenium-mappings@2026-04-25",
    "governance_config_hash": "sha256:…",
    "input_hash": "sha256:…",
    "started_at": "2026-04-25T17:02:11Z",
    "duration_ms": 18420
  }
}
```

The provenance block intentionally matches what `test-case-generation-service` returns so the platform UI's job-detail view can render both with one component.

## Gateway wiring (`modern-automation-platform`)

Mirrors how `test-case-generation-service` and `self-healing-stage-services` are already wired. Concretely:

`apps/framework-generator-api/src/routes/converter.routes.ts`

```ts
import { Router } from "express";
import { proxyTo } from "../proxy";

const r = Router();
const target = process.env.CONVERTER_BASE_URL ?? "http://localhost:4200";

r.get("/health", proxyTo(target, "/health"));
r.post("/analyze", requireAuth, proxyTo(target, "/analyze"));
r.post("/convert", requireAuth, enforceQuota("converter"), proxyTo(target, "/convert"));
r.get("/jobs/:id", requireAuth, proxyTo(target, "/jobs/:id"));
r.get("/jobs/:id/artifact", requireAuth, signedDownload(target));
r.get("/jobs/:id/review", requireAuth, proxyTo(target, "/jobs/:id/review"));
r.post("/feedback", requireAuth, proxyTo(target, "/feedback"));

export default r;
```

Mounted at `/api/v1/converter` in `app.ts`. Auth, rate limiting, quota enforcement, and webhook delivery are handled by the gateway exactly the same way they are for the other two services.

## `ai-governance` integration

The current AST engine doesn't send any code to an LLM, so governance is a no-op for v0.1. It becomes load-bearing in two situations:

1. **Hybrid engine (Phase 5)** — when the AST falls through to an LLM for custom helpers. Before the LLM call, run the Java source through `GovernanceFilter`:

   ```ts
   import { sanitizePayload } from "@platform/ai-governance-client"; // thin Node binding
   const safe = await sanitizePayload({
     content: javaSource,
     kind: "code",
     configUrl: req.body.governance?.config_url,
   });
   const llmResponse = await anthropic.messages.create({ ... safe.content ... });
   ```

   Because `ai-governance` is currently a Python library, we use a **sidecar** running inside the `ai-governance` repo itself: a small FastAPI service at `:4900` exposing `POST /sanitize` and `POST /audit`, wrapping the existing `GovernanceFilter` class. Node services call it over HTTP; Python services keep importing the library directly. This matches how `test-case-generation-service` and `self-healing-stage-services` are structured — library code under `src/`, FastAPI service in the same repo.

2. **Audit reporting** — every conversion job emits a `governance_audit.json` alongside `CONVERSION_REVIEW.md`, generated by `GovernanceFilter.audit(...)`. This makes the conversion artifact compliance-ready by default.

The `governance.config_url` field on `POST /convert` lets the platform pass the same `ai-quality.config.yaml` it already passes to `test-case-generation-service` — a customer configures governance once, all services honour it.

## Cross-service flows

### A) Customer migrates a legacy suite end-to-end

```
1. UI → POST /api/v1/converter/convert        (job queued)
2. sel2pw → calls ai-governance sidecar       (sanitise governance)
3. sel2pw → ASTs sources, emits Playwright TS, writes review.md
4. sel2pw → POST callback_url                 (job done)
5. UI → GET /api/v1/converter/jobs/:id/artifact (zip)
```

### B) Converted suite hits a broken locator at runtime

The output project depends on `@platform/sdk-self-healing` (a thin client wrapper around `/api/v1/self-healing`). When a Playwright locator fails:

```ts
// emitted by sel2pw when --emit-self-healing-shim is set
import { healOrThrow } from "@platform/sdk-self-healing";
this.usernameInput = await healOrThrow(page, {
  preferred: page.locator("#username"),
  context: { page: "login", role: "username-input" },
});
```

The shim sends DOM + broken locator to `self-healing-stage-services`, gets back a healed selector, and Playwright continues. Telemetry from each heal feeds back into the self-healing model.

### C) New tests + migrated tests in the same project

`test-case-generation-service` writes new specs into `tests/generated/`. `sel2pw` writes converted specs into `tests/migrated/`. Both share the same `pages/` directory and `playwright.config.ts`, so a single `playwright test` run covers both.

## Locked decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **`sel2pw` stays a standalone repo until Phase 1's AST swap stabilises**, then folds into `apps/converter-service/` in the platform monorepo. The standalone `npm` package + CLI continues to exist after the fold-in for users who want it without the platform. | The regex extractor is the most volatile part of the codebase; keeping it in a separate repo limits blast radius until the AST parser lands and tests are locked down. |
| 2 | **Service runs on port 4200.** | Adjacent to `test-case-generation-service` (4100); leaves room in the same band as the platform's other test-quality services. |
| 3 | **`ai-governance` sidecar lives inside the `ai-governance` repo itself** as a new `service/` module exposing FastAPI endpoints (`POST /sanitize`, `POST /audit`). Follows the exact pattern `test-case-generation-service` and `self-healing-stage-services` already use: library code under `src/`, FastAPI service in the same repo. | Single source of truth — the library and its HTTP face stay together. New consumers (sel2pw, future services) call it the same way Python services already do, just over HTTP from outside Python. |

## Concrete integration tasks (added to PRODUCTION_TASKS.md as Phase 0)

- [ ] Wrap CLI in an Express HTTP layer (`src/server.ts`) exposing the seven endpoints above
- [ ] Job runner with status persistence (start with SQLite, mirror what the gateway uses)
- [ ] Artifact storage abstraction (`local` for dev, `s3` for prod) — match the platform's existing artifact-builder package
- [ ] Provenance builder mirroring `test-case-generation-service`'s shape
- [ ] `governance.config_url` honoured (download → cache → pass into pipeline)
- [ ] `ai-governance` Python sidecar — small FastAPI wrapper exposing `sanitize` + `audit`
- [ ] Gateway wiring: `apps/framework-generator-api/src/routes/converter.routes.ts` + auth/quota
- [ ] Webhook callback on job completion
- [ ] `--emit-self-healing-shim` option in the AST emitter for cross-service runtime integration
- [ ] Shared `@platform/shared-types` entries for ConverterJob, ConverterStats, ConverterReviewItem
- [ ] Dockerfile + docker-compose entry for local platform dev
- [ ] Health/readiness endpoint feeding the platform service registry
