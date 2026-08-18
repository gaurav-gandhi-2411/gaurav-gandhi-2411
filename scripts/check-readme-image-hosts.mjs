// CI check: every image reference in README.md must be a relative path
// into this repo (assets/...), never an absolute URL to a third-party
// host. This is the thing rule A3 of the original brief was about — "No
// badge walls... No stats/streak/top-languages cards" are all served from
// external hosts (shields.io, github-readme-stats, streak-stats,
// skillicons.dev, ...), which is also the visual signature of a generated
// profile the brief explicitly wanted to avoid. This check makes that a
// standing rule instead of a one-time review note: any absolute
// http(s)://... image reference fails, full stop, regardless of which
// host it happens to be — a relative path is the only thing that can ever
// pass, by construction.
//
// Zero dependencies; Node 20+.

// It also checks that every referenced path is a file that exists, and that
// every asset on disk is referenced. Neither used to be checked anywhere:
// check-svgs.mjs walks assets/ and validates whatever it finds, this walked
// README.md and validated whatever it found, and nothing compared the two
// sets. Renaming assets/h-focus-light.svg left a broken image on the live
// profile with all three CI gates green. The two sets are each other's
// independent derivation, so joining them is the whole fix.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const README_PATH = "README.md";
const ASSETS_DIR = "assets";
const text = readFileSync(README_PATH, "utf-8");

// Three places an image reference can appear in this README: markdown
// image syntax, <img src="...">, and <source srcset="..."> (the
// <picture>/prefers-color-scheme pattern every section header uses).
const patterns = [
  { name: "markdown image", re: /!\[[^\]]*\]\(([^)]+)\)/g },
  { name: "<img src>", re: /<img\b[^>]*\bsrc="([^"]+)"/g },
  { name: "<source srcset>", re: /<source\b[^>]*\bsrcset="([^"]+)"/g },
];

let failed = false;
let checked = 0;
const referenced = new Set();

for (const { name, re } of patterns) {
  let match;
  while ((match = re.exec(text)) !== null) {
    // srcset takes a comma-separated candidate list. A single-candidate value
    // is all this README has ever used, but reading the whole attribute as
    // one path would let "a.svg 1x, https://elsewhere/b.svg 2x" through the
    // absolute-URL check below, which is the one thing this file promises.
    const candidates = match[1]
      .split(",")
      .map((c) => c.trim().split(/\s+/)[0])
      .filter(Boolean);
    for (const url of candidates) {
      checked++;
      if (/^https?:\/\//i.test(url)) {
        console.error(`FAIL ${name} references an absolute URL, not a repo-relative path: ${url}`);
        failed = true;
        continue;
      }
      referenced.add(url);
      if (!existsSync(url)) {
        console.error(`FAIL ${name} references a file that does not exist: ${url}`);
        failed = true;
        continue;
      }
      console.log(`ok   ${name}: ${url}`);
    }
  }
}

if (checked === 0) {
  console.error(`No image references found in ${README_PATH} — check the pattern list is still correct.`);
  process.exit(1);
}

// The other direction: an asset nobody references is either dead weight or a
// section that quietly stopped rendering. check-svgs.mjs will happily keep
// validating it either way, which is what made this invisible.
const onDisk = readdirSync(ASSETS_DIR)
  .filter((f) => f.endsWith(".svg"))
  .map((f) => join(ASSETS_DIR, f).replace(/\\/g, "/"));
const orphaned = onDisk.filter((f) => !referenced.has(f)).sort();
if (orphaned.length > 0) {
  console.error(`\nFAIL ${orphaned.length} asset(s) on disk that ${README_PATH} never references:`);
  for (const f of orphaned) console.error(`     ${f}`);
  console.error("     Either the README lost a reference, or the file should go.");
  failed = true;
}

console.log(
  `\nChecked ${checked} image reference(s) in ${README_PATH}, ` +
    `matched against ${onDisk.length} .svg file(s) in ${ASSETS_DIR}/.`
);
process.exit(failed ? 1 : 0);
