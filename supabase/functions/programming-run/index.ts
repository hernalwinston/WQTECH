// ============================================================
// PROGRAMMING RUNNER - Supabase Edge Function
// ============================================================
// Relays student code into a containerized judge (Judge0 CE by
// default) so untrusted code NEVER runs in your own runtime.
//
// Deploy with the Supabase CLI (from the project root):
//   npx supabase functions deploy programming-run --project-ref rknsbfykyulrejnbwjuf
//
// Optional env var RUNNER_URL: point it at your OWN Judge0 CE
// instance (e.g. http://your-host:2358/submissions) once you
// self-host one, and the app never touches public runners.
//
// The browser client tries this function first and automatically
// falls back to the public Judge0 CE sandbox if it is not
// reachable, so Run/Check code works even before you deploy.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RUNNER = Deno.env.get("RUNNER_URL") ||
  "https://ce.judge0.com/submissions";

// Judge0 CE quota-safe execution limits. The public runner (and most
// self-hosted instances) reject out-of-range cpu/memory limits with an
// HTTP 400, so clamp to values every CE instance accepts. Override these
// with RUNNER_MAX_CPU_SECONDS / RUNNER_MEMORY_LIMIT_KB once you self-host.
const RUNNER_MAX_CPU_SECONDS = Math.min(Math.max(
  parseInt(Deno.env.get("RUNNER_MAX_CPU_SECONDS") || "3", 10) || 3, 1), 10);
const RUNNER_MEMORY_LIMIT_KB = parseInt(
  Deno.env.get("RUNNER_MEMORY_LIMIT_KB") || "128000", 10) || 128000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// App language label -> Judge0 CE language_id (stable CE language set).
// Returns null for languages this runner does not support.
function judge0LangId(language) {
  const l = String(language || "").toLowerCase();
  if (l === "c") return 50;
  if (l === "c++" || l === "cplusplus" || l === "cpp") return 54;
  if (l === "c#" || l === "csharp" || l === "cs") return 51;
  if (l === "java") return 62;
  if (l === "python" || l === "python3") return 71;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ message: "Invalid JSON body" }, 400); }
  const { language, source, stdin, timeout_ms } = body || {};
  if (!language || typeof source !== "string" || !source.trim()) {
    return json({ message: "language and source are required" }, 400);
  }
  const langId = judge0LangId(language);
  if (!langId) {
    return json({ message: "Unsupported language: " + String(language) }, 400);
  }

  const t = Math.max(1, Math.min(Math.round((parseInt(timeout_ms, 10) || 4000) / 1000), RUNNER_MAX_CPU_SECONDS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), t * 1000 + 5000);
  try {
    const res = await fetch(RUNNER + "?base64_encoded=false&wait=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_code: source,
        language_id: langId,
        stdin: stdin || "",
        cpu_time_limit: t,
        memory_limit: RUNNER_MEMORY_LIMIT_KB,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("programming-run upstream HTTP " + res.status + ": " + txt.slice(0, 500));
      return json({
        message: "Execution service error (HTTP " + res.status + ")",
        status: res.status,
        detail: txt.slice(0, 500)
      }, 502);
    }
    const run = await res.json();
    return json(run, 200);
  } catch (e) {
    clearTimeout(timer);
    return json({ message: "Runner unavailable: " + (e instanceof Error ? e.message : String(e)) }, 502);
  }
});