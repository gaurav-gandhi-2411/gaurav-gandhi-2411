// CI check: every committed assets/*.svg must be well-formed XML and stay
// within its size budget, and the total payload a single-theme visitor to
// README.md actually downloads must stay under budget.
//
// Why this exists: this repo shipped SMIL-animated assets (the banner,
// the 6 section dividers) with hand-verified size budgets in their PRs
// (banner <60KB, total README image payload <400KB — see PR #1) but
// nothing re-checked those budgets on a later edit. A future asset change
// could silently blow past them with no signal until someone eyeballs the
// rendered page. This is a text-level check (well-formedness + byte size),
// not a visual/render check — it can't catch "looks wrong", only "isn't
// valid XML" or "got too big".
//
// Zero dependencies; Node 20+ (fs, no external XML parser needed — a
// same-name-tag-balance check is sufficient for well-formedness here since
// these are all hand/script-generated, not arbitrary untrusted SVG).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ASSETS_DIR = "assets";
// Matches the budget stated and hand-verified in PR #1: "keep each variant
// under 60KB" for the banner; the dividers came in well under that too, so
// the same ceiling applies uniformly rather than maintaining two numbers.
const PER_FILE_BUDGET_BYTES = 60 * 1024;
// PR #1's other explicit budget: total README image payload under 400KB
// for a single theme (light XOR dark — a real visitor's <picture> only
// ever fetches one variant, never both).
const TOTAL_PAYLOAD_BUDGET_BYTES = 400 * 1024;

function isWellFormedXml(text) {
  // Strip content that legitimately contains characters a naive tag-balance
  // scan would misread: comments, CDATA, and the embedded base64 font data
  // inside <style> blocks (font bytes can coincidentally contain "<"/">"-
  // like byte sequences once base64-decoded is irrelevant here since we
  // never decode it, but the base64 alphabet itself never contains < or >,
  // so no stripping is actually needed there — kept explicit for clarity).
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

  const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;
  const stack = [];
  let match;
  while ((match = tagRe.exec(stripped)) !== null) {
    const [full, name, selfClose] = match;
    if (full.startsWith("</")) {
      const top = stack.pop();
      if (top !== name) {
        return { ok: false, reason: `mismatched closing tag </${name}> (expected </${top ?? "?"}>)` };
      }
    } else if (!selfClose && !full.endsWith("/>")) {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    return { ok: false, reason: `unclosed tag(s): ${stack.join(", ")}` };
  }
  if (!/^﻿?<svg[\s>]/.test(stripped.trimStart())) {
    return { ok: false, reason: "does not start with <svg>" };
  }
  return { ok: true };
}

const files = readdirSync(ASSETS_DIR)
  .filter((f) => extname(f) === ".svg")
  .sort();

if (files.length === 0) {
  console.error(`No .svg files found in ${ASSETS_DIR}/ — check the working directory.`);
  process.exit(1);
}

let failed = false;
const lightTotal = { bytes: 0, files: [] };
const darkTotal = { bytes: 0, files: [] };

for (const file of files) {
  const path = join(ASSETS_DIR, file);
  const text = readFileSync(path, "utf-8");
  const bytes = statSync(path).size;

  const wf = isWellFormedXml(text);
  if (!wf.ok) {
    console.error(`FAIL ${file}: not well-formed XML — ${wf.reason}`);
    failed = true;
  } else {
    console.log(`ok   ${file}: well-formed`);
  }

  if (bytes > PER_FILE_BUDGET_BYTES) {
    console.error(
      `FAIL ${file}: ${bytes} bytes exceeds the ${PER_FILE_BUDGET_BYTES} byte per-file budget`
    );
    failed = true;
  } else {
    console.log(`ok   ${file}: ${bytes} bytes (budget ${PER_FILE_BUDGET_BYTES})`);
  }

  if (file.includes("light")) {
    lightTotal.bytes += bytes;
    lightTotal.files.push(file);
  } else if (file.includes("dark")) {
    darkTotal.bytes += bytes;
    darkTotal.files.push(file);
  }
}

for (const [theme, total] of [
  ["light", lightTotal],
  ["dark", darkTotal],
]) {
  if (total.bytes > TOTAL_PAYLOAD_BUDGET_BYTES) {
    console.error(
      `FAIL ${theme} theme: total README image payload ${total.bytes} bytes ` +
        `(${total.files.length} files) exceeds the ${TOTAL_PAYLOAD_BUDGET_BYTES} byte budget`
    );
    failed = true;
  } else {
    console.log(
      `ok   ${theme} theme: total README image payload ${total.bytes} bytes ` +
        `(${total.files.length} files, budget ${TOTAL_PAYLOAD_BUDGET_BYTES})`
    );
  }
}

process.exit(failed ? 1 : 0);
