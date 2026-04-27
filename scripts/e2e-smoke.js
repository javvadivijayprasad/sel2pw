/* eslint-disable */
/**
 * End-to-end smoke test for the Converter HTTP service.
 *
 * Exercises the contract documented in INTEGRATION.md:
 *   1. POST /convert       → expect 202 + jobId
 *   2. GET  /jobs/:id      (poll) → expect status transition queued/running → succeeded
 *   3. GET  /jobs/:id/review → expect markdown body
 *   4. GET  /jobs/:id/artifact → expect zip
 *
 * Usage:
 *   # in one terminal — start the service (after `npm install && npm run build`)
 *   npm run serve
 *
 *   # in another terminal
 *   node scripts/e2e-smoke.js [http://localhost:4200]
 *
 * The test points at the bundled examples/selenium-testng-sample as input
 * (kind:"local" — already on disk), so it doesn't need git or unzip.
 *
 * It can also run against the platform gateway:
 *   node scripts/e2e-smoke.js http://localhost:3000/api/v1/converter
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const BASE = process.argv[2] || "http://localhost:4200";
const SAMPLE_DIR = path.resolve(
  __dirname,
  "..",
  "examples",
  "selenium-testng-sample",
);

function httpReq(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: body
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: buf,
            text: buf.toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`[smoke] base = ${BASE}`);

  // 0. health
  const h = await httpReq("GET", `${BASE}/health`);
  console.log(`[smoke] /health → ${h.statusCode} ${h.text.trim()}`);
  if (h.statusCode !== 200) throw new Error(`health failed: ${h.statusCode}`);

  // 1. enqueue
  const enqueue = await httpReq(
    "POST",
    `${BASE}/convert`,
    JSON.stringify({
      input: { kind: "local", data_url: SAMPLE_DIR },
      options: { engine: "ast", emit_self_healing_shim: false },
    }),
  );
  console.log(`[smoke] /convert → ${enqueue.statusCode}`);
  if (enqueue.statusCode !== 202) {
    throw new Error(`expected 202, got ${enqueue.statusCode}: ${enqueue.text}`);
  }
  const { jobId } = JSON.parse(enqueue.text);
  console.log(`[smoke] jobId = ${jobId}`);

  // 2. poll
  let job;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const r = await httpReq("GET", `${BASE}/jobs/${jobId}`);
    if (r.statusCode !== 200) {
      throw new Error(`status poll failed: ${r.statusCode}`);
    }
    job = JSON.parse(r.text);
    process.stdout.write(`[smoke] poll #${i} status=${job.status}\r`);
    if (job.status === "succeeded" || job.status === "failed") break;
  }
  console.log("");
  if (!job || job.status !== "succeeded") {
    throw new Error(`job did not succeed: ${JSON.stringify(job)}`);
  }
  if (!job.stats || job.stats.test_methods_converted < 1) {
    throw new Error(`stats look wrong: ${JSON.stringify(job.stats)}`);
  }
  if (!job.provenance || job.provenance.service !== "sel2pw") {
    throw new Error(`provenance missing/wrong: ${JSON.stringify(job.provenance)}`);
  }
  console.log(`[smoke] stats =`, job.stats);
  console.log(`[smoke] provenance =`, job.provenance);

  // 3. review
  const rev = await httpReq("GET", `${BASE}/jobs/${jobId}/review`);
  if (rev.statusCode !== 200 || !rev.text.includes("# Conversion Review")) {
    throw new Error(`review fetch failed (status ${rev.statusCode})`);
  }
  console.log(`[smoke] review fetched (${rev.text.length} bytes)`);

  // 4. artifact
  const art = await httpReq("GET", `${BASE}/jobs/${jobId}/artifact`);
  if (art.statusCode !== 200) {
    throw new Error(`artifact fetch failed: ${art.statusCode}`);
  }
  // PK header magic for a zip
  if (art.body[0] !== 0x50 || art.body[1] !== 0x4b) {
    throw new Error(`artifact does not look like a zip (first bytes: ${art.body.slice(0, 4).toString("hex")})`);
  }
  console.log(`[smoke] artifact zip received (${art.body.length} bytes)`);

  // 5. feedback
  const fb = await httpReq(
    "POST",
    `${BASE}/feedback`,
    JSON.stringify({ jobId, rating: 5, notes: "smoke test happy" }),
  );
  if (fb.statusCode !== 204) throw new Error(`feedback failed: ${fb.statusCode}`);
  console.log(`[smoke] feedback recorded`);

  console.log("\n✓ all smoke checks passed");
}

main().catch((err) => {
  console.error("✗ smoke failed:", err.message);
  process.exit(1);
});
