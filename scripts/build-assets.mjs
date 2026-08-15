// Builds every SVG in assets/ — the banner and the 6 section headers, each in a
// light and a dark variant.
//
// Why a generator instead of hand-written SVG: each asset embeds its own
// font subset, cut to exactly the glyphs that asset draws. Hand-maintaining
// base64 font blobs across 14 files is not viable, and an over-broad subset
// is what pushes a file past the 60KB per-file CI budget.
//
// Two hard constraints shape everything here:
//
//   1. GitHub's markdown sanitizer strips <script>, external CSS, and CSS
//      @keyframes from inline SVG. SMIL (<animate>, <animateMotion>) is the
//      only animation primitive that survives — verified empirically on
//      github.com before this suite was built (branch chore/smil-canary,
//      commit 54e5fe9). This repo previously shipped CSS @keyframes that
//      never rendered; don't reintroduce them.
//
//   2. Every asset paints its own opaque panel. GitHub's <picture> +
//      prefers-color-scheme follows the *OS* theme, while GitHub's own
//      light/dark setting is independent — the two desync routinely. The
//      previous banner was fully transparent, so a desynced visitor got
//      near-white text on white (the reported illegibility). An opaque
//      panel makes each asset legible regardless of which variant the
//      browser picks.
//
// Requires Python with fontTools + brotli on PATH for the subsetting step
// (dev-time only — CI validates the committed SVGs, it does not rebuild
// them). Run: node scripts/build-assets.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ASSETS = join(ROOT, "assets");
const FONTS = join(ASSETS, "fonts");

// ---------------------------------------------------------------- tokens

// Graphite/indigo, matching the portfolio's own tokens. The light accent is
// a darker indigo than the dark accent because #818CF8 on a light panel
// fails contrast for the small caps it's used on (measured in
// scripts/check-contrast.mjs, which gates this).
const THEMES = {
  dark: {
    key: "d",
    bg: "#0A0B0D",
    border: "#26282E",
    hi: "#EDEEF0",
    lo: "#A2A6B0",
    accent: "#818CF8",
    faint: "#3A3D45",
    chipBg: "#131417",
    chipBorder: "#2A2C33",
    // per-cluster opacity ramp for the embedding field — one hue, seven
    // opacities (house rule: cluster identity never gets a second colour)
    ramp: [0.18, 0.24, 0.3, 0.37, 0.45, 0.54, 0.62],
  },
  light: {
    key: "l",
    bg: "#EDEEF0",
    border: "#D0D3D9",
    hi: "#0A0B0D",
    lo: "#4A4E56",
    accent: "#4338CA",
    faint: "#B8BCC4",
    chipBg: "#E3E5EA",
    chipBorder: "#C7CAD1",
    ramp: [0.26, 0.32, 0.39, 0.46, 0.54, 0.63, 0.72],
  },
};

const FR = "'FR',Georgia,serif";
const SG = "'SG',-apple-system,'Segoe UI',sans-serif";
const JB = "'JB','SFMono-Regular',Consolas,monospace";

// ------------------------------------------------------------ subsetting

// Pinned axis values per family. Fraunces ships 4 axes (opsz/wght/SOFT/WONK)
// and JetBrains/Space Grotesk ship wght; pinning them to the single
// instance an asset actually draws is what takes Fraunces from ~120KB to
// ~6KB after subsetting.
const AXES = {
  fraunces: (wght) => [`opsz=144`, `wght=${wght}`, `SOFT=0`, `WONK=0`],
  spacegrotesk: (wght) => [`wght=${wght}`],
  jetbrains: (wght) => [`wght=${wght}`],
};

// Pinned so the build is reproducible. fontTools stamps the OpenType `head`
// table's `modified` field with the current time, so without this every run
// produced different font bytes from identical inputs — all 14 assets showed
// as changed on a no-op rebuild, which makes "do the committed assets match
// the generator?" unanswerable and buries a real diff in noise. fontTools
// honours SOURCE_DATE_EPOCH (the reproducible-builds convention) for exactly
// this. The value is arbitrary; only its fixedness matters.
const SOURCE_DATE_EPOCH = "1735689600"; // 2025-01-01T00:00:00Z
const FONT_ENV = { ...process.env, SOURCE_DATE_EPOCH };

const subsetCache = new Map();
const instanceCache = new Map();
const WORK = mkdtempSync(join(tmpdir(), "ghassets-"));
process.on("exit", () => rmSync(WORK, { recursive: true, force: true }));

// Step 1 of 2: pin the variable axes to the single instance this weight
// needs. fontTools.subset cannot do this itself — it has no axis-pinning
// flag — and skipping it is expensive: the Fraunces subset for "Gaurav
// Gandhi" is 8,764 bytes with all 4 axes live and 1,540 bytes pinned.
function instance(family, wght) {
  const cacheKey = `${family}:${wght}`;
  if (instanceCache.has(cacheKey)) return instanceCache.get(cacheKey);
  const out = join(WORK, `${family}-${wght}.ttf`);
  execFileSync(
    "python",
    [
      "-m",
      "fontTools.varLib.instancer",
      join(FONTS, `${family}.woff2`),
      ...AXES[family](wght),
      "-o",
      out,
    ],
    { stdio: ["ignore", "ignore", "pipe"], env: FONT_ENV }
  );
  instanceCache.set(cacheKey, out);
  return out;
}

// Step 2 of 2: cut the pinned instance down to the glyphs actually drawn.
function subset(family, wght, chars) {
  const text = [...new Set([...chars])].sort().join("");
  const cacheKey = `${family}:${wght}:${text}`;
  if (subsetCache.has(cacheKey)) return subsetCache.get(cacheKey);

  // --text-file rather than --text: the strings contain U+2212 MINUS,
  // U+2192 ARROW and U+00B7 MIDDLE DOT, which do not survive the Windows
  // console codepage when passed as an argv string.
  const textFile = join(WORK, `t-${family}-${wght}.txt`);
  writeFileSync(textFile, text, "utf8");
  const out = join(WORK, `s-${family}-${wght}.woff2`);
  execFileSync(
    "python",
    [
      "-m",
      "fontTools.subset",
      instance(family, wght),
      `--text-file=${textFile}`,
      `--output-file=${out}`,
      "--flavor=woff2",
      // Drop everything an <img>-rendered SVG can never use: hinting,
      // layout features, and the name table.
      "--layout-features=",
      "--no-hinting",
      "--desubroutinize",
      "--name-IDs=",
    ],
    { stdio: ["ignore", "ignore", "pipe"], env: FONT_ENV }
  );
  const b64 = readFileSync(out).toString("base64");
  subsetCache.set(cacheKey, b64);
  return b64;
}

// An asset declares which families/weights it uses and the exact text it
// draws; fontFaces() cuts a subset per (family, weight) pair.
function fontFaces(uses) {
  return uses
    .map(({ family, css, wght, text }) => {
      const b64 = subset(family, wght, text);
      return `@font-face{font-family:'${css}';font-weight:${wght};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
    })
    .join("\n    ");
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// --------------------------------------------------------------- content

const COPY = {
  overline: "SENIOR DATA SCIENTIST · APPLIED AI",
  name: "Gaurav Gandhi",
  sub1: "Leading a 5-person GenAI team in Uber's AI org.",
  sub2: "13 AI products shipped · 2 preprints on agent evaluation.",
  tagline: "Every number here links to the commit that produced it · gaurav-gandhi.vercel.app",
};

// The one metric the banner shows, with enough frame that a stranger who has
// never heard of the project understands it. Provenance SHA is real —
// gg-portfolio content/metrics.json.
//
// The headline text node carries class="mval" and MUST keep it. It is not a
// styling hook (nothing here selects on it) — it is the marker
// gg-portfolio's scripts/check-metric-freshness.mjs scopes its SVG-drift
// scan to. That scan deliberately refuses to read raw file text, because
// these assets embed base64 font subsets whose bytes are full of digits that
// would parse as metric tokens; `mval` is the only thing that makes a
// text-presence check on a generated SVG safe at all. The first version of
// this generator dropped the class, and the freshness check immediately and
// correctly reported drift on every tracked pair.
const CALLOUT = {
  model: "hinglish-relatedness-sbert",
  headline: "Spearman −0.003 → 0.813 after fine-tuning",
  sub: "t-SNE of all 419 eval terms · commit ",
  sha: "16f35d1",
};

// -------------------------------------------------------------- banner

const BW = 1000;
const BH = 340;

function banner(t) {
  const proj = JSON.parse(
    readFileSync(join(ROOT, "data", "hinglish-embedding-projection.json"), "utf8")
  );

  // Field occupies the right ~58% of the panel. The concept render had the
  // cloud colliding with the right edge of the name and the sub-lines; the
  // field now starts at x=452 and the scrim holds solid to 0.66 so the text
  // column is always clean.
  const FX0 = 452;
  const fx = (x) => FX0 + ((x + 1) / 2) * (BW - FX0 - 18);
  const fy = (y) => 24 + ((y + 1) / 2) * (BH - 48);
  const fr = (z) => +(1.5 + ((z + 1) / 2) * 2.0).toFixed(1);

  const pts = proj.points.map((p) => ({
    x: +fx(p.finetuned[0]).toFixed(1),
    y: +fy(p.finetuned[1]).toFixed(1),
    r: fr(p.finetuned[2]),
    c: p.cluster,
  }));

  // Grouped by cluster so opacity lives on the <g>, not on 419 individual
  // circles — that alone is worth ~9KB of the per-file budget.
  const byCluster = new Map();
  for (const p of pts) {
    if (!byCluster.has(p.c)) byCluster.set(p.c, []);
    byCluster.get(p.c).push(p);
  }

  // Motion: at most 3 things move at any instant (brief's ceiling). Three
  // of the largest dots drift on long, eased loops; two similarity edges
  // fade in and out on a 16s cycle, offset so they never overlap.
  const drifters = new Set(
    [...pts].sort((a, b) => b.r - a.r).slice(0, 3).map((p) => `${p.x},${p.y}`)
  );
  let di = 0;

  const field = [...byCluster.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, members]) => {
      const circles = members
        .map((p) => {
          const base = `<circle cx="${p.x}" cy="${p.y}" r="${p.r}"`;
          if (!drifters.has(`${p.x},${p.y}`)) return `${base}/>`;
          const dx = 6 + di * 2;
          const dy = 5 + di * 1.5;
          const dur = 13 + di * 1.5;
          const beg = -(di * 4.3);
          di++;
          return (
            `${base}><animateMotion dur="${dur}s" begin="${beg}s" repeatCount="indefinite" ` +
            `path="M 0 0 C ${dx} ${-dy}, ${dx} ${dy}, 0 ${(dy * 1.4).toFixed(1)} ` +
            `C ${-dx} ${dy}, ${-dx} ${-dy}, 0 0"/></circle>`
          );
        })
        .join("");
      return `<g fill="${t.accent}" opacity="${t.ramp[c % 7]}">${circles}</g>`;
    })
    .join("\n    ");

  // Anchor the callout to the densest cluster's centroid — the visual claim
  // ("fine-tuning produced this structure") should point at actual structure.
  const [, biggest] = [...byCluster.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const cx = biggest.reduce((s, p) => s + p.x, 0) / biggest.length;
  const cy = biggest.reduce((s, p) => s + p.y, 0) / biggest.length;
  const near = biggest
    .filter((p) => Math.hypot(p.x - cx, p.y - cy) < 62)
    .sort((a, b) => a.x - b.x);

  const edges = [
    [near[0], near[Math.floor(near.length / 2)], 0],
    [near[1], near[near.length - 2], 8],
  ]
    .filter(([a, b]) => a && b)
    .map(
      ([a, b, beg]) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${t.accent}"
      stroke-width="0.9" opacity="0"><animate attributeName="opacity"
      values="0;0;0.55;0.55;0;0" keyTimes="0;0.28;0.36;0.5;0.58;1" dur="16s"
      begin="${beg}s" repeatCount="indefinite"/></line>`
    )
    .join("\n    ");

  const cardX = 648;
  const cardY = 240;
  const cardW = 334;
  const cardH = 80;
  const ax = Math.min(Math.max(cx, FX0 + 10), BW - 40);
  const ay = Math.min(cy, cardY - 16);

  const uses = [
    { family: "spacegrotesk", css: "SG", wght: 500, text: COPY.overline + CALLOUT.headline },
    {
      family: "spacegrotesk",
      css: "SG",
      wght: 400,
      text: COPY.sub1 + COPY.sub2 + COPY.tagline + CALLOUT.sub,
    },
    { family: "fraunces", css: "FR", wght: 500, text: COPY.name },
    { family: "jetbrains", css: "JB", wght: 400, text: CALLOUT.model + CALLOUT.sha },
  ];

  return `<svg width="${BW}" height="${BH}" viewBox="0 0 ${BW} ${BH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(
    COPY.name
  )} — Senior Data Scientist, Applied AI. ${esc(COPY.sub1)} ${esc(COPY.sub2)}">
  <defs>
    <style>
    ${fontFaces(uses)}
    </style>
    <linearGradient id="scrim-${t.key}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.bg}" stop-opacity="1"/>
      <stop offset="0.66" stop-color="${t.bg}" stop-opacity="1"/>
      <stop offset="1" stop-color="${t.bg}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="clip-${t.key}"><rect x="1" y="1" width="${BW - 2}" height="${
    BH - 2
  }" rx="14"/></clipPath>
  </defs>

  <rect x="1" y="1" width="${BW - 2}" height="${
    BH - 2
  }" rx="14" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>

  <g clip-path="url(#clip-${t.key})">
    ${field}
    ${edges}
    <rect x="0" y="0" width="700" height="${BH}" fill="url(#scrim-${t.key})"/>
    <line x1="${ax}" y1="${ay}" x2="${cardX + 44}" y2="${cardY}" stroke="${
    t.faint
  }" stroke-width="1"/>
    <circle cx="${ax}" cy="${ay}" r="3.2" fill="none" stroke="${t.accent}" stroke-width="1.3"/>
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="9" fill="${
    t.chipBg
  }" stroke="${t.chipBorder}" stroke-width="1"/>
    <text x="${cardX + 17}" y="${
    cardY + 23
  }" font-family="${JB}" font-size="11.5" fill="${t.accent}">${esc(CALLOUT.model)}</text>
    <text class="mval" x="${cardX + 17}" y="${
    cardY + 45
  }" font-family="${SG}" font-size="14.5" font-weight="500" fill="${t.hi}">${esc(
    CALLOUT.headline
  )}</text>
    <text x="${cardX + 17}" y="${
    cardY + 65
  }" font-family="${SG}" font-size="11.5" fill="${t.lo}">${esc(
    CALLOUT.sub
  )}<tspan font-family="${JB}" font-size="10.5">${CALLOUT.sha}</tspan></text>
  </g>

  <text x="56" y="94" font-family="${SG}" font-size="13" font-weight="500" letter-spacing="2.6" fill="${
    t.accent
  }">${esc(COPY.overline)}</text>
  <text x="53" y="164" font-family="${FR}" font-size="68" font-weight="500" fill="${
    t.hi
  }">${esc(COPY.name)}</text>
  <text x="56" y="203" font-family="${SG}" font-size="15.5" fill="${t.lo}">${esc(COPY.sub1)}</text>
  <text x="56" y="226" font-family="${SG}" font-size="15.5" fill="${t.lo}">${esc(COPY.sub2)}</text>
  <rect x="56" y="282" width="26" height="2" fill="${t.accent}"/>
  <text x="56" y="304" font-family="${SG}" font-size="13" fill="${t.lo}">${esc(COPY.tagline)}</text>
</svg>
`;
}

// ------------------------------------------------------------- headers

const HEADERS = [
  { slug: "research", n: "01", eyebrow: "RESEARCH", title: "Research" },
  { slug: "focus", n: "02", eyebrow: "FOCUS", title: "What I work with" },
  { slug: "work", n: "03", eyebrow: "SHIPPED", title: "Shipped & live" },
  { slug: "how", n: "04", eyebrow: "METHOD", title: "How I work" },
  { slug: "journey", n: "05", eyebrow: "JOURNEY", title: "Journey" },
  { slug: "stack", n: "06", eyebrow: "STACK", title: "Stack" },
];

const HW = 1200;
// 106 rather than a tighter box because Fraunces at 36px drops descenders
// ~9px below the baseline — "Shipped & live" and "Journey" collided with the
// rule at the first height tried.
const HH = 106;

function header(t, h) {
  const eyebrow = `${h.n} · ${h.eyebrow}`;
  const uses = [
    { family: "spacegrotesk", css: "SG", wght: 700, text: eyebrow },
    { family: "fraunces", css: "FR", wght: 600, text: h.title },
  ];

  // The rule draws in once on load (fill="freeze"), rather than looping —
  // six looping rules down a README would be six competing motions.
  return `<svg width="${HW}" height="${HH}" viewBox="0 0 ${HW} ${HH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(
    h.title
  )}">
  <defs>
    <style>
    ${fontFaces(uses)}
    </style>
    <linearGradient id="rule-${h.slug}-${t.key}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.accent}" stop-opacity="0.6"/>
      <stop offset="1" stop-color="${t.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="${HW - 2}" height="${
    HH - 2
  }" rx="12" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>
  <rect x="26" y="24" width="5" height="58" rx="2.5" fill="${t.accent}"/>
  <text x="50" y="44" font-family="${SG}" font-size="13" font-weight="700" letter-spacing="3.4" fill="${
    t.accent
  }">${esc(eyebrow)}</text>
  <text x="48" y="80" font-family="${FR}" font-size="36" font-weight="600" fill="${t.hi}">${esc(
    h.title
  )}</text>
  <line x1="26" y1="96" x2="${HW - 26}" y2="96" stroke="${t.faint}" stroke-width="1"/>
  <line x1="26" y1="96" x2="${HW - 26}" y2="96" stroke="url(#rule-${h.slug}-${
    t.key
  })" stroke-width="2" stroke-linecap="round" stroke-dasharray="${HW}" stroke-dashoffset="${HW}">
    <animate attributeName="stroke-dashoffset" from="${HW}" to="0" dur="1.4s" begin="0.1s"
             fill="freeze" calcMode="spline" keySplines="0.42 0 0.58 1"/>
  </line>
</svg>
`;
}

// ------------------------------------------------------------ sparkline

// Three already-verified accuracy metrics lifted straight from the project
// table in README.md — this asset introduces no new numbers, it visualizes
// ones already cited and already gated by the repo's own claims. Picked for
// being on the same 0-100% accuracy scale so a single bar-length axis is
// honest (Wilson-CI and MAE-style results from the same table are not
// comparable on this axis and are intentionally left out).
const SPARK = [
  { label: "TriageIQ (k8s top-3)", value: 87.1 },
  { label: "Style Maitri (intent-parsing)", value: 93.8 },
  { label: "Samidha Reviews (extraction)", value: 83.8 },
];

const SW = 1200;
const SH = 150;

function sparkline(t) {
  const trackX = 330;
  const trackW = 730;
  const rowYs = [46, 84, 122];

  // Reuses the same subset() call the banner's callout already makes for
  // JetBrains at weight 400 — the axis-pinned instance is cached by
  // (family, weight) inside this run, so this only pays for a fresh glyph
  // cut, not a second font-instancing pass.
  const uses = [
    {
      family: "spacegrotesk",
      css: "SG",
      wght: 500,
      text: SPARK.map((s) => s.label).join("") + "Matches the project table above.",
    },
    { family: "jetbrains", css: "JB", wght: 400, text: SPARK.map((s) => `${s.value}%`).join("") },
  ];

  const rows = SPARK.map((s, i) => {
    const y = rowYs[i];
    const barY = y - 14;
    const barW = +(trackW * (s.value / 100)).toFixed(1);
    return `
    <text x="28" y="${y}" font-family="${SG}" font-size="13" font-weight="500" fill="${t.lo}">${esc(
      s.label
    )}</text>
    <rect x="${trackX}" y="${barY}" width="${trackW}" height="10" rx="5" fill="${
      t.chipBg
    }" stroke="${t.chipBorder}" stroke-width="1"/>
    <rect x="${trackX}" y="${barY}" width="${barW}" height="10" rx="5" fill="${t.accent}"/>
    <text x="${trackX + trackW + 14}" y="${y}" font-family="${JB}" font-size="13" fill="${
      t.hi
    }">${s.value}%</text>`;
  }).join("\n");

  const ariaLabel = `Accuracy sparkline: ${SPARK.map((s) => `${s.label} ${s.value}%`).join(", ")}`;

  // One pulse-dot, matching the banner's existing scatter idiom (opacity
  // <animate>, repeatCount="indefinite") rather than inventing a new motion
  // style — a small "this is live-verified" marker beside the caption.
  return `<svg width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(
    ariaLabel
  )}">
  <defs>
    <style>
    ${fontFaces(uses)}
    </style>
  </defs>
  <rect x="1" y="1" width="${SW - 2}" height="${
    SH - 2
  }" rx="14" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>
  ${rows}
  <circle cx="28" cy="${SH - 22}" r="3" fill="${t.accent}">
    <animate attributeName="opacity" values="0.4;1;0.4" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <text x="40" y="${
    SH - 18
  }" font-family="${SG}" font-size="11" fill="${t.lo}">Matches the project table above.</text>
</svg>
`;
}

// ----------------------------------------------------------------- run

let written = 0;
for (const [tname, t] of Object.entries(THEMES)) {
  const b = banner(t);
  writeFileSync(join(ASSETS, `banner-${tname}.svg`), b);
  console.log(`banner-${tname}.svg      ${Buffer.byteLength(b).toLocaleString()} bytes`);
  written++;
  for (const h of HEADERS) {
    const s = header(t, h);
    writeFileSync(join(ASSETS, `h-${h.slug}-${tname}.svg`), s);
    console.log(`h-${h.slug}-${tname}.svg`.padEnd(24) + `${Buffer.byteLength(s).toLocaleString()} bytes`);
    written++;
  }
  const spark = sparkline(t);
  writeFileSync(join(ASSETS, `sparkline-${tname}.svg`), spark);
  console.log(`sparkline-${tname}.svg`.padEnd(24) + `${Buffer.byteLength(spark).toLocaleString()} bytes`);
  written++;
}
console.log(`\nwrote ${written} files`);
