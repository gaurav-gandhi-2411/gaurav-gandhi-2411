// Check: the committed banners state the counts the site states right now.
// Run by .github/workflows/banner-counts.yml (weekly, on PRs touching the
// banner or its generator, and by manual dispatch). Needs network.
//
// build-assets.mjs generates the banner's "N projects · M live" clause from
// the site's products.ts, but it is a dev-time script (it needs Python +
// fontTools, which a scheduled job does not install), so a product added on
// the site does not by itself regenerate the banner. This makes that drift
// loud instead of silent.
//
// Two independent sources of the site's counts must agree before the banner is
// compared to them:
//
//   1. gg-portfolio content/products.ts, parsed by site-counts.mjs.
//   2. The text the production site actually renders: /projects shows
//      `{products.length} projects · {liveProductCount(products)} live today`
//      and the home page shows `N projects · M live`.
//
// (2) exists because (1) is a line-based parser, and a line-based parser can
// be blind to a shape the TypeScript compiler is not (a top-level property at
// odd indentation, say), which would give a confidently wrong count with no
// error. The rendered numbers come from the real `products.length` and
// `liveProductCount()`, so a disagreement means the parser miscounted (or the
// site has not deployed yet: after a merge to gg-portfolio main the site can
// lag by minutes, so a mismatch right after a site merge is reported, not
// hidden; re-run).
//
// Fails closed: any fetch/parse failure, an unfindable rendered sentence, a
// disagreement between sources, or a stale banner exits 1. Nothing is skipped.
//
// Usage: node scripts/check-banner-counts.mjs [assets-dir]
// (assets-dir defaults to ../assets; the argument exists for tests.)
// SITE_URL_OVERRIDE (stub servers only, 127.0.0.1/localhost) replaces the
// production origin.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { countClause, fetchProductsSource, localOnlyOverride, loadSiteCounts } from "./site-counts.mjs";

const DEFAULT_SITE = "https://gaurav-gandhi.vercel.app";
const SITE_HOSTS = ["gaurav-gandhi.vercel.app"];
const PAGES = ["/projects", "/"];

/**
 * Extracts every `<N> projects · <M> live` sentence from rendered HTML.
 * React splits the numbers into separate text nodes with `<!-- -->` markers
 * (`15<!-- --> projects · <!-- -->9<!-- --> live today`), and the middle dot
 * can arrive as a literal or an entity, so the markup is reduced to text first.
 * The numbers also appear JSON-escaped in the inline RSC payload; that form
 * (`[15,\" projects · \",9,...`) does not survive the reduction to a match, so
 * only text a visitor can read is counted. Throws if none is found or if the
 * matches disagree.
 */
export function parseRenderedCounts(html) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&middot;|&#183;|&#xb7;|&#xB7;/g, "·")
    .replace(/\s+/g, " ");
  const found = [...text.matchAll(/(\d+) projects · (\d+) live/g)].map((m) => ({
    projects: Number(m[1]),
    live: Number(m[2]),
  }));
  if (found.length === 0) throw new Error("no `<N> projects · <M> live` sentence in the rendered page");
  const first = found[0];
  if (found.some((f) => f.projects !== first.projects || f.live !== first.live)) {
    throw new Error(`the page states conflicting counts: ${JSON.stringify(found)}`);
  }
  return first;
}

/** Fetches the production pages and returns the one count pair they all state. */
export async function loadRenderedCounts() {
  const origin = localOnlyOverride("SITE_URL_OVERRIDE") ?? DEFAULT_SITE;
  const seen = [];
  for (const page of PAGES) {
    const html = await fetchProductsSource(new URL(page, origin).href, { allowedHosts: SITE_HOSTS });
    const counts = parseRenderedCounts(html);
    seen.push({ page, ...counts });
  }
  const first = seen[0];
  if (seen.some((s) => s.projects !== first.projects || s.live !== first.live)) {
    throw new Error(`site pages disagree: ${JSON.stringify(seen)}`);
  }
  return { projects: first.projects, live: first.live };
}

/** Returns the names of banner SVGs that do not state `clause`. */
export function staleBanners(assetsDir, clause) {
  return ["dark", "light"]
    .filter((theme) => !readFileSync(join(assetsDir, `banner-${theme}.svg`), "utf8").includes(`>${clause} · `))
    .map((theme) => `banner-${theme}.svg`);
}

async function main() {
  const assetsDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
  const parsed = await loadSiteCounts();
  const rendered = await loadRenderedCounts();
  console.log(`products.ts counts : ${parsed.projects} projects, ${parsed.live} live`);
  console.log(`rendered site text : ${rendered.projects} projects, ${rendered.live} live`);
  if (parsed.projects !== rendered.projects || parsed.live !== rendered.live) {
    throw new Error(
      "products.ts counts and the site's rendered counts differ: either the parser miscounted a shape " +
        "it cannot see, or the site has not deployed the latest products.ts yet"
    );
  }
  const clause = countClause(parsed);
  const stale = staleBanners(assetsDir, clause);
  for (const theme of ["dark", "light"]) {
    console.log(`banner-${theme}.svg: ${stale.includes(`banner-${theme}.svg`) ? "STALE" : "ok"} (site says "${clause}")`);
  }
  if (stale.length > 0) {
    throw new Error(`banner is stale (${stale.join(", ")}): run \`node scripts/build-assets.mjs\` and commit the banner SVGs`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (err) {
    console.error(`check-banner-counts: ${err.message}`);
    // exitCode, not process.exit(): see site-counts.mjs.
    process.exitCode = 1;
  }
}
