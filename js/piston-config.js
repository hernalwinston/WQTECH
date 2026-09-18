// ============================================================
// RUNNER CONFIGURATION (client side)
// ============================================================
// The browser NEVER talks to a code execution provider directly.
// All runs go through the SECURE WQTech runner API deployed on
// Vercel:  {your-site}/api/programming-run  (api/programming-run.js)
//
// Provider configuration + keys live on that server as Vercel
// environment variables, never in the browser:
//
//   SUPABASE_URL        https://<project>.supabase.co   (JWT auth)
//   RUNNER_PROVIDER     auto | piston | judge0          (default auto)
//   PISTON_BASE_URL     https://piston.your-host.com/api/v2
//   JUDGE0_URL          http://your-host:2358/submissions
//   JUDGE0_API_KEY      your Judge0 CE admin key (kept server-side)
//
// Self-host Piston (Docker):
//   docker run --privileged -dit -p 2000:2000 --name piston_api \
//     ghcr.io/engineer-man/piston
// then set PISTON_BASE_URL "https://piston.your-domain.com/api/v2".
//
// RUNNER_API_URL resolution (auto):
//   1. window.WQTECH_RUNNER_URL in js/site-config.js, if set
//      (required when the front-end is on GitHub Pages and the API
//       is on a separate Vercel host).
//   2. Same-origin "/api/programming-run" when the pages are served
//      from Vercel (default, fine for *.vercel.app and custom
//      domains), or any host that also serves the API.
//   3. Empty + console warning for file:// and GitHub Pages when the
//      override is missing — Run Code then reports the configured
//      "backend not configured" error instead of a cryptic one.
(function () {
  var override = String(window.WQTECH_RUNNER_URL || "").trim().replace(/\/+$/, "");
  if (override) { window.RUNNER_API_URL = override; return; }

  var proto = (window.location.protocol || "").toLowerCase();
  var host = (window.location.hostname || "").toLowerCase();
  var isFile = proto === "file:";
  var isStaticHost = host === "github.io" || host.endsWith(".github.io")
    || host.endsWith(".pages.dev") || host.endsWith(".netlify.app");

  if (isFile) {
    window.RUNNER_API_URL = "";
    console.warn("WQTech: page opened from file:// so the runner API cannot be located automatically. Deploy to Vercel, or set window.WQTECH_RUNNER_URL in js/site-config.js.");
  } else if (isStaticHost) {
    window.RUNNER_API_URL = "";
    console.warn("WQTech: this page is served from GitHub Pages (or another static host). Set window.WQTECH_RUNNER_URL in js/site-config.js to your Vercel function URL, e.g. \"https://<your-project>.vercel.app/api/programming-run\", so Run Code can reach the API.");
  } else {
    window.RUNNER_API_URL = "/api/programming-run";
  }
})();