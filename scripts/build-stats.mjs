// Builds assets/stats-{dark,light}.svg from this account's public GitHub
// data. Run by .github/workflows/stats.yml on a schedule and committed, so
// the README never reaches a third-party image host at render time.
//
// That constraint is the whole reason this file exists. The usual way to put
// stats on a profile is an <img> pointing at somebody else's server, which
// means a stranger loading the page hands their IP to a third party, the
// numbers change without a commit, and the profile breaks when that service
// does. Generating the SVG here and committing it makes the numbers a
// reviewable artifact with a diff, which is the same standard the portfolio
// holds its own metrics to.
//
// Deliberately no font subsetting and no embedded fonts: this file is
// regenerated on a schedule, and a scheduled job that shells out to Python
// and fontTools is a scheduled job that will eventually fail for a reason
// nobody is watching. System font stack, drawn as text, and the type scale
// matches the section headers closely enough to sit beside them.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
const USER = "gaurav-gandhi-2411";

const THEMES = {
  dark: { bg: "#0A0B0D", border: "#26282E", hi: "#EDEEF0", lo: "#A2A6B0", accent: "#818CF8", chipBg: "#131417" },
  light: { bg: "#EDEEF0", border: "#D0D3D9", hi: "#0A0B0D", lo: "#4A4E56", accent: "#4338CA", chipBg: "#E3E5EA" },
};

const W = 1000;
const H = 168;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": USER,
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} responded ${res.status}`);
  return res.json();
}

/**
 * Public, checkable facts only.
 *
 * No streaks, no grades, no "productivity score". Those are the things
 * profile stat cards invent to look impressive, and none of them is a fact
 * about the work. Repository count, stars other people gave, and the
 * languages the code is actually written in are all verifiable by opening
 * the same profile.
 */
async function collect() {
  const repos = [];
  for (let page = 1; page <= 4; page++) {
    const batch = await gh(`/users/${USER}/repos?per_page=100&page=${page}&type=owner&sort=pushed`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const own = repos.filter((r) => !r.fork && !r.private);
  const stars = own.reduce((s, r) => s + (r.stargazers_count ?? 0), 0);

  const byLanguage = new Map();
  for (const r of own) {
    if (!r.language) continue;
    byLanguage.set(r.language, (byLanguage.get(r.language) ?? 0) + 1);
  }
  const languages = [...byLanguage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const pushedAt = own.length ? own[0].pushed_at : null;

  return { repoCount: own.length, stars, languages, pushedAt, mostRecent: own[0]?.name ?? null };
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function render(t, data) {
  const figures = [
    [String(data.repoCount), "public repositories"],
    [String(data.stars), data.stars === 1 ? "star from someone else" : "stars from other people"],
    [
      data.pushedAt === null
        ? "n/a"
        : daysSince(data.pushedAt) === 0
          ? "today"
          : `${daysSince(data.pushedAt)}d`,
      "since the last push",
    ],
  ];

  const cols = figures
    .map(([value, label], i) => {
      const x = 34 + i * 268;
      return `
    <text x="${x}" y="86" fill="${t.hi}" font-family="Georgia, 'Times New Roman', serif" font-size="44" font-weight="600">${esc(value)}</text>
    <text x="${x}" y="112" fill="${t.lo}" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="12" letter-spacing="0.5">${esc(label)}</text>`;
    })
    .join("");

  const chips = data.languages
    .map(([name], i) => {
      const x = 34 + i * 116;
      return `
    <rect x="${x}" y="128" width="104" height="24" rx="12" fill="${t.chipBg}" stroke="${t.border}"/>
    <text x="${x + 52}" y="144" fill="${t.lo}" text-anchor="middle" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="11">${esc(name)}</text>`;
    })
    .join("");

  // The alt text is a sentence, not a slug: it is what a screen reader
  // actually reads out, so it gets the same plurals the visible figures do.
  const days = daysSince(data.pushedAt);
  const label = [
    `${data.repoCount} public ${data.repoCount === 1 ? "repository" : "repositories"}`,
    `${data.stars} ${data.stars === 1 ? "star" : "stars"} from other people`,
    days === null ? "last push unknown" : days === 0 ? "last push today" : `last push ${days} days ago`,
    data.languages.length ? `mostly ${data.languages.map(([n]) => n).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
  <rect width="${W}" height="${H}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  <text x="34" y="40" fill="${t.lo}" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="11" letter-spacing="3">FROM THE GITHUB API</text>
  <line x1="34" y1="52" x2="${W - 34}" y2="52" stroke="${t.border}"/>
  ${cols}
  ${chips}
</svg>
`;
}

const data = await collect();
for (const [name, t] of Object.entries(THEMES)) {
  const out = join(ASSETS, `stats-${name}.svg`);
  writeFileSync(out, render(t, data));
  console.log(`stats-${name}.svg  ${data.repoCount} repos · ${data.stars} stars · ${data.languages.length} languages`);
}
