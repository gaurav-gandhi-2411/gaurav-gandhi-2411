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

import { readFileSync } from "node:fs";

const README_PATH = "README.md";
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

for (const { name, re } of patterns) {
  let match;
  while ((match = re.exec(text)) !== null) {
    const url = match[1];
    checked++;
    if (/^https?:\/\//i.test(url)) {
      console.error(`FAIL ${name} references an absolute URL, not a repo-relative path: ${url}`);
      failed = true;
    } else {
      console.log(`ok   ${name}: ${url}`);
    }
  }
}

if (checked === 0) {
  console.error(`No image references found in ${README_PATH} — check the pattern list is still correct.`);
  process.exit(1);
}

console.log(`\nChecked ${checked} image reference(s) in ${README_PATH}.`);
process.exit(failed ? 1 : 0);
