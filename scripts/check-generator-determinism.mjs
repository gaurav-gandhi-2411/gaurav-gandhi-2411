// Check: build-assets.mjs must produce byte-identical output from identical
// inputs.
//
// WHY THIS EXISTS: the generator shipped non-deterministic. fontTools stamps
// the OpenType `head` table's `modified` field with the current time, so every
// run rewrote all 14 assets with different font bytes and identical markup. It
// went unnoticed through an entire PR because the symptom — "regenerating
// changes every file" — looks like normal generator behaviour until you ask
// why.
//
// Two costs, both paid before it was caught: "do the committed assets match
// the generator?" became unanswerable, and a genuine 2-file change arrived
// wearing a 14-file diff, which is exactly how a real edit hides.
//
// Pinning SOURCE_DATE_EPOCH fixed that cause. This check exists because it
// will not be the last one — any future input that varies per run (a temp
// path leaking into output, an unsorted Map iteration, a new tool with its own
// timestamp) reintroduces the same failure, and the next person will have the
// same reason not to notice. A cause got fixed; this makes the CLASS visible.
//
// Deliberately NOT part of the CI asset checks: it re-runs the generator,
// which needs Python + fontTools + brotli that CI does not install (CI
// validates committed SVGs, it never rebuilds them). Run locally before
// committing regenerated assets:
//
//     node scripts/check-generator-determinism.mjs
//
// Exits non-zero on any difference, so it is usable as a pre-commit hook or a
// manual gate.
//
// Also runs build-readme-cards.mjs, which pulls live data (gg-portfolio's
// experience.ts, the GitHub API) rather than local fonts. Its two runs will
// only differ if the underlying source actually changed between them or the
// rendering logic itself leaked something non-deterministic (a timestamp, an
// unsorted iteration) — same failure class as build-assets.mjs, different
// cause. Requires network access.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ASSETS = join(ROOT, "assets");

function hashAssets() {
  const files = readdirSync(ASSETS)
    .filter((f) => f.endsWith(".svg"))
    .sort();
  const out = new Map();
  for (const f of files) {
    out.set(f, createHash("sha256").update(readFileSync(join(ASSETS, f))).digest("hex"));
  }
  return out;
}

const GENERATORS = ["build-assets.mjs", "build-readme-cards.mjs"];

function build(label) {
  process.stdout.write(`  building (${label})... `);
  for (const generator of GENERATORS) {
    execFileSync("node", [join(HERE, generator)], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
  }
  console.log("done");
}

console.log("Generator determinism check — two runs, identical inputs\n");

build("run 1");
const first = hashAssets();
build("run 2");
const second = hashAssets();

const names = [...new Set([...first.keys(), ...second.keys()])].sort();
const differing = names.filter((n) => first.get(n) !== second.get(n));

console.log(`\n${names.length} asset(s) compared.`);

if (differing.length > 0) {
  console.error(`\nFAIL — ${differing.length} asset(s) differ between two identical runs:`);
  for (const n of differing) {
    console.error(`  ${n}`);
    console.error(`    run 1: ${first.get(n) ?? "(absent)"}`);
    console.error(`    run 2: ${second.get(n) ?? "(absent)"}`);
  }
  console.error(
    `\nThe generator is non-deterministic. Something in its inputs varies per run —\n` +
      `a timestamp, a temp path leaking into output, or an unordered iteration.\n` +
      `Find it and pin it; do not commit these assets, because the diff you would be\n` +
      `reviewing is noise that hides whatever real change you meant to make.\n` +
      `(The known instance: fontTools stamps head.modified with the current time,\n` +
      `pinned via SOURCE_DATE_EPOCH in build-assets.mjs.)`
  );
  process.exit(1);
}

console.log("\nOK — byte-identical across both runs.");
process.exit(0);
