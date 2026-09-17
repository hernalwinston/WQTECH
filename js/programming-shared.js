// ============================================================
// PROGRAMMING PLATFORM - SHARED BACKBONE
// ============================================================
// WQTech Programming - a SEPARATE module from Quiz/QuizBattle.
// This file is the single source of truth for:
//   - language configs
//   - data loading (activities / problems / test cases)
//   - code auto-save + resume
//   - run / check (sandboxed execution via Edge Function)
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
  // LANGUAGE CONFIG (beginner scope - C, C++, C#, Java, Python)
  // name matches the Piston API "language" field used by the runner.
  // ------------------------------------------------------------------
  const LANGUAGES = [
    { id: 'c',      label: 'C',       piston: 'c',          ext: 'c',      starter: '// C starter code\n#include <stdio.h>\n\nint main() {\n    return 0;\n}\n' },
    { id: 'cpp',    label: 'C++',     piston: 'c++',        ext: 'cpp',    starter: '// C++ starter code\n#include <iostream>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n' },
    { id: 'csharp', label: 'C#',      piston: 'csharp',     ext: 'cs',     starter: '// C# starter code\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine();\n    }\n}\n' },
    { id: 'java',   label: 'Java',    piston: 'java',       ext: 'java',   starter: '// Java starter code\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println();\n    }\n}\n' },
    { id: 'python', label: 'Python',  piston: 'python',     ext: 'py',     starter: '# Python starter code\n\ndef main():\n    pass\n\nif __name__ == "__main__":\n    main()\n' }
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
  // EXECUTION - sandboxed. NEVER run student code directly on this server.
  // Preferred path is the Edge Function (supabase/functions/programming-run),
  // which relays into a containerized judge (Judge0 CE). If it is not
  // deployed, the browser automatically calls the public Judge0 CE sandbox
  // directly, so the app keeps working out of the box.
  // ------------------------------------------------------------------
  const FUNCTIONS_BASE = (typeof SUPABASE_URL !== 'undefined')
    ? SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/programming-run'
    : '';

// Public Judge0 CE sandbox. Used as an automatic fallback so Run/Check
  // works even before (without) the Supabase Edge Function being deployed.
  const JUDGE0_PUBLIC = 'https://ce.judge0.com/submissions';

  // Judge0 CE quota-safe execution limits. The public runner (and most
  // self-hosted instances) reject out-of-range cpu/memory limits with an
  // HTTP 400, so we clamp to values every CE instance accepts. The Edge
  // Function applies the same clamps; override them server-side with the
  // RUNNER_MAX_CPU_SECONDS / RUNNER_MEMORY_LIMIT_KB env vars.
  const RUNNER_MAX_CPU_SECONDS = 3;
  const RUNNER_MEMORY_LIMIT_KB = 128000;

// Piston API (https://github.com/engineer-man/piston) — PRIMARY runner when
// a Piston instance is configured. Point window.PISTON_BASE at your OWN
// instance (e.g. "http://your-host:2000/api/v2/piston") once self-hosted
// via Docker; the public emkc.org API is whitelist-only since 2/15/2026, so
// it is never called by default. Piston posts source + stdin and runs to
// completion using compile_timeout/run_timeout. It takes NO cpu/memory
// limit params, so the out-of-range HTTP 400 simply cannot happen.
// Runtime versions are fetched once per hour and cached, with local
// defaults as a network-free fallback.
  const PISTON_BASE = (typeof window !== 'undefined' && window.PISTON_BASE && String(window.PISTON_BASE).trim())
    ? String(window.PISTON_BASE).trim().replace(/\/+$/, '')
    : '';
  const PISTON_RUNTIME_DEFAULTS = { c: '10.2.0', 'c++': '10.2.0', csharp: '6.12.0', java: '17.0.9', python: '3.10.0' };
  let pistonRuntimes = null, pistonRuntimesAt = 0;

  async function pistonVersion(pistonLang) {
    if (!pistonRuntimes || Date.now() - pistonRuntimesAt > 3600000) {
      try {
        const r = await fetch(PISTON_BASE + '/runtimes');
        if (r.ok) pistonRuntimes = await r.json();
      } catch (e) { /* keep the previous cache (if any) */ }
      pistonRuntimesAt = Date.now();
    }
    const versions = (pistonRuntimes || [])
      .filter(x => x && x.language === pistonLang)
      .map(x => x.version);
    if (versions.length) {
      return versions.slice().sort((a, b) => {
        const pa = String(a).split(/[.\-]/).map(x => parseInt(x, 10) || 0);
        const pb = String(b).split(/[.\-]/).map(x => parseInt(x, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const va = pa[i] || 0, vb = pb[i] || 0;
          if (va !== vb) return vb - va;
        }
        return 0;
      })[0];
    }
    return PISTON_RUNTIME_DEFAULTS[pistonLang] || '';
  }

  function pistonFileName(pistonLang) {
    if (pistonLang === 'java') return 'Main.java';
    if (pistonLang === 'c++') return 'main.cpp';
    if (pistonLang === 'csharp') return 'main.cs';
    if (pistonLang === 'python') return 'main.py';
    if (pistonLang === 'c') return 'main.c';
    return 'main.txt';
  }

  // Accepts Piston language names (what RUN_LANG is set to) or the id forms.
  function pistonLang(language) {
    const l = String(language || '').toLowerCase();
    if (l === 'c' || l === 'c++' || l === 'csharp' || l === 'java' || l === 'python') return l;
    if (l === 'cpp' || l === 'cplusplus') return 'c++';
    if (l === 'cs' || l === 'c#') return 'csharp';
    if (l === 'python3' || l === 'py') return 'python';
    return 'c++';
  }

  // App language -> Judge0 CE language_id (stable for the CE language set).
  function judge0LangId(language) {
    const l = String(language || '').toLowerCase();
    if (l === 'c') return 50;
    if (l === 'c++' || l === 'cplusplus' || l === 'cpp') return 54;
    if (l === 'c#' || l === 'csharp' || l === 'cs') return 51;
    if (l === 'java') return 62;
    if (l === 'python' || l === 'python3') return 71;
    return 54;
  }

  // Accepts EITHER the Edge Function response, the raw Piston shape, OR the
  // raw Judge0 shape, and normalizes everything to the single shape the rest
  // of the app expects: { stdout, stderr, compile_error, compile_output,
  // runtime_error, status ('tle' | ''), time_ms }.
  function normalizeRun(raw) {
    if (!raw || typeof raw !== 'object') return {};

    // ---- Judge0 CE shape (public API / Edge Function relay) ----
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

  function executionError(status, detail) {
    const err = new Error('Execution service error (HTTP ' + status + ')');
    err.kind = 'execution';
    err.status = status;
    err.detail = detail || '';
    return err;
  }

  async function runInPiston({ language, source, stdin, timeoutMs }) {
    const t = Math.min(Math.max(parseInt(timeoutMs, 10) || 4000, 200), 20000);
    const plang = pistonLang(language);
    const res = await fetch(PISTON_BASE + '/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: plang,
        version: await pistonVersion(plang),
        files: [{ name: pistonFileName(plang), content: source }],
        stdin: stdin || '',
        args: [],
        compile_timeout: 10000,
        run_timeout: t
      })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body && body.message) || (body && body.error) || (body && body.detail) || '';
      throw executionError(res.status, detail);
    }
    return normalizeRun(await res.json());
  }

  async function runInSandbox({ language, source, stdin, timeoutMs }) {
    const t = parseInt(timeoutMs, 10) || 4000;
    if (!source) throw new Error('No code to run.');

    // 1) PRIMARY (when configured): a self-hosted Piston instance.
    //    No cpu/memory limit params, so the out-of-range HTTP 400 cannot
    //    happen. If it is unreachable or rejects us, log it and fall
    //    through to the Edge Function / Judge0 path so a hiccup never
    //    blocks anyone.
    if (PISTON_BASE) {
      try {
        return await runInPiston({ language, source, stdin, timeoutMs: t });
      } catch (e) {
        if (e && e.kind === 'execution') console.error('piston runner -> HTTP ' + e.status + ': ' + (e.detail || e.message));
      }
    }

    // 2) Fallback: your own Supabase Edge Function (server -> judge).
    if (FUNCTIONS_BASE) {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), Math.min(t + 8000, 20000));
        const token = await getAccessToken();
        const res = await fetch(FUNCTIONS_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ language, source, stdin: stdin || '', timeout_ms: t }),
          signal: controller.signal
        });
        clearTimeout(to);
        if (res.ok) return normalizeRun(await res.json());
        // Edge Function is reachable but failed. Log it (Supabase function
        // logs / browser console) then still fall back to the public sandbox
        // so a temporary upstream hiccup never blocks participants.
        const tErr = await res.text().catch(() => '');
        console.error('programming-run edge function -> HTTP ' + res.status + ': ' + tErr.slice(0, 300));
      } catch (e) { /* unreachable / not deployed / CORS -> fall through to Judge0 */ }
    }

    // 3) Fallback: Judge0 CE directly from the browser.
    const res = await fetch(JUDGE0_PUBLIC + '?base64_encoded=false&wait=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_code: source,
        language_id: judge0LangId(language),
        stdin: stdin || '',
        cpu_time_limit: Math.min(Math.max(Math.ceil(t / 1000), 1), RUNNER_MAX_CPU_SECONDS),
        memory_limit: RUNNER_MEMORY_LIMIT_KB
      })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body && body.message) || (body && body.error) || (body && body.detail) || '';
      throw executionError(res.status, detail);
    }
    return normalizeRun(await res.json());
  }

  // One test case => run => pass/fail
  async function runSingleTestCase(problem, testCase, source, language) {
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
                     || run.status === 'tle') ? false : (out === expected);
      return {
        test_case_id: testCase.id,
        label: testCase.label || '',
        input: testCase.is_sample ? (testCase.input || '') : 'Hidden',
        expected: testCase.is_sample ? (testCase.expected_output || '') : 'Hidden',
        output: testCase.is_sample ? (run.stdout || '') : '',
        passed,
        points: passed ? (testCase.points || 0) : 0,
        runtime_ms: Date.now() - started,
        message: run.compile_error ? 'Compilation Error' :
                 run.runtime_error ? 'Runtime Error' :
                 run.status === 'tle' ? 'Time Limit Exceeded' : (passed ? 'Passed' : 'Failed')
      };
    } catch (e) {
      return { test_case_id: testCase.id, label: testCase.label || '', input: '', expected: '',
               output: '', passed: false, points: 0, runtime_ms: 0,
               message: (e && e.message) || 'Runner unavailable' };
    }
  }

  function normalizeOutput(s) {
    if (s == null) return '';
    return String(s).replace(/\r\n/g, '\n').replace(/\s+$/g, '').trim();
  }

  // ------------------------------------------------------------------
  // GRADING ("Check Code")
  // Runs ALL test cases (sample + hidden). Hidden cases are graded but
  // NEVER revealed to the student. Returns a full report + saves it.
  // ------------------------------------------------------------------
  async function checkCode({ activityId, problem, source, language }) {
    const { allForGrading } = await getVisibleTestCases(problem.id);
    const results = [];
    for (const tc of allForGrading) {
      results.push(await runSingleTestCase(problem, tc, source, language));
    }
    const pointsEarned = results.reduce((a, r) => a + r.points, 0);
    const pointsPossible = allForGrading.reduce((a, t) => a + (t.points || 0), 0);
    const passedCount = results.filter(r => r.passed).length;
    const allPassed = results.length > 0 && passedCount === results.length;
    const status = (results.some(r => r.message === 'Compilation Error')) ? 'compilation_error'
                 : (results.some(r => r.message === 'Runtime Error')) ? 'runtime_error'
                 : (results.some(r => r.message === 'Time Limit Exceeded')) ? 'time_limit_exceeded'
                 : allPassed ? 'accepted' : 'wrong_answer';

    const report = {
      problem_id: problem.id,
      status,
      score: pointsEarned,
      max_score: pointsPossible,
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
      await cx.from('programming_submissions').insert({
        activity_id: activityId, problem_id: problem.id, student_id: uid(),
        student_name: (Auth && Auth.currentUser && Auth.currentUser.user_metadata &&
                       Auth.currentUser.user_metadata.name) || '',
        language, source_code: source,
        status: report.status, score: report.score, max_score: report.max_score,
        sample_passed: report.sample_passed, sample_total: report.sample_total,
        hidden_passed: report.hidden_passed, hidden_total: report.hidden_total,
        test_results: report.test_results,
        runtime_ms: report.test_results.reduce((a, r) => a + r.runtime_ms, 0)
      });
    } catch (e) {}
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
    normalizeOutput
  };
})();
