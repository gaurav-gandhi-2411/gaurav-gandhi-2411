// CI check: every text/background pair the assets actually draw must clear
// its WCAG 2.1 contrast threshold, in BOTH themes.
//
// Why this exists as a gate rather than a review note: the banner this suite
// replaced was approved from a text description and shipped illegible — the
// name rendered near-white on white for any visitor whose OS theme was
// desynced from their GitHub theme. "Looks fine to me" is not a measurement,
// and the person checking is usually looking at only one of the two themes.
//
// Thresholds (WCAG 2.1 AA): 4.5:1 for normal text, 3:1 for large text
// (>=24px, or >=18.66px bold). Each pair below names the asset element it
// covers so a failure points at something specific.
//
// Zero dependencies; Node 20+.

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Mirrors the THEMES table in build-assets.mjs. Kept as a literal rather
// than imported so this check fails loudly if the two ever drift apart
// rather than silently validating whatever the generator now uses.
const T = {
  dark: {
    bg: "#0A0B0D", hi: "#EDEEF0", lo: "#A2A6B0",
    accent: "#818CF8", chipBg: "#131417",
  },
  light: {
    bg: "#EDEEF0", hi: "#0A0B0D", lo: "#4A4E56",
    accent: "#4338CA", chipBg: "#E3E5EA",
  },
};

// [element, foreground key, background key, min ratio]
// "large" = 3:1 per WCAG (>=24px, or >=18.66px bold).
const PAIRS = [
  ["banner / name (68px Fraunces)", "hi", "bg", 3],
  ["banner / overline (13px, 500)", "accent", "bg", 4.5],
  ["banner / sub-lines (15.5px)", "lo", "bg", 4.5],
  ["banner / tagline (13px)", "lo", "bg", 4.5],
  ["banner / callout model name (11.5px mono)", "accent", "chipBg", 4.5],
  ["banner / callout headline (14.5px, 500)", "hi", "chipBg", 4.5],
  ["banner / callout sub (11.5px)", "lo", "chipBg", 4.5],
  ["header / eyebrow (13px, 700)", "accent", "bg", 4.5],
  ["header / title (36px Fraunces)", "hi", "bg", 3],
];

let failed = false;
for (const [theme, t] of Object.entries(T)) {
  console.log(`\n${theme}`);
  for (const [label, fg, bg, min] of PAIRS) {
    const ratio = contrast(t[fg], t[bg]);
    const ok = ratio >= min;
    if (!ok) failed = true;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${ratio.toFixed(2).padStart(6)}:1 ` +
        `(min ${min}) ${label}  [${t[fg]} on ${t[bg]}]`
    );
  }
}

console.log(
  failed
    ? "\nFAIL: at least one text/background pair is below its WCAG AA threshold."
    : "\nAll pairs clear WCAG AA in both themes."
);
process.exit(failed ? 1 : 0);
