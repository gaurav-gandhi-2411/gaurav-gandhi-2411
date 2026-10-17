// Test fixture: the shape of gg-portfolio content/products.ts (read at
// gg-portfolio main 14fdad6), cut down to 5 entries, 3 of them live.
import type { Product } from "./types";

/**
 * "Live" = has a public liveUrl.
 */
export function liveProductCount(list: Product[]): number {
  return list.filter((p) => Boolean(p.liveUrl)).length;
}

export const products: Product[] = [
  {
    slug: "alpha",
    name: "Alpha",
    liveUrl: "https://alpha.example.com/",
    repoUrl: "https://github.com/example/alpha",
  },
  {
    slug: "beta",
    name: "Beta",
    liveUrl: "https://beta.example.com/",
  },
  {
    slug: "gamma",
    name: "Gamma",
    repoUrl: "https://github.com/example/gamma",
  },
  {
    slug: "delta",
    name: "Delta",
    // A comment mentioning `backticks` and a liveUrl: "not-a-field" is fine.
    liveUrl: "https://delta.example.com/",
  },
  {
    slug: "epsilon",
    name: "Epsilon",
  },
];
