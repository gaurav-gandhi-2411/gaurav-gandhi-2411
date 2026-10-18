// The project and live counts the banner states, read from the portfolio's own
// product list so the banner cannot disagree with the site.
//
// Source: gg-portfolio's content/products.ts on `main` — the array the site's
// own `products.length` and `liveProductCount()` run over. Same mechanism as
// build-readme-cards.mjs (raw fetch of a gg-portfolio content file, anchored
// parser, no secrets, no scraping of rendered HTML).
//
// Fails closed. A fetch error, a file whose structure this parser cannot count
// EXACTLY, or a count that is not a positive integer throws; the CLI form
// exits 1. There is no fallback to a previously-typed or previously-committed
// number, because a stale number is exactly the bug this file exists to end.
//
// Not a TypeScript parser, so it refuses anything it could miscount rather
// than guess: block comments, template literals, one-line entries, helper
// calls, spreads, a second array or any mutation of `products` are all errors.
// It recognises exactly one shape: a column-0 `export const products:
// Product[] = [` ... `];` whose entries open with `  {` and close with `  },`
// at two-space indent and carry `slug:` (and optionally `liveUrl:`) at
// four-space indent.
//
// CLI: node scripts/site-counts.mjs   -> prints {"projects":N,"live":M}

import { pathToFileURL } from "node:url";

export const DEFAULT_PRODUCTS_URL =
  "https://raw.githubusercontent.com/gaurav-gandhi-2411/gg-portfolio/main/content/products.ts";

const REDIRECT_HOST = "raw.githubusercontent.com";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_000_000;

/**
 * The source URL. PRODUCTS_SOURCE_URL_OVERRIDE is a test hook for stub servers
 * and is honoured only for 127.0.0.1 / localhost; anything else throws, so the
 * override cannot be used to feed the generator an arbitrary remote file.
 */
export function productsUrl() {
  return localOnlyOverride("PRODUCTS_SOURCE_URL_OVERRIDE") ?? DEFAULT_PRODUCTS_URL;
}

/**
 * The value of env var `name` if it is set, else undefined. Honoured only when
 * it points at 127.0.0.1 / localhost (test stub servers); anything else throws.
 */
export function localOnlyOverride(name) {
  const override = process.env[name];
  if (!override) return undefined;
  let u;
  try {
    u = new URL(override);
  } catch {
    throw new Error(`${name} is not a URL: ${override}`);
  }
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || !["http:", "https:"].includes(u.protocol)) {
    throw new Error(`${name} must point at 127.0.0.1 or localhost, got ${u.host}`);
  }
  return override;
}

/**
 * Fetches the raw products.ts text. Throws on a network error, timeout,
 * non-2xx, a redirect anywhere but raw.githubusercontent.com, or a body larger
 * than maxBytes. `allowedHosts` (exact names, or ".suffix" entries) widens the
 * redirect allow-list for other callers such as the drift check.
 */
export async function fetchProductsSource(
  url = productsUrl(),
  { timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, allowedHosts = [REDIRECT_HOST] } = {}
) {
  const hostOk = (h) => allowedHosts.some((a) => (a.startsWith(".") ? h.endsWith(a) : h === a));
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  let res;
  try {
    for (let hops = 0; ; hops += 1) {
      res = await fetch(current, { redirect: "manual", signal });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      const next = loc ? new URL(loc, current) : null;
      if (hops >= 3 || !next || next.protocol !== "https:" || !hostOk(next.hostname)) {
        throw new Error(`redirect from ${current} to ${loc} refused`);
      }
      current = next.href;
    }
  } catch (err) {
    throw new Error(`fetch ${url} failed: ${err.message}`);
  }
  if (!res.ok) throw new Error(`fetch ${url} responded ${res.status}`);

  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new Error(`fetch ${url}: body of ${declared} bytes exceeds ${maxBytes}`);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) throw new Error(`body exceeds ${maxBytes} bytes`);
      chunks.push(chunk);
    }
  } catch (err) {
    throw new Error(`fetch ${url} failed: ${err.message}`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function positiveInt(n, what) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${what} is ${n}, expected a positive integer`);
  }
  return n;
}

const LIVE_FN =
  /export function liveProductCount\(list: Product\[\]\): number \{\s*\n\s*return list\.filter\(\(p\) => Boolean\(p\.liveUrl\)\)\.length;/;
const OPEN = "export const products: Product[] = [";

/**
 * Returns { projects, live } from the text of content/products.ts.
 * "live" mirrors the site's liveProductCount(): entries with a non-empty
 * string liveUrl. The parser first verifies that function still has that
 * definition, so a redefinition on the site fails here instead of drifting.
 */
export function parseSiteCounts(rawSrc) {
  if (typeof rawSrc !== "string" || rawSrc.length === 0) throw new Error("products source is empty");
  // A Windows checkout of the test fixture is CRLF; the parser is line-anchored.
  const all = rawSrc.replace(/\r\n/g, "\n").split("\n");

  if (!LIVE_FN.test(all.join("\n"))) {
    throw new Error("liveProductCount() is not the expected Boolean(p.liveUrl) filter; refusing to guess");
  }

  const starts = all.flatMap((l, i) => (l.startsWith("export const products") ? [i] : []));
  if (starts.length !== 1 || all[starts[0]] !== OPEN) {
    throw new Error(`expected exactly one \`${OPEN}\` line at column 0`);
  }
  const from = starts[0] + 1;

  // The array ends at the first column-0 line that is not blank or a comment.
  let to = -1;
  for (let i = from; i < all.length; i += 1) {
    const l = all[i];
    if (l.trim() === "" || l.startsWith("//")) continue;
    if (!l.startsWith(" ")) {
      to = i;
      break;
    }
  }
  if (to === -1 || all[to] !== "];") throw new Error("products array is not closed by a column-0 `];`");

  const body = all.slice(from, to);
  const bodyText = body.join("\n");
  if (/\/\*|\*\//.test(bodyText)) throw new Error("block comment inside the products array");
  // Backticks are fine inside `//` comments (the real file has them); anywhere
  // else they could open a multi-line string this line-based parser can't see.
  if (body.some((l) => !l.trim().startsWith("//") && l.includes("`"))) throw new Error("template literal inside the products array");

  // Anything after the array that could change what `products` holds.
  const after = all.slice(to + 1).join("\n");
  if (/\bproducts\s*(=[^=]|\.(push|unshift|splice|concat|pop|shift|length\s*=))/.test(after)) {
    throw new Error("products is modified after its declaration");
  }

  const entries = [];
  for (const [n, line] of body.entries()) {
    const at = `line ${from + n + 1}`;
    if (line.trim() === "" || line.trim().startsWith("//")) continue;
    if (/^ {2}\S/.test(line)) {
      if (line === "  {") {
        if (entries.length > 0 && !entries[entries.length - 1].closed) throw new Error(`${at}: entry opened inside an open entry`);
        entries.push({ lines: [], closed: false });
      } else if (line === "  },") {
        if (entries.length === 0 || entries[entries.length - 1].closed) throw new Error(`${at}: stray entry close`);
        entries[entries.length - 1].closed = true;
      } else {
        throw new Error(`${at}: unsupported two-space line ${JSON.stringify(line)}`);
      }
    } else if (!line.startsWith(" ")) {
      throw new Error(`${at}: unexpected column-0 line ${JSON.stringify(line)}`);
    } else {
      if (entries.length === 0 || entries[entries.length - 1].closed) {
        throw new Error(`${at}: content outside an entry ${JSON.stringify(line)}`);
      }
      // A top-level property line must be `identifier: value` (or a bare
      // `identifier:` whose value follows indented, or the `    },` that closes
      // a nested object). Quoted or computed keys, spreads and `=` could carry
      // a `liveUrl` this parser would not see. Deeper-indented lines are
      // continuations of a value and are not property lines.
      if (/^ {1,3}\S/.test(line)) throw new Error(`${at}: unsupported indentation ${JSON.stringify(line)}`);
      if (/^ {4}\S/.test(line) && !/^ {4}[A-Za-z_$][A-Za-z0-9_$]*:( |$)/.test(line) && line !== "    },") {
        throw new Error(`${at}: unsupported property line ${JSON.stringify(line)}`);
      }
      entries[entries.length - 1].lines.push(line);
    }
  }
  if (entries.some((e) => !e.closed)) throw new Error("an entry is never closed with `  },`");

  let live = 0;
  let slugLines = 0;
  for (const [i, e] of entries.entries()) {
    const slugs = e.lines.filter((l) => /^ {4}slug: "[^"]+",$/.test(l));
    slugLines += slugs.length;
    if (slugs.length !== 1) throw new Error(`entry ${i} has ${slugs.length} slug lines, expected 1`);
    const liveLines = e.lines.filter((l) => /^ {4}liveUrl\b/.test(l));
    if (liveLines.length > 1) throw new Error(`entry ${i} has ${liveLines.length} liveUrl lines`);
    if (liveLines.length === 1) {
      const m = liveLines[0].match(/^ {4}liveUrl: "([^"]*)",$/);
      if (!m) throw new Error(`entry ${i} liveUrl is not a plain string literal: ${liveLines[0]}`);
      if (m[1] !== "") live += 1;
    }
  }
  if (slugLines !== entries.length) throw new Error(`${entries.length} entries but ${slugLines} slug lines`);

  const projects = positiveInt(entries.length, "project count");
  positiveInt(live, "live count");
  if (live > projects) throw new Error(`live (${live}) exceeds projects (${projects})`);
  return { projects, live };
}

/** Fetches and parses; the one call build-assets.mjs makes. */
export async function loadSiteCounts() {
  return parseSiteCounts(await fetchProductsSource());
}

/** The banner's count clause, e.g. "15 projects · 9 live". */
export function countClause({ projects, live }) {
  return `${positiveInt(projects, "projects")} projects · ${positiveInt(live, "live")} live`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    console.log(JSON.stringify(await loadSiteCounts()));
  } catch (err) {
    console.error(`site-counts: ${err.message}`);
    // exitCode, not process.exit(): exiting with a fetch still tearing down
    // trips a libuv assertion on Windows and yields a non-1 exit status.
    process.exitCode = 1;
  }
}
