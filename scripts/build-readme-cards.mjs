// Builds assets/c-impact-{dark,light}.svg — the production-impact number
// strip that also appears on the live portfolio, rendered as a generated
// card instead of hand-typed prose so the two surfaces cannot silently
// drift apart.
//
// Run by .github/workflows/stats.yml alongside build-stats.mjs and committed,
// so the README never reaches a third-party image host at render time (same
// reasoning as build-stats.mjs).
//
// Data source: production impact strip ($10M+/yr, ~70%, 50M+ docs) is
// fetched from gg-portfolio's content/experience.ts on `main`, the exact
// object the portfolio homepage renders these bullets from. That file is a
// plain TS object literal (no computed values), and no equivalent JSON file
// carries the same wording — content/resume-data.json's copy of the ViT
// bullet omits the 70% figure entirely — so extraction is anchored to the
// `sourceRef` id already used as this project's own provenance key
// (gg-portfolio's content/provenance.md), not a loose scan of arbitrary TS.
//
// The `gh()` GitHub API helper below has no caller in this file yet — it is
// shared scaffolding for the open-source card pipeline, which stacks on top
// of this branch in a follow-up PR (kept out of this one to stay under the
// per-PR reviewable-line budget; see that PR for the second card).
//
// Deliberately no font subsetting, same reasoning as build-stats.mjs: this
// runs on a schedule, and a scheduled job that shells out to Python and
// fontTools is a scheduled job that will eventually fail for a reason
// nobody is watching. System font stack, matching stats.svg's type scale.
//
// Fails closed: any fetch/API error or a field that doesn't match the
// expected shape throws and exits non-zero. There is no fallback to a
// previously-committed value — a card that can't be verified this run does
// not get silently left stale.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");

const EXPERIENCE_SOURCE_URL =
  process.env.EXPERIENCE_SOURCE_URL_OVERRIDE ||
  "https://raw.githubusercontent.com/gaurav-gandhi-2411/gg-portfolio/main/content/experience.ts";

const THEMES = {
  dark: { bg: "#0A0B0D", border: "#26282E", hi: "#EDEEF0", lo: "#A2A6B0", accent: "#818CF8", chipBg: "#131417" },
  light: { bg: "#EDEEF0", border: "#D0D3D9", hi: "#0A0B0D", lo: "#4A4E56", accent: "#4338CA", chipBg: "#E3E5EA" },
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Shared scaffolding for the open-source card pipeline (see top-of-file
// note) — unused in this PR, kept here so the follow-up PR is a pure
// addition rather than re-introducing this helper.
async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "gaurav-gandhi-2411-readme-cards",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} responded ${res.status}`);
  return res.json();
}

// ------------------------------------------------------- production impact

/**
 * Fetches gg-portfolio's content/experience.ts and returns its raw text.
 * Throws if the fetch fails — no fallback to a cached/stale copy.
 */
async function fetchExperienceSource() {
  const res = await fetch(EXPERIENCE_SOURCE_URL);
  if (!res.ok) {
    throw new Error(`fetch ${EXPERIENCE_SOURCE_URL} responded ${res.status}`);
  }
  return res.text();
}

/**
 * Extracts the `text` string of the one bullet object in experience.ts whose
 * `sourceRef` matches. Anchored on the exact object shape that file emits —
 * `{ text: "...", sourceRef: "...", ... }`, text always before sourceRef —
 * not a general TS parser. Throws if the ref is missing or matched more
 * than once, so a restructure of experience.ts fails loudly rather than
 * silently reading the wrong bullet.
 */
function extractBulletText(src, sourceRef) {
  const re = /text:\s*"((?:[^"\\]|\\.)*)",\s*\n\s*sourceRef:\s*"([^"]+)"/g;
  const found = [];
  let match;
  while ((match = re.exec(src)) !== null) {
    if (match[2] === sourceRef) found.push(match[1]);
  }
  if (found.length === 0) {
    throw new Error(`sourceRef "${sourceRef}" not found in ${EXPERIENCE_SOURCE_URL}`);
  }
  if (found.length > 1) {
    throw new Error(`sourceRef "${sourceRef}" matched ${found.length} times, expected exactly 1`);
  }
  return found[0];
}

function requireMatch(text, re, what, sourceRef) {
  const m = text.match(re);
  if (!m) {
    throw new Error(`could not find ${what} in bullet "${sourceRef}": ${JSON.stringify(text)}`);
  }
  return m;
}

async function collectImpact() {
  const src = await fetchExperienceSource();

  const vitBullet = extractBulletText(src, "resume:indium-senior-vit");
  const automationPct = requireMatch(vitBullet, /(\d+)%/, "automation percentage", "resume:indium-senior-vit")[1];

  const docBullet = extractBulletText(src, "resume:indium-ds-docunderstanding");
  const annualSavings = requireMatch(
    docBullet,
    /\$(\d+)M\+/,
    "annual cost savings",
    "resume:indium-ds-docunderstanding"
  )[1];
  const pretrainDocs = requireMatch(
    docBullet,
    /(\d+)M\+ documents/,
    "pretraining corpus size",
    "resume:indium-ds-docunderstanding"
  )[1];

  return {
    automationPct: `~${automationPct}%`,
    annualSavings: `$${annualSavings}M+`,
    pretrainDocs: `${pretrainDocs}M+`,
  };
}

function renderImpact(t, data) {
  const figures = [
    [data.annualSavings, "delivered in annual cost savings"],
    [data.automationPct, "of earner doc verification automated"],
    [data.pretrainDocs, "documents in the pretraining corpus"],
  ];

  const cols = figures
    .map(([value, label], i) => {
      const x = 34 + i * 320;
      return `
    <text x="${x}" y="86" fill="${t.hi}" font-family="Georgia, 'Times New Roman', serif" font-size="44" font-weight="600">${esc(value)}</text>
    <text x="${x}" y="112" fill="${t.lo}" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="12" letter-spacing="0.5">${esc(label)}</text>`;
    })
    .join("");

  const label = [
    `${data.annualSavings} delivered in annual cost savings`,
    `Roughly ${data.automationPct.replace("~", "")} of earner document verification automated`,
    `${data.pretrainDocs} documents in the pretraining corpus`,
    "Uber Technologies, Uber AI, via Indium Software",
  ].join(". ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="168" viewBox="0 0 1000 168" role="img" aria-label="${esc(label)}">
  <rect width="1000" height="168" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  <text x="34" y="40" fill="${t.lo}" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="11" letter-spacing="3">PRODUCTION IMPACT · UBER AI, VIA INDIUM SOFTWARE</text>
  <line x1="34" y1="52" x2="966" y2="52" stroke="${t.border}"/>
  ${cols}
</svg>
`;
}

// ----------------------------------------------------------------- run

async function main() {
  console.log(`Fetching production-impact source: ${EXPERIENCE_SOURCE_URL}`);
  const impact = await collectImpact();
  console.log(
    `  read: annualSavings=${impact.annualSavings} automationPct=${impact.automationPct} pretrainDocs=${impact.pretrainDocs}`
  );

  for (const [name, t] of Object.entries(THEMES)) {
    const impactSvg = renderImpact(t, impact);
    writeFileSync(join(ASSETS, `c-impact-${name}.svg`), impactSvg);
    console.log(`c-impact-${name}.svg      ${Buffer.byteLength(impactSvg).toLocaleString()} bytes`);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
