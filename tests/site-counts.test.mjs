// Tests for scripts/site-counts.mjs and its use in scripts/build-assets.mjs.
// Run: node --test tests/
//
// scripts/fixtures/products.ts is a verbatim copy of gg-portfolio
// content/products.ts at commit 87f2387b587c77f3f13bf33e75e6cfb502c55f49
// (15 entries, 9 with a liveUrl). No test touches the network except against
// a stub server on 127.0.0.1.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { countClause, parseSiteCounts } from "../scripts/site-counts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = readFileSync(join(ROOT, "scripts", "fixtures", "products.ts"), "utf8");

// One extra, live entry appended to the array.
const EXTRA = `  {\n    slug: "extra",\n    liveUrl: "https://example.com/",\n  },\n`;

describe("parseSiteCounts", () => {
  test("fixture parses to 15 projects, 9 live", () => {
    assert.deepEqual(parseSiteCounts(FIXTURE), { projects: 15, live: 9 });
  });

  test("a changed count flows through", () => {
    const grown = FIXTURE.replace("\n];", `\n${EXTRA}];`);
    assert.deepEqual(parseSiteCounts(grown), { projects: 16, live: 10 });
    assert.equal(countClause(parseSiteCounts(grown)), "16 projects · 10 live");
  });

  test("an entry without liveUrl counts as a project, not as live", () => {
    const grown = FIXTURE.replace("\n];", `\n  {\n    slug: "extra",\n  },\n];`);
    assert.deepEqual(parseSiteCounts(grown), { projects: 16, live: 9 });
  });

  test("malformed input is rejected", () => {
    for (const bad of [
      "",
      "export const nothing = 1;",
      FIXTURE.replace("export const products: Product[] = [", "export const items = ["),
      FIXTURE.replace("\n];", "\n"), // no closing bracket
      FIXTURE.replace("Boolean(p.liveUrl)", "Boolean(p.liveUrl || p.pypiUrl)"), // site redefined "live"
      FIXTURE.replace('    liveUrl: "https://playwarmer.vercel.app/",', "    liveUrl: WARMER_URL,"),
      FIXTURE.replace('    slug: "warmer",', ""), // entry without a slug
    ]) {
      assert.throws(() => parseSiteCounts(bad), Error);
    }
  });

  test("zero live entries is rejected, not reported as 0", () => {
    const none = FIXTURE.replace(/^ {4}liveUrl:.*\n/gm, "");
    assert.throws(() => parseSiteCounts(none), /positive integer/);
  });
});

describe("process exit codes (fail closed)", () => {
  let server;
  let base;
  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/ok") res.end(FIXTURE);
      else if (req.url === "/bad") res.end("export const products: Product[] = [\n  nonsense\n];\n");
      else {
        res.statusCode = 404;
        res.end("nope");
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  // Async spawn, not spawnSync: the stub server lives in this process, and a
  // blocking spawn would starve it and deadlock the child's fetch.
  const cli = (script, url) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [join(ROOT, "scripts", script)], {
        env: { ...process.env, PRODUCTS_SOURCE_URL_OVERRIDE: url },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  test("site-counts CLI: stub serving the fixture exits 0 with 15/9", async () => {
    const r = await cli("site-counts.mjs", `${base}/ok`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { projects: 15, live: 9 });
  });

  test("site-counts CLI: unrecognised structure exits non-zero", async () => {
    const r = await cli("site-counts.mjs", `${base}/bad`);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /site-counts:/);
  });

  test("site-counts CLI: HTTP 404 exits non-zero", async () => {
    assert.notEqual((await cli("site-counts.mjs", `${base}/missing`)).status, 0);
  });

  test("site-counts CLI: connection refused exits non-zero", async () => {
    assert.notEqual((await cli("site-counts.mjs", "http://127.0.0.1:1/x")).status, 0);
  });

  for (const [name, path] of [["404", "/missing"], ["bad structure", "/bad"]]) {
    test(`build-assets: ${name} aborts non-zero and writes no asset`, async () => {
      const banner = join(ROOT, "assets", "banner-dark.svg");
      const before = statSync(banner).mtimeMs;
      const r = await cli("build-assets.mjs", `${base}${path}`);
      assert.notEqual(r.status, 0);
      assert.equal(statSync(banner).mtimeMs, before, "banner must not be rewritten");
    });
  }
});

describe("no hand-typed counts", () => {
  const src = readFileSync(join(ROOT, "scripts", "build-assets.mjs"), "utf8");

  test("build-assets.mjs has no literal '<n> AI products' / '<n> projects' / '<n> live' text", () => {
    assert.doesNotMatch(src, /\d+\s+AI products/);
    assert.doesNotMatch(src, /\d+\s+projects/);
    assert.doesNotMatch(src, /\d+\s+live\b/);
  });

  test("the banner's count clause is built from the site counts", () => {
    assert.match(src, /sub2:\s*`\$\{countClause\(SITE_COUNTS\)\}/);
    assert.match(src, /const SITE_COUNTS = await loadSiteCounts\(\)/);
  });
});
