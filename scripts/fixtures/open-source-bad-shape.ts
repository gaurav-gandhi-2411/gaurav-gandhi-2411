// Test fixture ONLY. A deliberately malformed stand-in for gg-portfolio's
// content/open-source.ts, used via the `open_source_url_override`
// workflow_dispatch input (see .github/workflows/stats.yml) to prove
// build-readme-cards.mjs's R3 fail-closed path: this entry is missing
// `sourceRef`, which parseLandedEntry requires first, so the generator
// should throw "missing/unparseable \"sourceRef\" ... file shape changed"
// and exit non-zero — never silently render a card from it.
//
// Not imported, executed, or otherwise referenced by any script in this
// repo; it exists only to be fetched by URL during a manual test run.
export const openSourceLanded = [
  {
    repo: "google/adk-python",
    prNumber: 6681,
    commitSha: "023f45c3e5846c3e72525b53f16ef018b5ecdaa6",
  },
];

export const openSourceInReview = [
];
