// ============================================================
// PROGRAMMING PLATFORM - SHARED BACKBONE
// ============================================================
// WQTech Programming - a SEPARATE module from Quiz/QuizBattle.
// This file is the single source of truth for:
//   - language configs
//   - data loading (activities / problems / test cases)
//   - code auto-save + resume
//   - run / check (sandboxed execution via the WQTech runner API
//     at /api/programming-run, deployed on Vercel)
//   - grading (sample + hidden cases, points, status)
//   - timer (mm:ss countdown, auto-submit at zero)
//   - result roll-up
//
// Depends on (loaded elsewhere, in order):
//   supabase browser client (js/supabase-config.js -> window.supabaseClient)
//   Auth (js/auth.js)  Auth.currentUser { id }
//
// Everything here is exposed on window.Programming.
// ============================================================

window.Programming = (function () {
  const cx = (typeof supabaseClient !== 'undefined') ? supabaseClient : null;

  // ------------------------------------------------------------------
  // LANGUAGE CONFIG (beginner scope)
  // `id` = what the UI stores; `piston` matches the Piston API language
  // field; the server aliases these to the judge0 ids it needs.
  // ------------------------------------------------------------------
  const LANGUAGES = [
    { id: 'c',          label: 'C',          piston: 'c',          ext: 'c',      starter: '// C starter code\n#include <stdio.h>\n\nint main() {\n    return 0;\n}\n' },
    { id: 'cpp',        label: 'C++',        piston: 'c++',        ext: 'cpp',    starter: '// C++ starter code\n#include <iostream>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n' },
    { id: 'csharp',     label: 'C#',         piston: 'csharp',     ext: 'cs',     starter: '// C# starter code\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine();\n    }\n}\n' },
    { id: 'java',       label: 'Java',       piston: 'java',       ext: 'java',   starter: '// Java starter code\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println();\n    }\n}\n' },
    { id: 'python',     label: 'Python',     piston: 'python',     ext: 'py',     starter: '# Python starter code\n\ndef main():\n    pass\n\nif __name__ == "__main__":\n    main()\n' },
    { id: 'javascript', label: 'JavaScript', piston: 'javascript', ext: 'js',     starter: '// JavaScript starter code\n\nfunction main() {\n    console.log("");\n}\n\nmain();\n' },
    { id: 'typescript', label: 'TypeScript', piston: 'typescript', ext: 'ts',     starter: '// TypeScript starter code\nfunction main(): void {\n    try {\n        const input = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);\n        // Write your code here\n    } catch (e) {}\n}\n\nmain();\n' },
    { id: 'go',         label: 'Go',         piston: 'go',         ext: 'go',     starter: '// Go starter code\npackage main\n\nimport (\n    "fmt"\n)\n\nfunc main() {\n    fmt.Println("")\n}\n' },
    { id: 'rust',       label: 'Rust',       piston: 'rust',       ext: 'rs',     starter: '// Rust starter code\nfn main() {\n    println!("");\n}\n' },
    { id: 'ruby',       label: 'Ruby',       piston: 'ruby',       ext: 'rb',     starter: '# Ruby starter code\n\nputs ""\n' }
  ];

  const langById = (id) => LANGUAGES.find(l => l.id === id) || LANGUAGES[1];

  const uid = () => (Auth && Auth.currentUser && Auth.currentUser.id) || '';

  // Teacher check mirrors the quiz system: a row in admins table
  const isTeacher = async () => {
    if (!uid()) return false;
    try {
      const { data, error } = await cx.from('admins').select('id').eq('id', uid()).maybeSingle();
      return !error && !!data;
    } catch (e) { return false; }
  };

  // ------------------------------------------------------------------
  // DATA LOADING
  // ------------------------------------------------------------------
  async function listActivities() {
    const { data, error } = await cx.from('programming_activities')
      .select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadActivity(activityId) {
    const { data: activity, error: e1 } = await cx.from('programming_activities')
      .select('*').eq('id', activityId).maybeSingle();
    if (e1) throw e1;
    const { data: problems, error: e2 } = await cx.from('programming_problems')
      .select('*').eq('activity_id', activityId).order('question_number', { ascending: true });
    if (e2) throw e2;
    return { activity: activity || null, problems: problems || [] };
  }

  // Student-facing test cases: sample cases always shown.
  // Hidden cases are ONLY used by the grader - description fields are
  // stripped so the student can never read them for the client.
  async function getVisibleTestCases(problemId) {
    const { data, error } = await cx.from('programming_test_cases')
      .select('*').eq('problem_id', problemId).order('sort_order', { ascending: true });
    if (error) throw error;
    const rows = data || [];
    return {
      sample: rows.filter(t => t.is_sample),
      hidden: rows.filter(t => !t.is_sample).map(t => ({ id: t.id, label: 'Hidden' })),
      allForGrading: rows
    };
  }

  // ------------------------------------------------------------------
  // CODE AUTO-SAVE / RESUME (per problem, per student, per language)
  // Server: programming_code_saves (upsert). Local: localStorage backup.
  // ------------------------------------------------------------------
  const saveKey = (activityId, problemId) => `wq_prog_${activityId}_${problemId}`;

  function localSave(activityId, problemId, language, source) {
    try {
      localStorage.setItem(saveKey(activityId, problemId),
        JSON.stringify({ language, source, savedAt: Date.now() }));
    } catch (e) {}
  }

  function localLoad(activityId, problemId) {
    try {
      const raw = localStorage.getItem(saveKey(activityId, problemId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  async function saveCode(activityId, problemId, language, source) {
    localSave(activityId, problemId, language, source);
    if (!uid()) return;
    try {
      const { data: existing } = await cx.from('programming_code_saves')
        .select('id').eq('activity_id', activityId)
        .eq('problem_id', problemId).eq('student_id', uid()).maybeSingle();
      if (existing) {
        await cx.from('programming_code_saves').update({
          language, source_code: source, updated_at: new Date().toISOString()
        }).eq('id', existing.id);
      } else {
        await cx.from('programming_code_saves').insert({
          activity_id: activityId, problem_id: problemId, student_id: uid(),
          language, source_code: source
        });
      }
    } catch (e) {}
  }

  async function loadSavedCode(activityId, problemId) {
    const local = localLoad(activityId, problemId);
    if (local && local.source) return local;
    if (!uid()) return null;
    try {
      const { data } = await cx.from('programming_code_saves')
        .select('language, source_code').eq('activity_id', activityId)
        .eq('problem_id', problemId).eq('student_id', uid()).maybeSingle();
      if (data && data.source_code) return { language: data.language, source: data.source_code };
    } catch (e) {}
    return null;
  }

// ------------------------------------------------------------------
  // EXECUTION - sandboxed via the SECURE BACKEND ONLY.
  // The browser NEVER talks to an execution provider directly. Every run
//   goes to the WQTech runner API. Default: the same-origin Vercel
//   function /api/programming-run (window.RUNNER_API_URL, set in
//   js/piston-config.js). That API authenticates the user (Supabase
//   JWT), maps the language, talks to the configured provider
//   (Piston / Judge0 CE) server-side, normalizes the result and
//   returns it here. Provider config, versions and keys live on the
//   API server - not in this file and not in the browser (spec: no
//   execution-api keys in the frontend). Untrusted student code never
//   runs in this runtime.
//   ------------------------------------------------------------------
  const FUNCTIONS_BASE = (window.RUNNER_API_URL && String(window.RUNNER_API_URL))
    || '';

  // ------------------------------------------------------------------
  // RUNNER HEALTH CHECK — runs once on page load to verify the Vercel
  // function is deployed and reachable. If it fails, all Run/Check
  // calls will fail, so we surface the error early instead of hiding it.
  // ------------------------------------------------------------------
  let _runnerHealth = null;
  async function checkRunnerHealth() {
    if (_runnerHealth) return _runnerHealth;
    if (!FUNCTIONS_BASE) {
      _runnerHealth = { ok: false, message: 'Runner API URL not configured (window.RUNNER_API_URL is empty). Deploy api/programming-run.js to Vercel.', url: '' };
      console.error('[Runner] health check failed:', _runnerHealth.message);
      return _runnerHealth;
    }
    try {
      const r = await fetch(FUNCTIONS_BASE + '/health', { method: 'GET', signal: AbortSignal.timeout(10000) });
      const body = await r.json().catch(() => null);
      if (r.ok && body && body.ok) {
        _runnerHealth = { ok: true, url: FUNCTIONS_BASE, languages: body.languages, active_provider: body.active_provider };
        console.log('[Runner] health check passed', JSON.stringify(_runnerHealth));
      } else {
        const hint = r.status === 405
          ? 'HTTP 405 means the Vercel function is NOT deployed. The static file server is handling POST requests instead of the serverless function. Deploy this project to Vercel: push to GitHub → import in Vercel → set environment variables.'
          : r.status === 404
          ? 'HTTP 404 means the Vercel function file api/programming-run.js was not found. Check that the file exists in the api/ directory and that the Vercel project root contains it.'
          : 'Unexpected response from runner health check.';
        _runnerHealth = { ok: false, status: r.status, message: hint, url: FUNCTIONS_BASE, body: body };
        console.error('[Runner] health check failed:', r.status, hint, body);
      }
    } catch (e) {
      const msg = (e && e.name === 'TimeoutError')
        ? 'Runner API health check timed out. The Vercel function may not be deployed.'
        : 'Runner API unreachable: ' + (e && e.message || e);
      _runnerHealth = { ok: false, message: msg, url: FUNCTIONS_BASE };
      console.error('[Runner] health check failed:', msg);
    }
    return _runnerHealth;
  }

  // Friendly language name for diagnostics / the Code Runner Error panel.
  function displayLang(language) {
    const l = String(language || '').toLowerCase();
    if (l === 'c') return 'C';
    if (l === 'c++' || l === 'cpp' || l === 'cplusplus') return 'C++';
    if (l === 'c#' || l === 'csharp' || l === 'cs') return 'C#';
    if (l === 'java') return 'Java';
    if (l === 'python' || l === 'python3' || l === 'py') return 'Python';
    if (l === 'javascript' || l === 'js' || l === 'node' || l === 'nodejs') return 'JavaScript';
    if (l === 'typescript' || l === 'ts') return 'TypeScript';
    if (l === 'go' || l === 'golang') return 'Go';
    if (l === 'rust') return 'Rust';
    if (l === 'ruby' || l === 'rb') return 'Ruby';
    return String(language || '');
  }

  // Accepts EITHER the Edge Function response, the raw Piston shape, OR the
  // raw Judge0 shape, and normalizes everything to the single shape the rest
  // of the app expects: { stdout, stderr, compile_error, compile_output,
  // runtime_error, status ('tle' | ''), time_ms }.
  function normalizeRun(raw) {
    if (!raw || typeof raw !== 'object') return {};

    // ---- Canonical shape returned by the backend adapter (programming-run
    // edge function): { stdout, stderr, compile_error, compile_output,
    // runtime_error, status: ''|'tle'|'mle', time_ms, provider, language,
    // version }. Pass it through untouched.
    if (typeof raw.status === 'string' && 'provider' in raw) return raw;

    // ---- Judge0 CE shape (public API / legacy relay) ----
    if (raw.status && typeof raw.status === 'object' && 'id' in raw.status) {
      const sid = parseInt(raw.status.id, 10);
      const stdout = String(raw.stdout || '').replace(/\s+$/g, '');
      const stderr = String(raw.stderr || '').replace(/\s+$/g, '');
      let compile_error = '', runtime_error = '';
      if (sid === 6) compile_error = String(raw.compile_output || '').replace(/\s+$/g, '');
      else if (sid >= 7 && sid <= 12) runtime_error = stderr || ('Runtime error (' + (raw.status.description || 'unknown') + ')');
      return {
        stdout,
        stderr,
        compile_error,
        compile_output: '',
        runtime_error,
        status: sid === 5 ? 'tle' : (sid === 3 || sid === 4 ? '' : (raw.status.description || '')),
        time_ms: typeof raw.time === 'number' ? Math.round(raw.time * 1000)
               : (raw.time != null ? Math.round(parseFloat(raw.time) * 1000) : undefined)
      };
    }

    // ---- Piston shape (public API / primary runner) ----
    const run = raw.run || {};
    const compile = raw.compile || {};
    const stdout = String(raw.stdout != null ? raw.stdout : (run.stdout || '')).replace(/\s+$/g, '');
    const stderr = String(raw.stderr != null ? raw.stderr : (run.stderr || '')).replace(/\s+$/g, '');
    const compileFailed = (compile && typeof compile.code === 'number' && compile.code !== 0);
    let compileErr = (raw.compile_error != null) ? raw.compile_error
                   : (compile && (compile.stderr || compile.output)) ? (compile.stderr || compile.output) : '';
    if (compileFailed && !compileErr) compileErr = 'Compilation Error';
    const compileOut = (raw.compile_output != null) ? raw.compile_output
                     : (compile && compile.stdout) ? compile.stdout : '';
    const runSig = raw.signals || (run && run.signal) || null;
    const runCode = (typeof raw.exit_code === 'number') ? raw.exit_code : (run && run.code);
    const timedOut = runSig === 'SIGKILL' || runCode === 124 || runCode === 137;
    const hasCompileErr = !!(compileErr) || compileFailed;
    let runtimeError = '';
    if (raw.runtime_error != null) runtimeError = raw.runtime_error;
    else if (!hasCompileErr && runCode != null && runCode !== 0) {
      runtimeError = stderr || (timedOut ? '' : ('Program exited with code ' + runCode));
    }
    return {
      stdout,
      stderr,
      compile_error: compileErr || '',
      compile_output: compileOut || '',
      runtime_error: runtimeError || '',
      status: timedOut ? 'tle' : (raw.status || ''),
      time_ms: typeof raw.time_ms === 'number' ? raw.time_ms : undefined
    };
  }

  async function getAccessToken() {
    try {
      const { data } = await supabaseClient.auth.getSession();
      return (data && data.session && data.session.access_token) || '';
    } catch (e) { return ''; }
  }

  // Rich execution-service error. `meta` carries the exact request we sent
  // and the exact upstream response, so the cause of any HTTP 4xx/5xx can be
  // identified from the console instead of just seeing "HTTP 400".
  function executionError(status, detail, meta) {
    const err = new Error('Execution service error (HTTP ' + status + ')');
    err.kind = 'execution';
    err.status = status;
    err.detail = detail || '';
    err.meta = meta || {};
    return err;
  }

  // Full failure trace for the browser/Supabase console (spec requirement 1):
  // provider, language, version, source length, stdin, request payload (no
  // secrets), API URL, HTTP status and the real response body from the exec
  // service — so a 400 is never reported without its cause.
  function logRunnerFailure(provider, diag) {
    try {
      console.error('[Runner ' + provider + '] failure diagnostics',
        JSON.stringify({
          provider,
          language: diag.language,
          language_version: diag.version || null,
          source_length: diag.sourceLength,
          stdin: diag.stdin,
          request: diag.requestBody,
          api_url: diag.url,
          http_status: diag.status,
          response_body: diag.responseBody
        }, null, 2));
    } catch (e) {}
  }

  // Automatic retry for TRANSIENT network failures ONLY (fetch threw before
  // an HTTP response was received). An HTTP response from the runner already
  // includes the server's own provider retries + fallback, so 4xx/5xx are
  // treated as final — never hidden, never duplicated.
  async function runInSandbox({ language, source, stdin, timeoutMs }) {
    if (!source) throw new Error('No code to run.');
    if (!FUNCTIONS_BASE) {
      const err = executionError(0, 'The code runner backend is not configured for this site. window.RUNNER_API_URL is empty. Deploy api/programming-run.js to Vercel.', { provider: 'backend' });
      throw err;
    }
    const t = parseInt(timeoutMs, 10) || 4000;
    const maxAttempts = 2;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 700));
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), Math.min(t + 15000, 30000));
      const token = await getAccessToken();
      let res;
      try {
        res = await fetch(FUNCTIONS_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ language, source, stdin: stdin || '', timeout_ms: t }),
          signal: controller.signal
        });
      } catch (e) {
        clearTimeout(to);
        logRunnerFailure('function', { language: displayLang(language), version: null, sourceLength: source.length, stdin: stdin || '', requestBody: { language, source }, url: FUNCTIONS_BASE, status: 0, responseBody: String(e && e.message || e) });
        lastErr = executionError(0, 'Runner unreachable: ' + (e && e.message || e), { provider: 'backend', language: displayLang(language), url: FUNCTIONS_BASE });
        if (attempt < maxAttempts) continue; // transient network blip
        break;
      }
      clearTimeout(to);
      let body;
      try { body = await res.json(); } catch (e) { body = null; }
      if (res.ok && body && body.ok && body.result) return normalizeRun(body.result);

      // Any non-200 / non-ok here is a categorized EXECUTION SERVICE ERROR
      // (HTTP 400, provider down, auth, ...). It is never reported as the
      // student's Wrong Answer / Compilation Error.
      const err = (body && body.error) || {};
      const detail = err.detail || err.message || '';
      const http405hint = (res.status === 405)
        ? ' HTTP 405 = the Vercel serverless function is NOT deployed; the static host is answering POST with Method Not Allowed. Deploy this project on Vercel (git push → import → set env vars), then verify '
          + FUNCTIONS_BASE + '/health. If you are testing locally, open the Vercel deployment URL instead of the local file/server.'
        : '';
      logRunnerFailure(err.provider || 'function', { language: displayLang(language), version: err.version || null, sourceLength: source.length, stdin: stdin || '', requestBody: { language, source, stdin: stdin || '', timeout_ms: t }, url: FUNCTIONS_BASE, status: res.status, responseBody: JSON.stringify(body || '').slice(0, 2000) });
      lastErr = executionError(res.status, (detail || String(res.status)) + http405hint, {
        provider: err.provider || 'backend',
        language: displayLang(language),
        version: err.version || null,
        url: FUNCTIONS_BASE,
        payload: { language, source, stdin: stdin || '', timeout_ms: t },
        response: JSON.stringify(body || '').slice(0, 2000)
      });
      break;
    }
    throw lastErr || executionError(0, 'Execution service error', { provider: 'backend', language: displayLang(language) });
  }

  // One test case => run => pass/fail. Points come from the dynamic
  // allocation (never hard-coded per test case); hidden cases never expose
  // their input/expected answers to the student.
  async function runSingleTestCase(problem, testCase, source, language, points, includedInGrading) {
    const started = Date.now();
    try {
      const run = await runInSandbox({
        language, source,
        stdin: testCase.input || '',
        timeoutMs: 3000
      });
      const out = normalizeOutput(run.stdout || '');
      const expected = normalizeOutput(testCase.expected_output || '');
      const passed = (run.compile_error || run.runtime_error
                     || run.status === 'tle' || run.status === 'mle') ? false : (out === expected);
      return {
        test_case_id: testCase.id,
        label: testCase.label || '',
        input: testCase.is_sample ? (testCase.input || '') : 'Hidden',
        expected: testCase.is_sample ? (testCase.expected_output || '') : 'Hidden',
        output: testCase.is_sample ? (run.stdout || '') : '',
        is_sample: !!testCase.is_sample,
        included_in_grading: includedInGrading !== false,
        passed,
        points: passed ? (points || 0) : 0,
        runtime_ms: Date.now() - started,
        message: run.compile_error ? 'Compilation Error' :
                 run.runtime_error ? 'Runtime Error' :
                 run.status === 'mle' ? 'Memory Limit Exceeded' :
                 run.status === 'tle' ? 'Time Limit Exceeded' : (passed ? 'Passed' : 'Failed'),
        stdout: run.stdout || ''
      };
    } catch (e) {
      return {
        test_case_id: testCase.id, label: testCase.label || '', input: '', expected: '',
        is_sample: !!testCase.is_sample, included_in_grading: includedInGrading !== false,
        output: '', passed: false, points: 0, runtime_ms: 0,
        message: (e && e.kind === 'execution') ? 'Execution Service Error' : ((e && e.message) || 'Runner unavailable'),
        stdout: ''
      };
    }
  }

  function normalizeOutput(s) {
    if (s == null) return '';
    return String(s).replace(/\r\n/g, '\n').replace(/\s+$/g, '').trim();
  }

  // Points are divided AUTOMATICALLY and EQUALLY among the test cases that
  // are included in grading (spec: no hard-coded test case count). When the
  // division has a remainder, the extra points go to the FIRST cases by sort
  // order, so the sum always equals the problem's total points exactly.
  function allocatePoints(totalPoints, count) {
    const total = Math.max(0, Math.round(totalPoints || 0));
    if (!count || count < 1) return [];
    if (total <= 0) return new Array(count).fill(0);
    const base = Math.floor(total / count);
    const remainder = total - (base * count);
    const points = new Array(count).fill(base);
    for (let i = 0; i < remainder; i++) points[i] += 1;
    return points;
  }

  // ------------------------------------------------------------------
  // GRADING ("Check Code")
  // Runs the test cases the admin marked "include in grading" (sample +
  // hidden). Hidden cases are graded but NEVER revealed to the student.
  // Points = problem.points divided equally over the grading cases.
  // ------------------------------------------------------------------
  async function checkCode({ activityId, problem, source, language }) {
    const { allForGrading } = await getVisibleTestCases(problem.id);
    const gradingCount = allForGrading.filter(t => t.include_in_grading !== false).length;
    const allocated = allocatePoints(problem.points || 0, gradingCount);
    const results = [];
    let gi = 0;
    for (const tc of allForGrading) {
      const graded = tc.include_in_grading !== false;
      const points = graded ? (allocated[gi++] || 0) : 0;
      results.push(await runSingleTestCase(problem, tc, source, language, points, graded));
    }
    const pointsEarned = results.reduce((a, r) => a + r.points, 0);
    const pointsPossible = Math.max(0, Math.round(problem.points || 0));
    const gradedResults = results.filter(r => r.included_in_grading !== false);
    const passedCount = gradedResults.filter(r => r.passed).length;
    const allPassed = gradedResults.length > 0 && passedCount === gradedResults.length;
    // Service failure is NEVER the student's wrong answer / compile error.
    const status = (results.some(r => r.message === 'Execution Service Error')) ? 'execution_service_error'
                 : (results.some(r => r.message === 'Compilation Error')) ? 'compilation_error'
                 : (results.some(r => r.message === 'Runtime Error')) ? 'runtime_error'
                 : (results.some(r => r.message === 'Time Limit Exceeded')) ? 'time_limit_exceeded'
                 : (results.some(r => r.message === 'Memory Limit Exceeded')) ? 'memory_limit_exceeded'
                 : allPassed ? 'accepted' : 'wrong_answer';

    const report = {
      problem_id: problem.id,
      status,
      score: pointsEarned,
      max_score: pointsPossible,
      grading_count: gradingCount,
      sample_passed: results.filter((r, i) => allForGrading[i].is_sample && r.passed).length,
      sample_total: results.filter((r, i) => allForGrading[i].is_sample).length,
      hidden_passed: results.filter((r, i) => !allForGrading[i].is_sample && r.passed).length,
      hidden_total: results.filter((r, i) => !allForGrading[i].is_sample).length,
      test_results: results,
      submitted_at: new Date().toISOString()
    };

    await saveSubmission(activityId, problem, source, language, report);
    return report;
  }

  async function saveSubmission(activityId, problem, source, language, report) {
    if (!uid()) return;
    try {
      await cx.from('programming_code_saves').upsert({
        activity_id: activityId, problem_id: problem.id, student_id: uid(),
        language, source_code: source
      }, { onConflict: 'activity_id,problem_id,student_id' });
      const { data: sub, error: subErr } = await cx.from('programming_submissions').insert({
        activity_id: activityId, problem_id: problem.id, student_id: uid(),
        student_name: (Auth && Auth.currentUser && Auth.currentUser.user_metadata &&
                       Auth.currentUser.user_metadata.name) || '',
        language, source_code: source,
        status: report.status, score: report.score, max_score: report.max_score,
        sample_passed: report.sample_passed, sample_total: report.sample_total,
        hidden_passed: report.hidden_passed, hidden_total: report.hidden_total,
        test_results: report.test_results,
        runtime_ms: report.test_results.reduce((a, r) => a + (r.runtime_ms || 0), 0)
      }).select('id').single();
      if (subErr) throw subErr;
      if (sub && sub.id) {
        const rows = (report.test_results || [])
          .filter(r => r.test_case_id)
          .map(r => ({
            submission_id: sub.id,
            test_case_id: r.test_case_id,
            status: r.passed ? 'passed' : (r.message === 'Compilation Error' ? 'compilation_error'
                        : r.message === 'Runtime Error' ? 'runtime_error'
                        : r.message === 'Time Limit Exceeded' ? 'time_limit_exceeded'
                        : r.message === 'Memory Limit Exceeded' ? 'memory_limit_exceeded'
                        : r.message === 'Execution Service Error' ? 'execution_service_error'
                        : 'failed'),
            actual_output: r.is_sample ? (r.stdout || '') : '',
            execution_time: r.runtime_ms || 0,
            points_earned: r.points || 0
          }));
        if (rows.length) await cx.from('programming_test_results').insert(rows);
      }
    } catch (e) { console.error('saveSubmission failed', e); }
  }

  // ------------------------------------------------------------------
  // ACTIVITY FINALIZATION (auto-submit on timer end / manual "Finish")
  // Rolls per-problem scores into programming_results (one row/student)
  // ------------------------------------------------------------------
  async function finalizeActivity(activityId, problems, reports, extras) {
    if (!uid()) return { ok: false, reason: 'not signed in' };
    try {
      const rawScore = problems.reduce((sum, p) => sum + ((reports[p.id] && reports[p.id].score) || 0), 0);
      const totalPoints = problems.reduce((sum, p) => sum + (p.points || 0), 0);
      const violations = parseInt((extras && extras.violations) || 0, 10);
      const penaltyPoints = parseInt((extras && extras.penaltyPoints) || 0, 10);
      const totalScore = Math.max(0, rawScore - (violations * penaltyPoints));
      const completed = problems.every(p => reports[p.id] && reports[p.id].status === 'accepted');
      await cx.from('programming_results').upsert({
        activity_id: activityId, student_id: uid(),
        student_name: (Auth && Auth.currentUser && Auth.currentUser.user_metadata &&
                       Auth.currentUser.user_metadata.name) || '',
        total_score: totalScore, total_points: totalPoints,
        violations, penalty_points: violations * penaltyPoints,
        status: completed ? 'completed' : 'incomplete',
        submitted_at: new Date().toISOString()
      }, { onConflict: 'activity_id,student_id' });
      return { ok: true, totalScore, totalPoints, completed, violations, penaltyPoints };
    } catch (e) {
      return { ok: false, reason: e.message || e };
    }
  }

  // ------------------------------------------------------------------
  // TIMER (mm:ss). time_limit stored in MINUTES. Auto finalize at 0.
  // ------------------------------------------------------------------
  function startTimer({ totalMinutes, onTick, onEnd }) {
    let remainSec = Math.max(0, Math.round((totalMinutes || 30) * 60));
    const tick = () => {
      if (remainSec <= 0) {
        clearInterval(iv);
        onTick({ mm: '00', ss: '00', done: true });
        if (onEnd) onEnd();
        return;
      }
      const mm = String(Math.floor(remainSec / 60)).padStart(2, '0');
      const ss = String(remainSec % 60).padStart(2, '0');
      onTick({ mm, ss, done: false });
      remainSec -= 1;
    };
    const iv = setInterval(tick, 1000);
    tick();
    return { stop: () => clearInterval(iv), remaining: () => remainSec };
  }

  return {
    LANGUAGES, langById,
    uid, isTeacher,
    listActivities, loadActivity, getVisibleTestCases,
    saveCode, loadSavedCode,
    runInSandbox, checkCode, finalizeActivity,
    startTimer,
    checkRunnerHealth,
    normalizeOutput, allocatePoints
  };
})();
