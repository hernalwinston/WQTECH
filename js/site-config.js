// ============================================================
// WQTECH SITE CONFIG — edit this ONE file for your deployment
// ============================================================
// The front-end is a static site. The code runner is a Vercel
// serverless function (api/programming-run.js) — the browser never
// talks to a code executor directly.
//
// AUTO BEHAVIOUR (no setup needed):
//   * Site AND api deployed together on Vercel  -> the relative URL
//     "/api/programming-run" is used automatically.
//   * Site deployed on GitHub Pages (github.io) -> the API is on a
//     DIFFERENT host (Vercel), so set window.WQTECH_RUNNER_URL below
//     to the absolute URL of your deployed Vercel function.
//
// Set it (example) to:
//   window.WQTECH_RUNNER_URL = "https://wqtech-programming.vercel.app/api/programming-run";
window.WQTECH_RUNNER_URL = "";