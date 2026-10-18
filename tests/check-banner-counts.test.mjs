// Tests for scripts/check-banner-counts.mjs (the drift check).
// Run: node --test tests/*.test.mjs
//
// Every scenario runs the real script as a child process against a stub server
// on 127.0.0.1 (products.ts + the site's pages) and a throwaway assets
// directory; nothing touches the network or the real assets/.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseRenderedCounts } from "../scripts/check-banner-counts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "check-banner-counts.mjs");
// 3 entries, 2 live (verbatim excerpt of the real products.ts).
const PRODUCTS = readFileSync(join(ROOT, "tests", "fixtures", "products.real-shape.ts"), "utf8");

// What React renders on /projects (text nodes split by comment markers) plus
// the escaped copy in the inline RSC payload, and the home page's plain form.
const projectsPage = (n, m) =>
  `<html><body><h1>Projects</h1><p class="x">${n}<!-- --> projects · <!-- -->${m}<!-- --> live today</p>` +
  `<script>self.__next_f.push([1,"{\\"children\\":[${n},\\" projects · \\",${m},\\" live today\\"]}"])</script></body></html>`;
const homePage = (n, m) => `<html><body><p class="y">${n} projects · ${m} live</p></body></html>`;
const banner = (n, m) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><text>${n} projects · ${m} live · 2 working papers on agent evaluation.</text></svg>`;

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// Runs the script. `site` = { projects, home } each { status, body }.
async function run({ products = { status: 200, body: PRODUCTS }, projects, home, bannerText }) {
  const server = createServer((req, res) => {
    const route = { "/products.ts": products, "/projects": projects, "/": home }[req.url];
    if (!route) {
      res.statusCode = 404;
      res.end("nope");
    } else if (route.redirect) {
      res.statusCode = 302;
      res.setHeader("location", route.redirect);
      res.end();
    } else {
      res.statusCode = route.status;
      res.end(route.body);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const assets = mkdtempSync(join(tmpdir(), "banner-drift-"));
  dirs.push(assets);
  for (const t of ["dark", "light"]) writeFileSync(join(assets, `banner-${t}.svg`), bannerText);
  try {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, assets], {
        env: { ...process.env, PRODUCTS_SOURCE_URL_OVERRIDE: `${base}/products.ts`, SITE_URL_OVERRIDE: base },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const ok = (body) => ({ status: 200, body });
const fresh = { projects: ok(projectsPage(3, 2)), home: ok(homePage(3, 2)), bannerText: banner(3, 2) };

describe("check-banner-counts: process level (stub servers)", () => {
  test("fresh banners, both sources agree: exit 0 and both counts are logged", async () => {
    const r = await run(fresh);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /products\.ts counts : 3 projects, 2 live/);
    assert.match(r.stdout, /rendered site text : 3 projects, 2 live/);
  });

  test("stale banner, sources agree: exit 1 naming the stale files", async () => {
    const r = await run({ ...fresh, bannerText: banner(13, 9) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /banner is stale \(banner-dark\.svg, banner-light\.svg\)/);
  });

  test("products.ts fetch failure: exit 1", async () => {
    const r = await run({ ...fresh, products: { status: 404, body: "" } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /responded 404/);
  });

  test("site fetch failure: exit 1", async () => {
    const r = await run({ ...fresh, projects: { status: 500, body: "" } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /responded 500/);
  });

  test("site page without the sentence: exit 1, never skipped", async () => {
    const r = await run({ ...fresh, home: ok("<html><body>no counts here</body></html>") });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no `<N> projects/);
  });

  test("site redirecting off its own host: exit 1", async () => {
    const r = await run({ ...fresh, projects: { redirect: "https://evil.example.com/projects" } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /redirect .* refused/);
  });

  test("cross-check: rendered counts differ from parsed counts, banner matches the parse: exit 1", async () => {
    // The parser says 3/2 and the banner agrees with it; the site says 4/2.
    const r = await run({ projects: ok(projectsPage(4, 2)), home: ok(homePage(4, 2)), bannerText: banner(3, 2) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /differ/);
  });

  test("cross-check: live count differs: exit 1", async () => {
    const r = await run({ projects: ok(projectsPage(3, 3)), home: ok(homePage(3, 3)), bannerText: banner(3, 2) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /differ/);
  });

  test("the site's own pages disagree with each other: exit 1", async () => {
    const r = await run({ ...fresh, home: ok(homePage(4, 2)) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /disagree/);
  });

  test("a non-local SITE_URL_OVERRIDE is refused: exit 1", async () => {
    const r = await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, tmpdir()], {
        env: { ...process.env, SITE_URL_OVERRIDE: "https://example.com" },
      });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => resolve({ status, stderr }));
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SITE_URL_OVERRIDE must point at 127\.0\.0\.1 or localhost/);
  });
});

describe("parseRenderedCounts", () => {
  test("React comment-node splitting", () => {
    assert.deepEqual(parseRenderedCounts(projectsPage(15, 9)), { projects: 15, live: 9 });
  });

  test("plain text, HTML entity middle dot, odd whitespace", () => {
    assert.deepEqual(parseRenderedCounts("<p>15 projects · 9 live</p>"), { projects: 15, live: 9 });
    assert.deepEqual(parseRenderedCounts("<p>15 projects &middot; 9 live</p>"), { projects: 15, live: 9 });
    assert.deepEqual(parseRenderedCounts("<p>15\n   projects\t&#183;\n9   live today</p>"), { projects: 15, live: 9 });
  });

  test("the escaped RSC payload alone is not a rendered sentence", () => {
    const payloadOnly = '<script>x([15,\\" projects · \\",9,\\" live today\\"])</script>';
    assert.throws(() => parseRenderedCounts(payloadOnly), /no `<N> projects/);
  });

  test("no sentence, or conflicting sentences, throw", () => {
    assert.throws(() => parseRenderedCounts("<p>hello</p>"), /no `<N> projects/);
    assert.throws(() => parseRenderedCounts("<p>3 projects · 2 live</p><p>4 projects · 2 live</p>"), /conflicting/);
  });
});

describe("check-banner-counts.mjs source", () => {
  test("failure paths use process.exitCode, never process.exit()", () => {
    const code = readFileSync(SCRIPT, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(code, /process\.exit\s*\(/);
    assert.match(code, /process\.exitCode = 1/);
  });
});
