// Check: the committed banners state the counts the site states right now.
//
// build-assets.mjs generates the banner's "N projects · M live" clause from
// the site's products.ts, but it is a dev-time script (it needs Python +
// fontTools, which the scheduled workflow does not install), so a product
// added on the site does not by itself regenerate the banner. This closes that
// gap loudly instead of silently: the weekly stats workflow runs it and goes
// red when the committed banner no longer matches, rather than leaving a stale
// number on the profile. Fails closed: a fetch/parse error is a failure, not a
// skip.
//
// Run: node scripts/check-banner-counts.mjs   (needs network)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { countClause, loadSiteCounts } from "./site-counts.mjs";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

try {
  const counts = await loadSiteCounts();
  const clause = countClause(counts);
  let bad = 0;
  for (const theme of ["dark", "light"]) {
    const svg = readFileSync(join(ASSETS, `banner-${theme}.svg`), "utf8");
    const ok = svg.includes(`>${clause} · `);
    console.log(`banner-${theme}.svg: ${ok ? "ok" : "STALE"} (site says "${clause}")`);
    if (!ok) bad += 1;
  }
  if (bad > 0) {
    console.error("banner is stale: run `node scripts/build-assets.mjs` and commit the banner SVGs");
    process.exit(1);
  }
} catch (err) {
  console.error(`check-banner-counts: ${err.message}`);
  process.exit(1);
}
