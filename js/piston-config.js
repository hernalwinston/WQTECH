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
//                       (self-hosted Piston = primary provider; takes
//                        stdout+stdin, NO cpu/memory limits, so the old
//                        out-of-range HTTP 400 cannot happen)
//   JUDGE0_URL          http://your-host:2358/submissions
//                       (self-hosted Judge0 CE; if unset the public
//                        CE fallback is used with quota-safe clamped
//                        limits)
//   JUDGE0_API_KEY      your Judge0 CE admin key (kept server-side)
//
// Self-host Piston (Docker):
//   docker run --privileged -dit -p 2000:2000 --name piston_api \
//     ghcr.io/engineer-man/piston
// then point PISTON_BASE_URL at its /api/v2 prefix, e.g.
//   PISTON_BASE_URL = "https://piston.your-domain.com/api/v2"
//
// Example Caddyfile (reverse proxy in front of the Piston container):
//   https://piston.your-domain.com {
//     reverse_proxy localhost:2000
//   }
//
// RUNNER_API_URL is where the browser sends run/check requests.
// Same-origin is the expected setup (site + API deployed together
// on Vercel). Set it to an absolute URL only when the front-end is
// served from somewhere else.
window.RUNNER_API_URL = '/api/programming-run';