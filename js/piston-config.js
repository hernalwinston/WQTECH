// ============================================================
// PISTON CONFIGURATION (self-hosted code runner)
// ============================================================
// The Piston API is the PRIMARY code runner whenever PISTON_BASE
// points at a Piston instance YOU host. The public emkc.org API is
// whitelist-only since Feb 2026, so it is never called by default.
//
// Self-host Piston (Docker):
//   docker run --privileged -dit -p 2000:2000 --name piston_api \
//     ghcr.io/engineer-man/piston
//
// Browsers need two things from your instance:
//   1. CORS headers  -> add them via a reverse proxy (Caddy/nginx)
//   2. HTTPS         -> participant pages are https; a plain http
//      instance would be blocked as mixed content.
//
// Example Caddyfile (reverse proxy in front of the Piston container):
//   https://piston.your-domain.com {
//     reverse_proxy localhost:2000
//     header Access-Control-Allow-Origin *
//     header Access-Control-Allow-Methods "POST, GET, OPTIONS"
//     header Access-Control-Allow-Headers "Content-Type"
//   }
//
// Set PISTON_BASE to your instance's /api/v2 prefix:
//   window.PISTON_BASE = "https://piston.your-domain.com/api/v2";
//
// Leave it empty ("") to keep using the built-in
// Edge Function / Judge0 CE path (works out of the box).
window.PISTON_BASE = "";