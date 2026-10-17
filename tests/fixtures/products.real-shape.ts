// Verbatim excerpt of gg-portfolio content/products.ts at main 14fdad6 (entries triageiq,
// warmer, tracegauge): covers every distinct line shape the real file has at four-space
// indent. 3 entries, 2 live.
import { refreshableMetric } from "@/lib/metrics";
import type { Product } from "./types";

export function liveProductCount(list: Product[]): number {
  return list.filter((p) => Boolean(p.liveUrl)).length;
}

export const products: Product[] = [
  {
    slug: "triageiq",
    name: "TriageIQ",
    tagline:
      "Reads a new GitHub issue and tells you which component it belongs to, which already-solved issues look like it, and roughly how long it will take to close.",
    liveUrl: "https://triage-iq-orcin.vercel.app/",
    repoUrl: "https://github.com/gaurav-gandhi-2411/triage-iq",
    categories: ["llm-agents", "retrieval", "forecasting", "evals-research"],
    techChips: ["TF-IDF", "BGE + FAISS", "LightGBM", "Groq"],
    // The kubernetes figure, not vscode's higher 89.8% — the card shows one
    // number and this is the lower of the two, which is the right default for
    // a site whose whole claim is that its numbers are the honest ones.
    metric: refreshableMetric("triageiq:classifier-top3-k8s"),
    figure: {
      kind: "bars",
      rows: [
        { name: "k8s", pct: 87.1 },
        { name: "vscode", pct: 89.8 },
      ],
    },
  },
  {
    slug: "warmer",
    name: "Warmer",
    tagline:
      "A word game you play once a day, where your only clue is how close each guess comes in meaning to the secret word.",
    liveUrl: "https://playwarmer.vercel.app/",
    // Repo (mindmeld) is private — no public repo link until that changes. See provenance.md.
    categories: ["retrieval", "evals-research"],
    techChips: ["Flutter", "sentence-transformers", "Firebase"],
    metric: refreshableMetric("warmer:hinglish-fix"),
    figure: { kind: "dumbbell", from: -0.003, to: 0.813, scaleNote: "0–1 scale" },
  },
  {
    slug: "tracegauge",
    name: "tracegauge",
    tagline:
      "Scores a Claude Code session on how efficient it was, and shows you where the tokens went to waste.",
    repoUrl: "https://github.com/gaurav-gandhi-2411/token-efficiency-scorer",
    categories: ["tooling", "evals-research", "llm-agents"],
    techChips: ["Python", "PyPI"],
    pypi: {
      packageName: "tracegauge",
      installCommand: "pip install tracegauge",
      badgeUrl: "https://img.shields.io/pypi/v/tracegauge.svg",
    },
  },
];
