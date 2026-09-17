// ============================================================
// TEST: api/programming-run.js (Vercel runner API)
// Runs the exported handler with fake req/res + stubbed provider
// fetch. Each scenario re-requires the module so env vars take
// effect (they are read at load time, like on Vercel).
//   npm run test:api
// ============================================================
const path = require('path');

const API = path.join(__dirname, '..', 'api', 'programming-run.js');

function loadApi(env) {
  const prev = {};
  Object.keys(process.env).forEach((k) => { if (k.startsWith('RUNNER_') || k.startsWith('JUDGE0_') || k.startsWith('PISTON_') || k === 'SUPABASE_URL' || k === 'SUPABASE_JWT_SECRET' || k === 'ALLOW_ORIGIN') { prev[k] = process.env[k]; delete process.env[k]; } });
  Object.keys(env).forEach((k) => { process.env[k] = env[k]; });
  delete require.cache[require.resolve(API)];
  const mod = require(API);
  Object.keys(prev).forEach((k) => { process.env[k] = prev[k]; });
  Object.keys(env).forEach((k) => { if (!(k in prev)) delete process.env[k]; });
  return mod;
}

function call(mod, { method = 'POST', url = '/api/programming-run', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const res = {
      setHeader() {},
      statusCode: 200,
      _body: '',
      end(s) { this._body = typeof s === 'string' ? s : JSON.stringify(s); resolve(this); },
    };
    const req = { method, url, headers, body: body !== undefined && body !== null ? body : undefined };
    mod(req, res).catch((e) => { res.statusCode = res.statusCode || 500; res._body = String(e && e.stack || e); resolve(res); });
  });
}

function stubFetch(fn) { global.fetch = fn; }

function judge0Response(overrides) {
  return Object.assign({
    stdout: '150\n', stderr: '', compile_output: '', time: 0.02,
    status: { id: 3, description: 'Accepted' },
  }, overrides || {});
}
function jsonRes(body, status) {
  return { ok: status == null || status < 400, status: status || 200, text: async () => JSON.stringify(body), json: async () => body };
}

const SUM_SRC = '#include <iostream>\nusing namespace std;\nint main(){int n;cin>>n;long long s=0;for(int i=0;i<n;i++){int x;cin>>x;s+=x;}cout<<s;}';

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? '  -> ' + extra : ''));
}

(async () => {
  console.log('programming-run API tests');

  // ---- OPTIONS preflight (CORS) ----
  const m0 = loadApi({ RUNNER_SKIP_AUTH: '1' });
  const o = await call(m0, { method: 'OPTIONS', url: '/api/programming-run' });
  check('OPTIONS returns 204', o.statusCode === 204, 'status=' + o.statusCode);

  // ---- GET /health ----
  const h = await call(m0, { method: 'GET', url: '/api/programming-run/health' });
  const hb = JSON.parse(h._body);
  check('health ok', h.statusCode === 200 && hb.ok === true, 'services=' + JSON.stringify(hb.providers));
  check('health lists all 10 languages', (hb.languages || []).length === 10, hb.languages && hb.languages.join(','));
  check('health exposes env summary (no secrets)', typeof hb.env === 'object' && hb.env.SUPABASE_URL === '(not set)' && hb.env.JUDGE0_API_KEY === '(not set)', JSON.stringify(hb.env));

  // ---- GET /health?ping=1 probes the provider ----
  stubFetch(async () => jsonRes({ stdout: '', status: { id: 3, description: 'Accepted' } }, 200));
  const hp = await call(m0, { method: 'GET', url: '/api/programming-run/health?ping=1' });
  const hpb = JSON.parse(hp._body);
  check('health ping probes provider', hpb.probe && hpb.probe.provider === 'judge0' && hpb.probe.ok === true && hpb.ok === true, JSON.stringify(hpb.probe));

  // ---- Non-POST request -> 405 with actionable message ----
  const n405 = await call(m0, { method: 'PUT', url: '/api/programming-run' });
  const n405b = JSON.parse(n405._body);
  check('non-POST returns 405 with cause hint', n405.statusCode === 405 && n405b.message.indexOf('requires POST') !== -1 && n405b.received_method === 'PUT', JSON.stringify(n405b));

  // ---- Auth required without JWT (no SUPABASE_URL configured) ----
  const m1 = loadApi({ RUNNER_SKIP_AUTH: '0' });
  const a1 = await call(m1, { body: { language: 'cpp', source: SUM_SRC, stdin: '' } });
  const a1b = JSON.parse(a1._body);
  check('401 when no token + no SUPABASE_URL', a1.statusCode === 401 && a1b.error && a1b.error.code === 'AUTH', a1b.error && a1b.error.detail);

  // ---- Invalid body / language guards ----
  const m2 = loadApi({ RUNNER_SKIP_AUTH: '1' });
  const badLang = await call(m2, { body: { language: 'cobol', source: SUM_SRC } });
  check('400 unsupported language', badLang.statusCode === 400, 'status=' + badLang.statusCode);
  const noSrc = await call(m2, { body: { language: 'cpp', source: '   ' } });
  check('400 empty source', noSrc.statusCode === 400, 'status=' + noSrc.statusCode);
  const bigSrc = await call(m2, { body: { language: 'cpp', source: 'x'.repeat(70000) } });
  check('400 oversized source', bigSrc.statusCode === 400, 'status=' + bigSrc.statusCode);

  // ---- Judge0 success (public CE fallback) ----
  let sentPayload = null, sentUrl = null;
  stubFetch(async (url, opts) => {
    sentUrl = url; sentPayload = JSON.parse(opts.body);
    return jsonRes(judge0Response(), 200);
  });
  const m3 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'judge0' });
  const ok3 = await call(m3, { body: { language: 'c++', source: SUM_SRC, stdin: '5\n10 20 30 40 50\n', timeout_ms: 3000 } });
  const ok3b = JSON.parse(ok3._body);
  check('judge0 run -> 200 ok:true', ok3.statusCode === 200 && ok3b.ok === true, 'stdout=' + JSON.stringify(ok3b.result && ok3b.result.stdout));
  check('judge0 canonical shape', ok3b.result && ok3b.result.provider === 'judge0' && ok3b.result.stdout === '150' && ok3b.result.status === '', JSON.stringify(ok3b.result));
  check('judge0 got CLAMPED cpu_time_limit (fix for HTTP 400)', sentPayload && sentPayload.cpu_time_limit === 3 && sentPayload.memory_limit === 128000, 'cpu=' + sentPayload.cpu_time_limit + ' mem=' + sentPayload.memory_limit);
  check('judge0 called public CE by default', sentUrl && sentUrl.indexOf('ce.judge0.com/submissions') !== -1, sentUrl);

  // ---- Judge0 status mapping ----
  stubFetch(async () => {
    sentPayload = null;
    return jsonRes(judge0Response({ stdout: '', status: { id: 6, description: 'Compilation Error' }, compile_output: 'main.cpp:1:1: error: nonsense' }), 200);
  });
  const m4 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'judge0' });
  const ce = await call(m4, { body: { language: 'cpp', source: 'bad', stdin: '' } });
  const ceb = JSON.parse(ce._body);
  check('judge0 sid6 -> compile_error', ceb.result && ceb.result.compile_error.indexOf('error: nonsense') !== -1, JSON.stringify(ceb.result && ceb.result.compile_error));

  stubFetch(async () => jsonRes(judge0Response({ stdout: '', time: null, status: { id: 5, description: 'Time Limit Exceeded' } }), 200));
  const m5 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'judge0' });
  const tle = await call(m5, { body: { language: 'python', source: 'while True: pass', stdin: '' } });
  check('judge0 sid5 -> status tle', JSON.parse(tle._body).result.status === 'tle', JSON.stringify(JSON.parse(tle._body).result));

  stubFetch(async () => jsonRes(judge0Response({ stdout: '', status: { id: 14, description: 'Memory Limit Exceeded' } }), 200));
  const m6 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'judge0' });
  const mle = await call(m6, { body: { language: 'go', source: 'package main\nfunc main(){}', stdin: '' } });
  check('judge0 sid14 -> status mle', JSON.parse(mle._body).result.status === 'mle', JSON.stringify(JSON.parse(mle._body).result));

  // ---- Piston success (self-hosted) ----
  let pistonUrl = '', pistonBody = null;
  stubFetch(async (url, opts) => {
    if (String(url).endsWith('/runtimes')) return jsonRes([
      { language: 'c++', version: '10.2.0', aliases: ['cpp'] },
      { language: 'c++', version: '12.0.0', aliases: ['cpp'] },
    ], 200);
    pistonUrl = String(url); pistonBody = JSON.parse(opts.body);
    return jsonRes({ lang: 'c++', version: '12.0.0', stdout: '150\n', stderr: '', code: 0, signal: null, time: 0.05, compile: { code: 0 } }, 200);
  });
  const m7 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'piston', PISTON_BASE_URL: 'https://piston.test/api/v2' });
  const pk = await call(m7, { body: { language: 'c++', source: SUM_SRC, stdin: '5\n10 20 30 40 50\n' } });
  const pkb = JSON.parse(pk._body);
  check('piston run -> 200 canonical', pk.statusCode === 200 && pkb.result.provider === 'piston' && pkb.result.stdout === '150', JSON.stringify(pkb.result));
  check('piston picked newest runtime version', pistonBody.version === '12.0.0', 'version=' + pistonBody.version);
  check('piston payload uses file + timeouts', pistonBody.files && pistonBody.files[0].name === 'main.cpp' && pistonBody.run_timeout > 0, pistonUrl);

  // ---- Provider fallback: both down -> 502, real provider error, NEVER a run ----
  stubFetch(async () => ({ ok: false, status: 503, text: async () => '{"error":"upstream down"}', json: async () => ({ error: 'upstream down' }) }));
  const m8 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'judge0' });
  const fail = await call(m8, { body: { language: 'python', source: 'print(1)', stdin: '' } });
  const failb = JSON.parse(fail._body);
  check('provider failure -> 502 (execution service error)', fail.statusCode === 502 && failb.ok === false && failb.error && failb.error.message.indexOf('Execution service error') === 0, fail.statusCode + ' ' + JSON.stringify(failb.error));

  // ---- Provider disabled (piston requested but not configured) -> providerError ----
  const m9 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'piston' });
  const none = await call(m9, { body: { language: 'cpp', source: SUM_SRC, stdin: '' } });
  const noneb = JSON.parse(none._body);
  check('provider disabled -> 502 (never faked success)', none.statusCode === 502 && noneb.error && Array.isArray(noneb.error.tried) && noneb.error.tried.length === 0, JSON.stringify(noneb.error));

  // ---- New languages resolve ----
  stubFetch(async () => jsonRes(judge0Response({ stdout: 'ok\n' }), 200));
  const m10 = loadApi({ RUNNER_SKIP_AUTH: '1', RUNNER_PROVIDER: 'judge0' });
  for (const lang of ['javascript', 'typescript', 'go', 'rust', 'ruby', 'node', 'golang']) {
    const r = await call(m10, { body: { language: lang, source: 'print(1)', stdin: '' } });
    const ok = r.statusCode === 200;
    check('language accepted: ' + lang, ok, 'status=' + r.statusCode);
    if (!ok) break;
  }

  const passed = results.filter((r) => r.ok).length;
  console.log('\nFINAL: ' + passed + '/' + results.length + ' API tests passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });