// ============================================================
// TEST: client grading pipeline (js/programming-shared.js)
// Loads the REAL module with a stubbed backend (window.RUNNER_API_URL
// + global.fetch) and a stubbed Supabase client, then exercises the
// full run / check / grade flow end to end.
//   npm run test:grading
// ============================================================
const fs = require('fs');
const path = require('path');
const SHARED = path.join(__dirname, '..', 'js', 'programming-shared.js');
process.on('unhandledRejection', (e) => { console.error('UNHANDLED REJECTION:', e); process.exit(2); });

const GOOD = {
  '5\n10 20 30 40 50\n': '150', '4\n5 10 15 20\n': '50',
  '3\n7 8 9\n': '24', '6\n1 2 3 4 5 6\n': '21',
  '5\n-5 10 -3 8 2\n': '12', '1\n0\n': '0'
};
let CURRENT_GOOD = GOOD;
const tcTable = { 'prob-1': [] };

global.window = {};
global.Auth = { currentUser: { id: 'stu-1', user_metadata: { name: 'Test Student' } } };
global.SUPABASE_URL = 'https://rknsbfykyulrejnbwjuf.supabase.co';
global.localStorage = { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; } };

function qBuilder(tbl) {
  const exec = () => ({ data: (tbl === 'programming_test_cases') ? (tcTable['prob-1'] || []) : [], error: null });
  const resolveThen = (res, rej, e) => { try { const v = e(); if (v && typeof v.then === 'function') v.then(res, rej); else res(v); } catch (err) { rej(err); } };
  const query = {
    select() { return this; },
    eq(col, v) { if (col === 'problem_id') this._filter = v; return this; },
    order() { return this; },
    then: (res, rej) => resolveThen(res, rej, exec),
    single: (res, rej) => resolveThen(res, rej, exec),
    maybeSingle: (res, rej) => resolveThen(res, rej, exec),
    insert() { return { select: () => ({ single: async () => ({ data: null, error: null }) }) }; },
    upsert() { return { select: () => ({ single: async () => ({ data: null, error: null }) }) }; },
    update() { return { eq: () => ({ then: (res) => res({ data: null, error: null }) }) }; }
  };
  return query;
}
global.supabaseClient = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'fake-jwt' } } }) },
  from: (tbl) => qBuilder(tbl)
};

async function defaultFetch(url, opts) {
  if (String(url).includes('/api/programming-run/health')) {
    return { ok: true, json: async () => ({ ok: true, service: 'programming-run', languages: ['cpp', 'go'], active_provider: 'judge0' }) };
  }
  if (String(url).includes('/api/programming-run')) {
    const body = JSON.parse(opts.body);
    const stdin = String(body.stdin || '');
    const src = String(body.source || '');
    let result;
    if (src.indexOf('SYNTAX_BROKEN') !== -1) result = { stdout: '', stderr: '', compile_error: 'main.cpp:3:1: error: expected \';\'', compile_output: '', runtime_error: '', status: '', time_ms: 40, provider: 'judge0', language: 'C++', version: null };
    else if (src.indexOf('INFINITE_LOOP') !== -1) result = { stdout: '', stderr: '', compile_error: '', compile_output: '', runtime_error: '', status: 'tle', time_ms: null, provider: 'judge0', language: 'C++', version: null };
    else if (src.indexOf('CRASH_PROGRAM') !== -1) result = { stdout: '', stderr: 'Segmentation fault', compile_error: '', compile_output: '', runtime_error: 'Runtime Error (SIGSEGV)', status: '', time_ms: 12, provider: 'judge0', language: 'C++', version: null };
    else if (src.indexOf('fmt.Println("80")') !== -1) result = { stdout: '80\n', stderr: '', compile_error: '', compile_output: '', runtime_error: '', status: '', time_ms: 10, provider: 'judge0', language: 'Go', version: null };
    else if (src.indexOf('OUTPUTS_ZERO') !== -1) result = { stdout: '0\n', stderr: '', compile_error: '', compile_output: '', runtime_error: '', status: '', time_ms: 10, provider: 'judge0', language: 'C++', version: null };
    else {
      const out = CURRENT_GOOD[stdin];
      result = { stdout: out != null ? out + '\n' : '0\n', stderr: '', compile_error: '', compile_output: '', runtime_error: '', status: '', time_ms: 10, provider: 'judge0', language: 'C++', version: null };
    }
    return { ok: true, json: async () => ({ ok: true, result }) };
  }
  throw new Error('unexpected fetch ' + url);
}
global.fetch = defaultFetch;

// Browser points at the WQTech runner API (Vercel).
global.window.RUNNER_API_URL = '/api/programming-run';

eval(fs.readFileSync(SHARED, 'utf8'));
const P = global.window.Programming;

const PROBLEM = { id: 'prob-1', title: 'Sum of N Integers', points: 20 };
const CASES = [
  { id: 'tc-1', label: 'Sample 1', input: '5\n10 20 30 40 50\n', expected_output: '150\n', is_sample: true },
  { id: 'tc-2', label: 'Sample 2', input: '4\n5 10 15 20\n',     expected_output: '50\n',  is_sample: true },
  { id: 'tc-3', label: 'Sample 3', input: '3\n7 8 9\n',          expected_output: '24\n',  is_sample: true },
  { id: 'tc-4', label: 'Sample 4', input: '6\n1 2 3 4 5 6\n',    expected_output: '21\n',  is_sample: true },
  { id: 'tc-5', label: 'Hidden 1', input: '5\n-5 10 -3 8 2\n',   expected_output: '12\n',  is_sample: false },
  { id: 'tc-6', label: 'Hidden 2', input: '1\n0\n',              expected_output: '0\n',   is_sample: false }
];
tcTable['prob-1'] = CASES;

const results = [];
function check(name, ok, extra) { results.push({ name, ok }); console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? '  -> ' + extra : '')); }
async function t(name, fn) { try { return await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + name)), 3000))]); } catch (e) { check(name + ' threw', false, e.message); process.exit(1); } }

(async () => {
  console.log('client grading pipeline tests');

  const A = P.allocatePoints;
  check('allocate 20/6 -> [4,4,3,3,3,3]', JSON.stringify(A(20, 6)) === JSON.stringify([4, 4, 3, 3, 3, 3]), JSON.stringify(A(20, 6)));
  check('allocate 20/4 -> all 5', JSON.stringify(A(20, 4)) === JSON.stringify([5, 5, 5, 5]), JSON.stringify(A(20, 4)));
  check('allocate 15/4 -> [4,4,4,3]', JSON.stringify(A(15, 4)) === JSON.stringify([4, 4, 4, 3]), JSON.stringify(A(15, 4)));
  check('allocate 20/6 sums to 20', A(20, 6).reduce((a, b) => a + b, 0) === 20, A(20, 6).reduce((a, b) => a + b, 0));

  const okSrc = '#include <iostream>\nusing namespace std;\nint main(){int n;int sum=0;cin>>n;for(int i=0;i<n;i++){int x;cin>>x;sum+=x;}cout<<sum;}';

  const rA = await t('Test A', () => P.checkCode({ activityId: 'act-1', problem: PROBLEM, source: okSrc, language: 'c++' }));
  check('valid solution -> accepted 20/20', rA.status === 'accepted' && rA.score === 20 && rA.max_score === 20, rA.status + ' ' + rA.score + '/' + rA.max_score);
  check('valid solution -> all 6 passed, points divided [4,4,3,3,3,3]', rA.test_results.length === 6 && rA.test_results.filter(x => x.passed).length === 6 && JSON.stringify(rA.test_results.map(x => x.points)) === JSON.stringify([4, 4, 3, 3, 3, 3]), JSON.stringify(rA.test_results.map(x => x.points)));
  check('valid solution -> sample + hidden counts', rA.sample_passed === 4 && rA.sample_total === 4 && rA.hidden_passed === 2 && rA.hidden_total === 2, rA.sample_passed + '/' + rA.sample_total + ' ' + rA.hidden_passed + '/' + rA.hidden_total);

  const altSrc = '#include <iostream>\nusing namespace std;\nint main(){int n;cin>>n;int s=0;while(n--){int x;cin>>x;s+=x;}cout<<s;}';
  const rB = await t('Test B', () => P.checkCode({ activityId: 'act-1', problem: PROBLEM, source: altSrc, language: 'c++' }));
  check('different correct algorithm -> accepted 20/20', rB.status === 'accepted' && rB.score === 20, rB.status + ' ' + rB.score);

  const rC = await t('Test C', () => P.checkCode({ activityId: 'act-1', problem: PROBLEM, source: '//OUTPUTS_ZERO\nint main(){cout << 0;}', language: 'c++' }));
  check('wrong program -> wrong_answer, only 1 hidden passes (3 pts)', rC.status === 'wrong_answer' && rC.score === 3, rC.status + ' ' + rC.score);

  const rE = await t('Test E', () => P.checkCode({ activityId: 'act-1', problem: PROBLEM, source: 'SYNTAX_BROKEN int main(){', language: 'c++' }));
  check('compile error -> compilation_error status, 0 pts', rE.status === 'compilation_error' && rE.score === 0 && rE.test_results[0].message === 'Compilation Error', rE.status);

  const rF = await t('Test F', () => P.checkCode({ activityId: 'act-1', problem: PROBLEM, source: 'INFINITE_LOOP while(1){}', language: 'c++' }));
  check('infinite loop -> time_limit_exceeded', rF.status === 'time_limit_exceeded', rF.status);

  const realFetch = global.fetch;
  global.fetch = async (url) => { if (String(url).includes('/api/programming-run')) return { ok: false, status: 502, json: async () => ({ ok: false, error: { message: 'Execution service error (HTTP 502)', code: 'HTTP 502', detail: 'provider down', provider: 'judge0', language: 'C++' } }) }; throw new Error('x'); };
  const rG = await t('Test G', () => P.checkCode({ activityId: 'act-1', problem: PROBLEM, source: okSrc, language: 'c++' }));
  global.fetch = realFetch;
  check('service down -> execution_service_error (NEVER wrong_answer)', rG.status === 'execution_service_error', rG.status);

  const CASES_NG = CASES.map((c, i) => i === 3 ? Object.assign({}, c, { include_in_grading: false }) : c);
  const GOOD2 = Object.assign({}, GOOD); delete GOOD2['6\n1 2 3 4 5 6\n'];
  tcTable['prob-1'] = CASES_NG;
  CURRENT_GOOD = GOOD2;
  const rH = await t('Test H', () => P.checkCode({ activityId: 'act-1', problem: PROBLEM, source: okSrc, language: 'c++' }));
  check('non-graded case fails quietly -> still accepted 20/20, grading_count 5', rH.status === 'accepted' && rH.score === 20 && rH.grading_count === 5, rH.status + ' ' + rH.score + ' graded=' + rH.grading_count);
  tcTable['prob-1'] = CASES;
  CURRENT_GOOD = GOOD;

  const run = await t('runInSandbox', () => P.runInSandbox({ language: 'c++', source: okSrc, stdin: '5\n10 20 30 40 50\n', timeoutMs: 4000 }));
  check('runInSandbox -> canonical result via /api/programming-run', run && run.provider === 'judge0' && run.stdout.trim() === '150', JSON.stringify(run && run.stdout));

  const newLang = await t('new language', () => P.runInSandbox({ language: 'go', source: 'package main\nimport "fmt"\nfunc main(){fmt.Println("80")}', stdin: '', timeoutMs: 4000 }));
  check('new language run (go) -> canonical', newLang && newLang.stdout.trim() === '80', JSON.stringify(newLang && newLang.stdout));

  const passed = results.filter((r) => r.ok).length;
  console.log('\nFINAL: ' + passed + '/' + results.length + ' grading pipeline tests passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });