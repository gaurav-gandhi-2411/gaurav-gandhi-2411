// The project and live counts the banner states, read from the portfolio's own
// product list so the banner cannot disagree with the site.
//
// Source: gg-portfolio's content/products.ts on `main` — the array the site's
// own `products.length` and `liveProductCount()` run over. Same mechanism as
// build-readme-cards.mjs (raw fetch of a gg-portfolio content file, anchored
// parser, no secrets, no scraping of rendered HTML).
//
// Fails closed. A fetch error, a file whose structure this parser does not
// recognise, or a count that is not a positive integer throws; the CLI form
// exits 1. There is no fallback to a previously-typed or previously-committed
// number, because a stale number is exactly the bug this file exists to end.
//
// Not a TypeScript parser: it recognises the one shape products.ts has
// (a top-level `export const products: Product[] = [` array whose entries open
// with `  {` at two-space indent and carry `slug:` and optionally `liveUrl:`
// at four-space indent) and rejects anything else.
//
// CLI: node scripts/site-counts.mjs   -> prints {"projects":N,"live":M}

import { pathToFileURL } from "node:url";

export const DEFAULT_PRODUCTS_URL =
  "https://raw.githubusercontent.com/gaurav-gandhi-2411/gg-portfolio/main/content/products.ts";

// Overrides the source URL. Test hook only (stub servers for the fail-closed
// tests); production runs never set it.
export function productsUrl() {
  return process.env.PRODUCTS_SOURCE_URL_OVERRIDE || DEFAULT_PRODUCTS_URL;
}

/** Fetches the raw products.ts text. Throws on any non-2xx or network error. */
export async function fetchProductsSource(url = productsUrl()) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`fetch ${url} failed: ${err.message}`);
  }
  if (!res.ok) throw new Error(`fetch ${url} responded ${res.status}`);
  return res.text();
}

function positiveInt(n, what) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${what} is ${n}, expected a positive integer`);
  }
  return n;
}

const LIVE_FN =
  /export function liveProductCount\(list: Product\[\]\): number \{\s*\n\s*return list\.filter\(\(p\) => Boolean\(p\.liveUrl\)\)\.length;/;

/**
 * Returns { projects, live } from the text of content/products.ts.
 * "live" mirrors the site's liveProductCount(): entries with a non-empty
 * string liveUrl. The parser first verifies that function still has that
 * definition, so a redefinition on the site fails here instead of drifting.
 */
export function parseSiteCounts(src) {
  if (typeof src !== "string" || src.length === 0) throw new Error("products source is empty");

  if (!LIVE_FN.test(src)) {
    throw new Error("liveProductCount() is not the expected Boolean(p.liveUrl) filter; refusing to guess");
  }

  const open = "export const products: Product[] = [\n";
  const start = src.indexOf(open);
  if (start === -1 || src.indexOf(open, start + 1) !== -1) {
    throw new Error("expected exactly one `export const products: Product[] = [` array");
  }
  const rest = src.slice(start + open.length);
  const end = rest.indexOf("\n];");
  if (end === -1) throw new Error("products array has no closing `];`");
  const lines = rest.slice(0, end).split("\n");

  // Split into entries at each two-space `  {` opener.
  const entries = [];
  for (const line of lines) {
    if (line === "  {") entries.push([]);
    else if (entries.length > 0) entries[entries.length - 1].push(line);
    else if (line.trim() !== "" && !line.trim().startsWith("//")) {
      throw new Error(`unexpected content before the first entry: ${JSON.stringify(line)}`);
    }
  }

  let live = 0;
  for (const [i, body] of entries.entries()) {
    const slugs = body.filter((l) => /^ {4}slug: "[^"]+",$/.test(l));
    if (slugs.length !== 1) throw new Error(`entry ${i} has ${slugs.length} slug lines, expected 1`);
    const liveLines = body.filter((l) => /^ {4}liveUrl:/.test(l));
    if (liveLines.length > 1) throw new Error(`entry ${i} has ${liveLines.length} liveUrl lines`);
    if (liveLines.length === 1) {
      const m = liveLines[0].match(/^ {4}liveUrl: "([^"]*)",$/);
      if (!m) throw new Error(`entry ${i} liveUrl is not a plain string literal: ${liveLines[0]}`);
      if (m[1] !== "") live += 1;
    }
  }

  const projects = positiveInt(entries.length, "project count");
  positiveInt(live, "live count");
  if (live > projects) throw new Error(`live (${live}) exceeds projects (${projects})`);
  return { projects, live };
}

/** Fetches and parses; the one call build-assets.mjs makes. */
export async function loadSiteCounts() {
  return parseSiteCounts(await fetchProductsSource());
}

/** The banner's count clause, e.g. "15 projects · 9 live". */
export function countClause({ projects, live }) {
  return `${positiveInt(projects, "projects")} projects · ${positiveInt(live, "live")} live`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    console.log(JSON.stringify(await loadSiteCounts()));
  } catch (err) {
    console.error(`site-counts: ${err.message}`);
    process.exit(1);
  }
}
