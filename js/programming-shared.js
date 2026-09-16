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
  // The Edge Function (supabase/functions/programming-run) forwards into a
  // containerized sandbox (Piston API by default) with strict limits:
  //   time, memory, file system, sandbox isolation, no network for code.
  // ------------------------------------------------------------------
  const FUNCTIONS_BASE = (typeof SUPABASE_URL !== 'undefined')
    ? SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/programming-run'
    : '';

  async function runInSandbox({ language, source, stdin, timeoutMs }) {
    if (!FUNCTIONS_BASE) throw new Error('Programming runner not configured.');
    const res = await fetch(FUNCTIONS_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (Auth.accessToken || '') },
      body: JSON.stringify({ language, source, stdin: stdin || '', timeout_ms: timeoutMs || 4000 })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body && body.message) || ('Runner error ' + res.status));
    }
    return await res.json();
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
      const passed = (run.compile_error || run.runtime_error || run.signals
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
               message: 'Runner unavailable' };
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
