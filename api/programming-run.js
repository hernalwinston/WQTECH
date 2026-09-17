// ============================================================
// PROGRAMMING RUNNER - WQTech Backend API (Vercel Function)
// ============================================================
// Deployed at:  /api/programming-run
//
// This is WQTech's SECURE execution API. It does NOT compile/run
// code itself (Supabase is the database, NOT a compiler). It is a
// thin adapter that:
//     1. authenticates the caller (Supabase JWT, RS256 JWKS)
//     2. maps app language -> provider language/version
//     3. builds the provider-specific request (Piston OR Judge0)
//     4. normalizes the provider response into ONE result shape
//     5. classifies failures as Execution Service Errors (never as
//        the student's Wrong Answer / Compilation Error)
//
// PROVIDER CONFIG + KEYS live HERE as Vercel environment variables,
// never in the browser. Set them in Vercel -> Settings -> Env Vars:
//
//   SUPABASE_URL          https://<project>.supabase.co (for JWT auth)
//   RUNNER_SKIP_AUTH      1 = allow calls without a JWT (dev only)
//   RUNNER_PROVIDER       auto | piston | judge0     (default auto)
//   PISTON_BASE_URL       https://piston.your-host.com/api/v2
//                         (self-hosted Piston; primary in auto mode)
//   JUDGE0_URL            http://your-host:2358/submissions
//                         (self-hosted Judge0 CE; else the public
//                          ce.judge0.com fallback is used)
//   JUDGE0_API_KEY        your Judge0 CE admin key (X-Api-Key)
//   RUNNER_MAX_CPU_SECONDS 1..10 (default 3)  -- safe CE range (the
//                         out-of-range value that caused the old HTTP 400)
//   RUNNER_MEMORY_LIMIT_KB 25600..512000 (default 128000)
//   RUNNER_COMPILE_TIMEOUT_MS      (default 10000)
//   RUNNER_RUN_TIMEOUT_MS         (default 10000)
//   RUNNER_HARD_TIMEOUT_MS        (default 25000, server-side cap)
//   RUNNER_MAX_OUTPUT_BYTES       (default 200000)
//   SUPABASE_JWT_SECRET   optional legacy HS256 fallback key
//
// Depends on: jose (declared in package.json) for JWT verification.
// Requires Node 18+ (global fetch). Runtime set in vercel.json.
// ============================================================

const { createRemoteJWKSet, jwtVerify } = require("jose");

const env = (k, d) => process.env[k] !== undefined ? process.env[k] : d;
const SUPABASE_URL = (env("SUPABASE_URL", "") || "").replace(/\/+$/, "");
const SKIP_AUTH = env("RUNNER_SKIP_AUTH", "0") === "1";
const SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", "") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": env("ALLOW_ORIGIN", "*"),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function cors(res, extra) {
  Object.keys(corsHeaders).forEach((k) => res.setHeader(k, corsHeaders[k]));
  if (extra) Object.keys(extra).forEach((k) => res.setHeader(k, extra[k]));
}

function json(res, body, status) {
  cors(res, { "Content-Type": "application/json" });
  res.statusCode = status || 200;
  res.end(JSON.stringify(body));
}

// ------------------------------------------------------------------
// AUTH - every execution requires a valid Supabase session token so
// provider quota/keys are only usable by signed-in users.
// ------------------------------------------------------------------
let jwks = null;
async function verifyJwt(authorization) {
  if (SKIP_AUTH) return { ok: true };
  const token = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "missing bearer token" };
  if (!SUPABASE_URL && !SUPABASE_JWT_SECRET)
    return { ok: false, reason: "SUPABASE_URL (or SUPABASE_JWT_SECRET) unset" };
  try {
    if (SUPABASE_URL) {
      if (!jwks) {
        jwks = createRemoteJWKSet(new URL(SUPABASE_URL + "/auth/v1/.well-known/jwks.json"));
      }
      try {
        const { payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"] });
        if (!payload || !payload.sub) return { ok: false, reason: "token has no subject" };
        return { ok: true, sub: String(payload.sub), role: String(payload.role || "authenticated") };
      } catch (rsErr) {
        if (!SUPABASE_JWT_SECRET) throw rsErr;
        // Fall back to legacy HS256 verification for older auth setup.
        const { importJWK } = require("jose");
        const key = await importJWK({ kty: "oct", k: Buffer.from(SUPABASE_JWT_SECRET).toString("base64url") }, "HS256");
        const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
        if (!payload || !payload.sub) return { ok: false, reason: "token has no subject" };
        return { ok: true, sub: String(payload.sub), role: String(payload.role || "authenticated"), legacy: true };
      }
    }
    // HS256-only mode (no SUPABASE_URL)
    const { importJWK } = require("jose");
    const key = await importJWK({ kty: "oct", k: Buffer.from(SUPABASE_JWT_SECRET).toString("base64url") }, "HS256");
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (!payload || !payload.sub) return { ok: false, reason: "token has no subject" };
    return { ok: true, sub: String(payload.sub), role: String(payload.role || "authenticated"), legacy: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------
// LANGUAGE REGISTRY - the ONE place mapping app languages to every
// provider. Adding a language = adding a row here + a client entry.
// judge0 = Judge0 CE language_id; piston = Piston "language" field.
// ------------------------------------------------------------------
const LANGS = {
  c:         { label: "C",         judge0: 50, piston: "c",         file: "main.c",    version: "10.2.0" },
  cpp:       { label: "C++",       judge0: 54, piston: "c++",       file: "main.cpp",  version: "10.2.0" },
  csharp:    { label: "C#",        judge0: 51, piston: "csharp",    file: "main.cs",   version: "6.12.0" },
  java:      { label: "Java",      judge0: 62, piston: "java",      file: "Main.java", version: "17.0.9" },
  python:    { label: "Python",    judge0: 71, piston: "python",    file: "main.py",   version: "3.10.0" },
  javascript:{ label: "JavaScript", judge0: 63, piston: "javascript", file: "main.js",  version: "18.15.0" },
  typescript:{ label: "TypeScript",judge0: 74, piston: "typescript", file: "main.ts",  version: "5.0.3" },
  go:        { label: "Go",        judge0: 60, piston: "go",        file: "main.go",   version: "1.21.1" },
  rust:      { label: "Rust",      judge0: 73, piston: "rust",      file: "main.rs",   version: "1.68.2" },
  ruby:      { label: "Ruby",      judge0: 72, piston: "ruby",      file: "main.rb",   version: "3.0.1" },
};

function resolveLang(language) {
  const l = String(language || "").toLowerCase();
  if (LANGS[l]) return { key: l, cfg: LANGS[l] };
  if (l === "c++" || l === "cplusplus" || l === "cpp") return { key: "cpp", cfg: LANGS.cpp };
  if (l === "cs" || l === "c#") return { key: "csharp", cfg: LANGS.csharp };
  if (l === "python3" || l === "py") return { key: "python", cfg: LANGS.python };
  if (l === "js" || l === "node" || l === "nodejs") return { key: "javascript", cfg: LANGS.javascript };
  if (l === "ts") return { key: "typescript", cfg: LANGS.typescript };
  if (l === "golang") return { key: "go", cfg: LANGS.go };
  return null;
}

// ------------------------------------------------------------------
// CONFIG (server-side only - never exposed to the browser)
// ------------------------------------------------------------------
const PROVIDER = (env("RUNNER_PROVIDER", "auto") || "auto").toLowerCase();
const PISTON_BASE_URL = (env("PISTON_BASE_URL", "") || "").replace(/\/+$/, "");
const RUNNER_URL = ((env("JUDGE0_URL", "") || env("RUNNER_URL", "") || "").replace(/\/+$/, "")) || "https://ce.judge0.com/submissions";
const RUNNER_API_KEY = env("JUDGE0_API_KEY", "") || env("RUNNER_API_KEY", "") || "";
const RUNNER_MAX_CPU_SECONDS = Math.min(Math.max(parseInt(env("RUNNER_MAX_CPU_SECONDS", "3"), 10) || 3, 1), 10);
const RUNNER_MEMORY_LIMIT_KB = Math.min(Math.max(parseInt(env("RUNNER_MEMORY_LIMIT_KB", "128000"), 10) || 128000, 25600), 512000);
const RUNNER_COMPILE_TIMEOUT_MS = Math.max(parseInt(env("RUNNER_COMPILE_TIMEOUT_MS", "10000"), 10) || 10000, 1000);
const RUNNER_RUN_TIMEOUT_MS = Math.max(parseInt(env("RUNNER_RUN_TIMEOUT_MS", "10000"), 10) || 10000, 500);
const RUNNER_HARD_TIMEOUT_MS = Math.max(parseInt(env("RUNNER_HARD_TIMEOUT_MS", "25000"), 10) || 25000, 5000);
const RUNNER_MAX_OUTPUT_BYTES = Math.max(parseInt(env("RUNNER_MAX_OUTPUT_BYTES", "200000"), 10) || 200000, 1000);

const trimEnd = (s) => String(s == null ? "" : s).replace(/\s+$/g, "");
const truncate = (s, n) => {
  const str = String(s == null ? "" : s);
  return str.length > n ? str.slice(0, n) + "\n... [output truncated]" : str;
};

// ------------------------------------------------------------------
// CANONICAL RESULT SHAPE (what every page receives)
//   { stdout, stderr, compile_error, compile_output, runtime_error,
//     status: '' | 'tle' | 'mle', time_ms, provider, language, version }
// ------------------------------------------------------------------
function resultOf(p, lang, version, src) {
  return Object.assign({
    stdout: "", stderr: "", compile_error: "", compile_output: "",
    runtime_error: "", status: "", time_ms: undefined,
    provider: p, language: lang, version: version || null,
  }, src || {});
}

let pistonRuntimes = null, pistonRuntimesAt = 0;
async function pistonVersion(lang, fallback) {
  if (PISTON_BASE_URL && (!pistonRuntimes || Date.now() - pistonRuntimesAt > 3600000)) {
    try {
      const r = await fetch(PISTON_BASE_URL + "/runtimes");
      if (r.ok) pistonRuntimes = await r.json();
    } catch (e) { /* keep cache / fallback */ }
    pistonRuntimesAt = Date.now();
  }
  const versions = (pistonRuntimes || [])
    .filter((x) => x && x.language === lang)
    .map((x) => String(x.version || ""));
  if (versions.length) {
    return versions.slice().sort((a, b) => {
      const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
      const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const va = pa[i] || 0, vb = pb[i] || 0;
        if (va !== vb) return vb - va;
      }
      return 0;
    })[0];
  }
  return fallback;
}

// ------------------------------------------------------------------
// PROVIDER: PISTON (self-hosted) - compile_timeout/run_timeout in MS.
// Takes stdout + stdin, no cpu/memory limit params (so the old
// out-of-range HTTP 400 cannot happen).
// ------------------------------------------------------------------
async function runPiston({ lang, source, stdin, runTimeoutMs, version }) {
  const started = Date.now();
  const endpoint = PISTON_BASE_URL + "/execute";
  const body = {
    language: lang,
    version,
    files: [{ name: LANGS[lang].file, content: source }],
    stdin: stdin || "",
    args: [],
    compile_timeout: RUNNER_COMPILE_TIMEOUT_MS,
    run_timeout: Math.min(Math.max(runTimeoutMs, 200), RUNNER_RUN_TIMEOUT_MS),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_HARD_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { error: { status: res.status, body: text.slice(0, 1000) }, response: text.slice(0, 2000) };
  }
  let d;
  try { d = JSON.parse(text); } catch (e) { d = {}; }

  const run = d.run || {};
  const compile = d.compile || {};
  const compileFailed = compile && typeof compile.code === "number" && compile.code !== 0;
  const compileErr = compileFailed ? (compile.stderr || compile.output || "Compilation Error") : "";
  const stdout = truncate(trimEnd(d.stdout != null ? d.stdout : (run.stdout || "")), RUNNER_MAX_OUTPUT_BYTES);
  const stderr = trimEnd(d.stderr != null ? d.stderr : (run.stderr || "")).slice(0, 8000);
  const sig = String(run.signal || "");
  const code = typeof run.code === "number" ? run.code : null;
  const timedOut = sig === "SIGKILL" || code === 124 || code === 137 || /killed|timed out/i.test(String(run.stderr || ""));
  const timeMs = typeof d.time === "number" ? Math.round(d.time) : (Date.now() - started);
  return {
    result: resultOf("piston", LANGS[lang].label, version, {
      stdout,
      stderr,
      compile_error: compileErr,
      compile_output: compile && !compileFailed ? trimEnd(compile.output || compile.stdout || "") : "",
      runtime_error: (!compileFailed && !timedOut && code != null && code !== 0)
        ? (stderr || "Program exited with code " + code) : "",
      status: timedOut ? "tle" : "",
      time_ms: timeMs,
    }),
  };
}

// ------------------------------------------------------------------
// PROVIDER: JUDGE0 CE - language_id + cpu_time_limit + memory_limit.
// cpu/memory are clamped to the safe CE range (this is the fix for
// the out-of-range HTTP 400).
// ------------------------------------------------------------------
async function runJudge0({ lang, source, stdin, runTimeoutMs, timeoutMs }) {
  const baseLangId = LANGS[lang].judge0;
  const cpuSeconds = Math.min(Math.max(Math.ceil(timeoutMs / 1000), 1), RUNNER_MAX_CPU_SECONDS);
  const endpoint = RUNNER_URL + "?base64_encoded=false&wait=true";
  const payload = {
    source_code: source,
    language_id: baseLangId,
    stdin: stdin || "",
    cpu_time_limit: cpuSeconds,
    memory_limit: RUNNER_MEMORY_LIMIT_KB,
    wall_time_limit: Math.min(cpuSeconds * 2, 10),
  };
  const headers = { "Content-Type": "application/json" };
  if (RUNNER_API_KEY) headers["X-Api-Key"] = RUNNER_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_HARD_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { error: { status: res.status, body: text.slice(0, 1000) }, response: text.slice(0, 2000) };
  }
  let d;
  try { d = JSON.parse(text); } catch (e) { d = {}; }

  const sid = parseInt(d.status && d.status.id, 10);
  const stdout = truncate(trimEnd(d.stdout || ""), RUNNER_MAX_OUTPUT_BYTES);
  const stderr = trimEnd(d.stderr || "").slice(0, 8000);
  const timeMs = d.time != null ? Math.round(parseFloat(d.time) * 1000) : undefined;
  const desc = String((d.status && d.status.description) || "");
  let status = "", compileError = "", runtimeError = "";
  if (sid === 6) compileError = truncate(trimEnd(d.compile_output || ""), RUNNER_MAX_OUTPUT_BYTES);
  else if (sid === 5) status = "tle";
  else if (sid === 14) status = "mle";
  else if (sid >= 7 && sid <= 17) runtimeError = stderr || ("Runtime Error (" + desc + ")");
  return {
    result: resultOf("judge0", LANGS[lang].label, null, {
      stdout,
      stderr,
      compile_error: compileError,
      compile_output: "",
      runtime_error: runtimeError,
      status,
      time_ms: timeMs,
    }),
  };
}

// ------------------------------------------------------------------
// Provider selection / fallback so one unavailable provider never
// takes the API down (execution failures are SERVICE errors).
// ------------------------------------------------------------------
async function runCode(args) {
  const tried = [];
  const attempts = [];
  const wanted = PROVIDER === "piston" ? ["piston"] : PROVIDER === "judge0" ? ["judge0"] : ["piston", "judge0"];

  for (const name of wanted) {
    if (name === "piston" && !PISTON_BASE_URL) continue;
    if (name === "judge0" && !RUNNER_URL) continue;
    tried.push(name);
    try {
      if (name === "piston") {
        const pistonLang = LANGS[args.lang].piston;
        const version = await pistonVersion(pistonLang, LANGS[args.lang].version);
        const out = await runPiston({ lang: args.lang, source: args.source, stdin: args.stdin, runTimeoutMs: args.timeoutMs, version });
        if (out.error) { attempts.push({ provider: name, status: out.error.status, body: out.error.body }); continue; }
        return { result: out.result, tried };
      }
      const out = await runJudge0({ lang: args.lang, source: args.source, stdin: args.stdin, runTimeoutMs: args.timeoutMs, timeoutMs: args.timeoutMs });
      if (out.error) { attempts.push({ provider: name, status: out.error.status, body: out.error.body }); continue; }
      return { result: out.result, tried };
    } catch (e) {
      const aborted = (e && e.name === "AbortError");
      attempts.push({ provider: name, status: aborted ? "timeout" : "exception", body: aborted ? "execution service timed out" : (e instanceof Error ? e.message : String(e)) });
    }
  }

  const last = attempts[attempts.length - 1] || { provider: (tried[0] || "none"), status: 0, body: "" };
  const statusText = (typeof last.status === "number" && last.status) ? "HTTP " + last.status : String(last.status || "unreachable");
  return {
    providerError: {
      message: "Execution service error (" + statusText + ")",
      code: statusText,
      detail: String(last.body || "").slice(0, 500),
      provider: last.provider,
      language: LANGS[args.lang].label,
      tried,
      attempts,
    },
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return null;
  }
}

function trimTrailing(headers) {
  return headers || {};
}

module.exports = async function programmingRun(req, res) {
  // OPTIONS preflight
  if (req.method === "OPTIONS") {
    cors(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || "", "http://internal");

  // Health check
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return json(res, {
      ok: true,
      service: "programming-run",
      providers: {
        piston: { enabled: !!PISTON_BASE_URL, url: PISTON_BASE_URL || null },
        judge0: { enabled: !!RUNNER_URL, url: RUNNER_URL, public: RUNNER_URL.indexOf("ce.judge0.com") !== -1 },
      },
      languages: Object.keys(LANGS),
      auth_required: !SKIP_AUTH,
      max_cpu_seconds: RUNNER_MAX_CPU_SECONDS,
      memory_limit_kb: RUNNER_MEMORY_LIMIT_KB,
    });
  }

  if (req.method !== "POST") return json(res, { message: "Method not allowed" }, 405);

  const auth = await verifyJwt(trimTrailing(req.headers).authorization || req.headers.authorization);
  if (!auth.ok) {
    console.error("programming-run auth rejected:", auth.reason);
    return json(res, { ok: false, error: { message: "Authentication required", code: "AUTH", detail: auth.reason } }, 401);
  }

  let body;
  try { body = await readBody(req); } catch (e) { body = null; }
  if (!body || typeof body !== "object") {
    return json(res, { ok: false, error: { message: "Invalid JSON body", code: "BAD_REQUEST" } }, 400);
  }
  const { language, source, stdin, timeout_ms } = body;
  const resolved = resolveLang(language);
  if (!resolved) {
    return json(res, { ok: false, error: { message: "Unsupported language: " + String(language), code: "BAD_REQUEST", language: String(language) } }, 400);
  }
  if (typeof source !== "string" || !source.trim()) {
    return json(res, { ok: false, error: { message: "source is required", code: "BAD_REQUEST", language: resolved.cfg.label } }, 400);
  }
  if (source.length > 65536) {
    return json(res, { ok: false, error: { message: "Source code is too large", code: "BAD_REQUEST", language: resolved.cfg.label } }, 400);
  }
  const safeStdin = String(stdin == null ? "" : stdin);
  if (safeStdin.length > 16384) {
    return json(res, { ok: false, error: { message: "Program input is too large", code: "BAD_REQUEST", language: resolved.cfg.label } }, 400);
  }
  const timeoutMs = Math.max(200, Math.min(Math.round(parseInt(timeout_ms, 10) || 4000), RUNNER_RUN_TIMEOUT_MS));

  const out = await runCode({ lang: resolved.key, source, stdin: safeStdin, timeoutMs });

  if (out.providerError) {
    console.error("programming-run provider failure", JSON.stringify({
      provider_error: out.providerError,
      language: resolved.cfg.label,
      language_key: resolved.key,
      source_length: source.length,
      stdin: safeStdin.slice(0, 500),
      timeout_ms: timeoutMs,
      user: auth.sub || null,
    }, null, 2));
    return json(res, { ok: false, error: out.providerError }, 502);
  }

  console.log("programming-run ok", JSON.stringify({
    provider: out.result.provider,
    language: out.result.language,
    status: out.result.status || "ok",
    compile_error: !!out.result.compile_error,
    runtime_error: !!out.result.runtime_error,
    stdout_bytes: out.result.stdout.length,
    time_ms: out.result.time_ms,
    user: auth.sub || null,
    tried: out.tried,
  }));
  return json(res, { ok: true, result: out.result }, 200);
};