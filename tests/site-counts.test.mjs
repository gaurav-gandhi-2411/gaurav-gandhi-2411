// Tests for scripts/site-counts.mjs and its use in scripts/build-assets.mjs.
// Run: node --test tests/site-counts.test.mjs
//
// tests/fixtures/products.ts is a 5-entry (3 live) cut-down of the shape of
// gg-portfolio content/products.ts. Nothing here touches the network except a
// stub server on 127.0.0.1.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { countClause, fetchProductsSource, parseSiteCounts, productsUrl } from "../scripts/site-counts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = readFileSync(join(ROOT, "tests", "fixtures", "products.ts"), "utf8").replace(/\r\n/g, "\n");

// Applies one textual edit to the fixture; the pattern must exist exactly once
// so a test cannot silently pass because its edit matched nothing.
function edit(from, to) {
  assert.equal(FIXTURE.split(from).length, 2, `edit pattern not unique: ${from}`);
  return FIXTURE.replace(from, () => to);
}
const EXTRA_LIVE = `  {\n    slug: "extra",\n    liveUrl: "https://example.com/",\n  },\n`;
const GAMMA = `    slug: "gamma",\n    name: "Gamma",\n`;

describe("parseSiteCounts: counts", () => {
  test("a verbatim excerpt of the real products.ts (every 4-space line shape) parses to 3/2", () => {
    // Bare `tagline:` + indented string, `key: value,`, `pypi: {` ... `    },`,
    // multi-line and one-line `figure`, `metric: refreshableMetric(...)`, comments.
    const real = readFileSync(join(ROOT, "tests", "fixtures", "products.real-shape.ts"), "utf8");
    assert.deepEqual(parseSiteCounts(real), { projects: 3, live: 2 });
  });

  test("fixture parses to 5 projects, 3 live", () => {
    assert.deepEqual(parseSiteCounts(FIXTURE), { projects: 5, live: 3 });
  });

  test("a CRLF copy of the fixture parses the same", () => {
    assert.deepEqual(parseSiteCounts(FIXTURE.replace(/\n/g, "\r\n")), { projects: 5, live: 3 });
  });

  test("a changed count flows through", () => {
    const grown = edit("\n];", `\n${EXTRA_LIVE}];`);
    assert.deepEqual(parseSiteCounts(grown), { projects: 6, live: 4 });
    assert.equal(countClause(parseSiteCounts(grown)), "6 projects · 4 live");
  });

  test("an entry without liveUrl is a project, not live", () => {
    assert.deepEqual(parseSiteCounts(edit("\n];", `\n  {\n    slug: "extra",\n  },\n];`)), { projects: 6, live: 3 });
  });

  test("a commented-out entry is not counted", () => {
    const src = edit("\n];", `\n  // {\n  //   slug: "old",\n  //   liveUrl: "https://old.example.com/",\n  // },\n];`);
    assert.deepEqual(parseSiteCounts(src), { projects: 5, live: 3 });
  });

  test("a commented-out liveUrl is not counted live", () => {
    const src = edit(GAMMA, `${GAMMA}    // liveUrl: "https://gamma.example.com/",\n`);
    assert.deepEqual(parseSiteCounts(src), { projects: 5, live: 3 });
  });

  test('liveUrl: "" is not counted live', () => {
    assert.deepEqual(parseSiteCounts(edit(GAMMA, `${GAMMA}    liveUrl: "",\n`)), { projects: 5, live: 3 });
  });
});

describe("parseSiteCounts: fails closed on anything it cannot count exactly", () => {
  const rejected = {
    "empty source": "",
    "no products array": "export const nothing = 1;",
    "array renamed": FIXTURE.replace("export const products: Product[]", "export const items: Product[]"),
    "no closing bracket": FIXTURE.replace("\n];", "\n"),
    "liveProductCount redefined": FIXTURE.replace("Boolean(p.liveUrl)", "Boolean(p.liveUrl || p.pypiUrl)"),
    "non-literal liveUrl": FIXTURE.replace('liveUrl: "https://beta.example.com/",', "liveUrl: BETA_URL,"),
    "entry without slug": FIXTURE.replace('    slug: "gamma",\n', ""),
    "whole entry inside a block comment": FIXTURE.replace("  {\n    slug: \"beta\"", "  /*\n  {\n    slug: \"beta\"").replace(
      '    liveUrl: "https://beta.example.com/",\n  },\n',
      '    liveUrl: "https://beta.example.com/",\n  },\n  */\n'
    ),
    "block comment hiding a liveUrl line": FIXTURE.replace(
      GAMMA,
      `${GAMMA}    /*\n    liveUrl: "https://gamma.example.com/",\n    */\n`
    ),
    "one-line entry": FIXTURE.replace('  {\n    slug: "epsilon",\n    name: "Epsilon",\n  },', '  { slug: "epsilon", name: "Epsilon" },'),
    "helper-call entry": FIXTURE.replace("\n];", '\n  makeProduct("zeta"),\n];'),
    "spread entry": FIXTURE.replace("\n];", "\n  ...moreProducts,\n];"),
    "entry opener with trailing content": FIXTURE.replace('  {\n    slug: "epsilon"', '  { // epsilon\n    slug: "epsilon"'),
    "second declaration after the array": `${FIXTURE}\nexport const products: Product[] = [\n  {\n    slug: "x",\n    liveUrl: "https://x/",\n  },\n];\n`,
    "products.push after the array": `${FIXTURE}\nproducts.push(extra);\n`,
    "products reassigned after the array": `${FIXTURE}\nproducts = [];\n`,
    "template literal swallowing a column-0 `];`": FIXTURE.replace(
      GAMMA,
      `${GAMMA}    note: \`\n];\n\`,\n`
    ),
    "template literal containing a fake liveUrl line": FIXTURE.replace(
      GAMMA,
      `${GAMMA}    note: \`\n    liveUrl: "https://fake/",\n    \`,\n`
    ),
    "quoted liveUrl key": FIXTURE.replace(GAMMA, `${GAMMA}    "liveUrl": "https://a.b/",\n`),
    "computed liveUrl key": FIXTURE.replace(GAMMA, `${GAMMA}    ['liveUrl']: "https://a.b/",\n`),
    "spread inside an entry": FIXTURE.replace(GAMMA, `${GAMMA}    ...extra,\n`),
    "quoted slug key": FIXTURE.replace('    slug: "gamma",', '    "slug": "gamma",'),
    "liveUrl assigned with =": FIXTURE.replace(GAMMA, `${GAMMA}    liveUrl = "https://a.b/",\n`),
    "odd (three-space) indentation": FIXTURE.replace(GAMMA, `${GAMMA}   note: 1,\n`),
    "unclosed entry": FIXTURE.replace('    slug: "epsilon",\n    name: "Epsilon",\n  },', '    slug: "epsilon",\n    name: "Epsilon",\n'),
    "stray two-space line": FIXTURE.replace("\n];", "\n  extra,\n];"),
    "zero live entries": FIXTURE.replace(/^ {4}liveUrl:.*\r?\n/gm, ""),
  };
  for (const [name, src] of Object.entries(rejected)) {
    test(name, () => {
      assert.throws(() => parseSiteCounts(src), Error);
    });
  }
});

describe("productsUrl override guard", () => {
  const set = (v) => {
    process.env.PRODUCTS_SOURCE_URL_OVERRIDE = v;
  };
  after(() => {
    delete process.env.PRODUCTS_SOURCE_URL_OVERRIDE;
  });

  test("localhost and 127.0.0.1 are honoured", () => {
    set("http://127.0.0.1:1234/p.ts");
    assert.equal(productsUrl(), "http://127.0.0.1:1234/p.ts");
    set("http://localhost:1234/p.ts");
    assert.equal(productsUrl(), "http://localhost:1234/p.ts");
  });

  test("any other host, a lookalike host, or a non-URL throws", () => {
    for (const bad of ["https://example.com/p.ts", "http://127.0.0.1.evil.example/p.ts", "http://localhost.evil.example/", "not a url"]) {
      set(bad);
      assert.throws(() => productsUrl(), /OVERRIDE/);
    }
  });
});

describe("fetch hardening and process exit codes", () => {
  let server;
  let base;
  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/ok") res.end(FIXTURE);
      else if (req.url === "/bad") res.end("export const products: Product[] = [\n  nonsense\n];\n");
      else if (req.url === "/hang") res.write("partial");
      else if (req.url === "/big") res.end("x".repeat(2_000_000));
      else if (req.url === "/redirect") {
        res.statusCode = 302;
        res.setHeader("location", "https://evil.example.com/products.ts");
        res.end();
      } else {
        res.statusCode = 404;
        res.end("nope");
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });

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

  test("fetchProductsSource returns the body", async () => {
    assert.equal(await fetchProductsSource(`${base}/ok`), FIXTURE);
  });

  test("fetchProductsSource times out on a server that never finishes", { timeout: 5000 }, async () => {
    await assert.rejects(fetchProductsSource(`${base}/hang`, { timeoutMs: 300 }), /failed/);
  });

  test("fetchProductsSource rejects a body over the size cap", async () => {
    await assert.rejects(fetchProductsSource(`${base}/big`, { maxBytes: 1000 }), /exceeds/);
  });

  test("fetchProductsSource refuses a redirect off raw.githubusercontent.com", async () => {
    await assert.rejects(fetchProductsSource(`${base}/redirect`), /redirect .* refused/);
  });

  test("site-counts CLI: stub serving the fixture exits 0 with 5/3", async () => {
    const r = await cli("site-counts.mjs", `${base}/ok`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { projects: 5, live: 3 });
  });

  for (const [name, url] of [
    ["unrecognised structure", () => `${base}/bad`],
    ["HTTP 404", () => `${base}/missing`],
    ["connection refused", () => "http://127.0.0.1:1/x"],
    ["redirect off-host", () => `${base}/redirect`],
    ["non-local override", () => "https://example.com/products.ts"],
  ]) {
    test(`site-counts CLI: ${name} exits exactly 1`, async () => {
      const r = await cli("site-counts.mjs", url());
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /site-counts:/);
    });
  }

  test("site-counts CLI: a non-local override names the rule", async () => {
    assert.match((await cli("site-counts.mjs", "https://example.com/products.ts")).stderr, /127\.0\.0\.1 or localhost/);
  });

  for (const [name, path] of [["404", "/missing"], ["bad structure", "/bad"]]) {
    test(`build-assets: ${name} exits 1 and writes no asset`, async () => {
      const banner = join(ROOT, "assets", "banner-dark.svg");
      const mtime = statSync(banner).mtimeMs;
      const r = await cli("build-assets.mjs", `${base}${path}`);
      assert.equal(r.status, 1);
      assert.equal(statSync(banner).mtimeMs, mtime, "banner must not be rewritten");
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

  test("neither site-counts.mjs nor build-assets.mjs calls process.exit()", () => {
    // process.exit() with a fetch still tearing down crashes libuv on Windows
    // and yields a non-1 status; failures must go through process.exitCode or
    // an uncaught error. Comments may mention it.
    for (const f of ["site-counts.mjs", "build-assets.mjs"]) {
      const code = readFileSync(join(ROOT, "scripts", f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      assert.doesNotMatch(code, /process\.exit\s*\(/, f);
    }
    const sc = readFileSync(join(ROOT, "scripts", "site-counts.mjs"), "utf8");
    assert.match(sc, /process\.exitCode = 1/);
  });

  test("the banner's count clause is built from the site counts", () => {
    assert.match(src, /sub2:\s*`\$\{countClause\(SITE_COUNTS\)\}/);
    assert.match(src, /const SITE_COUNTS = await loadSiteCounts\(\)/);
  });
});
