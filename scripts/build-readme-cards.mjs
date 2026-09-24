// Builds assets/c-impact-{dark,light}.svg and assets/c-opensource-{dark,light}.svg
// — the two README numbers that also appear on the live portfolio, rendered
// as generated cards instead of hand-typed prose so the two surfaces cannot
// silently drift apart.
//
// Run by .github/workflows/stats.yml alongside build-stats.mjs and committed,
// so the README never reaches a third-party image host at render time (same
// reasoning as build-stats.mjs).
//
// Two independent data sources, one per card:
//
//   1. Production impact strip ($10M+/yr, ~70%, 50M+ docs) — fetched from
//      gg-portfolio's content/experience.ts on `main`, the exact object the
//      portfolio homepage renders these bullets from. That file is a plain
//      TS object literal (no computed values), and no equivalent JSON file
//      carries the same wording — content/resume-data.json's copy of the
//      ViT bullet omits the 70% figure entirely — so extraction is anchored
//      to the `sourceRef` id already used as this project's own provenance
//      key (gg-portfolio's content/provenance.md), not a loose scan of
//      arbitrary TS.
//
//   2. Open source summary (landed upstream fixes) — fetched from
//      gg-portfolio's content/open-source.ts on `main` (added there by
//      gg-portfolio PRs #240/#241/#243, merged 2026-09-24; renders on that
//      site's /open-source page and homepage). Nothing here pins which PRs
//      exist — every entry in that file's `openSourceLanded` array is read,
//      anchored on the `sourceRef` id each entry already carries, and this
//      repo no longer needs to know the PR numbers at all. On top of what
//      the site claims, each entry's commit is ALSO verified live against
//      the GitHub API as an additional guard: it must still be an ancestor
//      of the target repo's own default branch — the same check the
//      README's own "Landed as" column claims to prove ("proven by a commit
//      on the target repo's own default branch, not just a merged-PR
//      badge"). Worth noting PR.merged is `false` for both adk-python PRs
//      even though their commits are long since on `main`, because Google's
//      repos land changes via Copybara rather than GitHub's native merge
//      button — the ancestor check is the one of the two that is actually
//      true for all three. The file's `openSourceInReview` array is read
//      too (same anchoring), purely as a cross-check: this generator fails
//      if a PR the site calls "landed" also appears there, or if either
//      array's shape doesn't parse the way this generator expects it to.
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

const OPEN_SOURCE_URL =
  process.env.OPEN_SOURCE_URL_OVERRIDE ||
  "https://raw.githubusercontent.com/gaurav-gandhi-2411/gg-portfolio/main/content/open-source.ts";

const THEMES = {
  dark: { bg: "#0A0B0D", border: "#26282E", hi: "#EDEEF0", lo: "#A2A6B0", accent: "#818CF8", chipBg: "#131417" },
  light: { bg: "#EDEEF0", border: "#D0D3D9", hi: "#0A0B0D", lo: "#4A4E56", accent: "#4338CA", chipBg: "#E3E5EA" },
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

// ------------------------------------------------------------- open source

/**
 * Fetches gg-portfolio's content/open-source.ts and returns its raw text.
 * Throws if the fetch fails — no fallback to a cached/stale copy.
 */
async function fetchOpenSourceSource() {
  const res = await fetch(OPEN_SOURCE_URL);
  if (!res.ok) {
    throw new Error(`fetch ${OPEN_SOURCE_URL} responded ${res.status}`);
  }
  return res.text();
}

/**
 * Slices the text of `export const <exportName>: T[] = [ ... ];` out of a
 * source file, from the literal's opening `[` to the FIRST following `\n];`
 * — deliberately looking for the semicolon terminator rather than a bare
 * `]`, because open-source.ts's `openSourceInReview` entries nest their own
 * `pulls: [ ... ],` array (comma-terminated, not semicolon-terminated)
 * before the outer array closes. Throws if the export or its closing
 * bracket can't be found, which is exactly "the file's shape changed".
 */
function extractArrayLiteral(src, exportName) {
  const marker = `export const ${exportName}`;
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error(`could not find "${exportName}" in ${OPEN_SOURCE_URL} — file shape changed`);
  }
  const open = src.indexOf("[", start);
  const close = src.indexOf("\n];", open);
  if (open === -1 || close === -1) {
    throw new Error(`could not find the closing "];" for "${exportName}" in ${OPEN_SOURCE_URL} — file shape changed`);
  }
  return src.slice(open, close + 1);
}

/**
 * Splits an array-literal's inner text into its top-level `{ ... }` object
 * blocks, respecting brace nesting (open-source.ts's in-review entries nest
 * a `pulls: [{...}, {...}]` array of objects inside each top-level entry, so
 * a naive non-nested regex would slice those apart wrongly).
 */
function splitTopLevelObjects(arrayText) {
  const objects = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < arrayText.length; i++) {
    const ch = arrayText[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(arrayText.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function field(objText, name, re, context) {
  const m = objText.match(re);
  if (!m) {
    throw new Error(`open-source.ts: missing/unparseable "${name}" in ${context} — file shape changed`);
  }
  return m[1];
}

/** One `openSourceLanded` entry -> { owner, repo, number, sha, sourceRef, label }. */
function parseLandedEntry(objText) {
  const sourceRef = field(objText, "sourceRef", /sourceRef:\s*"([^"]+)"/, "an openSourceLanded entry");
  const repoFull = field(objText, "repo", /repo:\s*"([^"]+)"/, sourceRef);
  const number = Number(field(objText, "prNumber", /prNumber:\s*(\d+)/, sourceRef));
  const sha = field(objText, "commitSha", /commitSha:\s*"([a-f0-9]+)"/, sourceRef);
  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) {
    throw new Error(`open-source.ts: entry "${sourceRef}" has malformed repo "${repoFull}", expected "owner/name"`);
  }
  return { owner, repo, number, sha, sourceRef, label: `${repo} #${number}` };
}

/** One `openSourceInReview` entry -> { repo, sourceRef, pulls: [{ number }] }. */
function parseInReviewEntry(objText) {
  const sourceRef = field(objText, "sourceRef", /sourceRef:\s*"([^"]+)"/, "an openSourceInReview entry");
  const repo = field(objText, "repo", /repo:\s*"([^"]+)"/, sourceRef);
  const pullsMatch = objText.match(/pulls:\s*(\[[\s\S]*?\n\s*\])/);
  if (!pullsMatch) {
    throw new Error(`open-source.ts: entry "${sourceRef}" has no parseable "pulls" array — file shape changed`);
  }
  const pulls = splitTopLevelObjects(pullsMatch[1]).map((p) => ({
    number: Number(field(p, "number", /number:\s*(\d+)/, sourceRef)),
  }));
  if (pulls.length === 0) {
    throw new Error(`open-source.ts: entry "${sourceRef}" pulls array parsed to 0 entries — file shape changed`);
  }
  return { repo, sourceRef, pulls };
}

/**
 * Confirms `entry.sha` is an ancestor of `owner/repo`'s current default
 * branch, and that the PR number the site cites still resolves. This is the
 * additional guard on top of reading the site's own claim: if the site says
 * landed but the commit isn't actually on the default branch, that is a
 * disagreement and this throws rather than rendering anyway.
 */
async function verifyLanded(entry) {
  const repoInfo = await gh(`/repos/${entry.owner}/${entry.repo}`);
  const branch = repoInfo.default_branch;
  if (!branch) {
    throw new Error(`${entry.owner}/${entry.repo}: API response had no default_branch`);
  }

  const pr = await gh(`/repos/${entry.owner}/${entry.repo}/pulls/${entry.number}`);
  if (!pr || pr.number !== entry.number) {
    throw new Error(`${entry.owner}/${entry.repo}#${entry.number} (${entry.sourceRef}): PR lookup did not return that PR number`);
  }

  const cmp = await gh(`/repos/${entry.owner}/${entry.repo}/compare/${entry.sha}...${branch}`);
  // "identical" (sha IS the branch tip) or "ahead" with behind_by 0 (branch
  // has moved on, but sha is still reachable from its history) both mean the
  // commit landed. "diverged" or "behind" mean it did not, or landed
  // somewhere that was since rewritten off the branch — a real disagreement
  // between what the site claims and what upstream actually shows.
  const landed = cmp.status === "identical" || (cmp.status === "ahead" && cmp.behind_by === 0);
  if (!landed) {
    throw new Error(
      `${entry.owner}/${entry.repo}@${entry.sha} (${entry.sourceRef}): site says landed, but this commit is ` +
        `not an ancestor of ${branch} (compare status=${cmp.status}, behind_by=${cmp.behind_by})`
    );
  }

  return { ...entry, branch, prUrl: pr.html_url };
}

async function collectOpenSource() {
  const src = await fetchOpenSourceSource();

  const landedEntries = splitTopLevelObjects(extractArrayLiteral(src, "openSourceLanded")).map(parseLandedEntry);
  if (landedEntries.length === 0) {
    throw new Error(`open-source.ts: openSourceLanded parsed to 0 entries — file shape changed`);
  }

  const inReviewEntries = splitTopLevelObjects(extractArrayLiteral(src, "openSourceInReview")).map(
    parseInReviewEntry
  );

  console.log(
    `  read ${landedEntries.length} landed entr${landedEntries.length === 1 ? "y" : "ies"} and ` +
      `${inReviewEntries.reduce((n, e) => n + e.pulls.length, 0)} in-review pull(s) from ${OPEN_SOURCE_URL}`
  );
  for (const e of landedEntries) console.log(`    landed:    ${e.owner}/${e.repo}#${e.number} (${e.sourceRef})`);
  for (const e of inReviewEntries) {
    for (const p of e.pulls) console.log(`    in review: ${e.repo}#${p.number} (${e.sourceRef})`);
  }

  // Disagreement guard: the site's own two lists must not name the same PR
  // in both "landed" and "in review" — that would mean the site disagrees
  // with itself about whether it counts.
  const landedKeys = new Set(landedEntries.map((e) => `${e.owner}/${e.repo}#${e.number}`));
  for (const e of inReviewEntries) {
    for (const p of e.pulls) {
      const key = `${e.repo}#${p.number}`; // e.repo is already "owner/name" here
      if (landedKeys.has(key)) {
        throw new Error(
          `open-source.ts: ${key} appears in BOTH openSourceLanded and openSourceInReview — the site's own list disagrees with itself`
        );
      }
    }
  }

  return Promise.all(landedEntries.map(verifyLanded));
}

function renderOpenSource(t, verified) {
  const chips = verified
    .map((entry, i) => {
      const x = 34 + i * 200;
      return `
    <rect x="${x}" y="88" width="184" height="24" rx="12" fill="${t.chipBg}" stroke="${t.border}"/>
    <text x="${x + 92}" y="104" fill="${t.lo}" text-anchor="middle" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="11">${esc(entry.label)}</text>`;
    })
    .join("");

  const label =
    `${verified.length} pull requests landed upstream: ` +
    verified.map((e) => `${e.owner}/${e.repo} #${e.number}`).join(", ") +
    ".";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="140" viewBox="0 0 1000 140" role="img" aria-label="${esc(label)}">
  <rect width="1000" height="140" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  <text x="34" y="40" fill="${t.lo}" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="11" letter-spacing="3">OPEN SOURCE · VERIFIED VIA THE GITHUB API</text>
  <line x1="34" y1="52" x2="966" y2="52" stroke="${t.border}"/>
  <text x="34" y="80" fill="${t.hi}" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="600">${esc(
    String(verified.length)
  )} pull requests landed upstream</text>
  ${chips}
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

  console.log(`Fetching open-source source: ${OPEN_SOURCE_URL}`);
  const oss = await collectOpenSource();
  console.log(`  verifying ${oss.length} landed entr${oss.length === 1 ? "y" : "ies"} via the GitHub API...`);
  for (const entry of oss) {
    console.log(`  ok: ${entry.owner}/${entry.repo}#${entry.number} — ${entry.sha} is on ${entry.branch}`);
  }

  for (const [name, t] of Object.entries(THEMES)) {
    const impactSvg = renderImpact(t, impact);
    writeFileSync(join(ASSETS, `c-impact-${name}.svg`), impactSvg);
    console.log(`c-impact-${name}.svg      ${Buffer.byteLength(impactSvg).toLocaleString()} bytes`);

    const ossSvg = renderOpenSource(t, oss);
    writeFileSync(join(ASSETS, `c-opensource-${name}.svg`), ossSvg);
    console.log(`c-opensource-${name}.svg  ${Buffer.byteLength(ossSvg).toLocaleString()} bytes`);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
