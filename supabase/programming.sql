-- ============================================================
-- QUIZBATTLE - PROGRAMMING ONLY (ONE FILE)
-- Paste ALL of this into Supabase SQL Editor -> Run
--
-- Creates EVERYTHING the Programming platform needs:
--   Programming module (activities, problems, test cases,
--   submissions, results, code saves) +
--   Live Programming Contests (prog_games, prog_game_players,
--   prog_game_results, prog_cheat_logs).
--
-- Use this on its own. It is the COMBINED version of the old
-- "UPDATE-PROGRAMMING.sql" + "UPDATE-PROG-LIVE.sql".
--
-- Safe on fresh OR existing databases, and safe to re-run
-- (tables use IF NOT EXISTS, columns use ADD COLUMN IF NOT
-- EXISTS, policies are recreated). Run quiz tables separately
-- with supabase/schema.sql if this is an empty project.
-- ============================================================

-- ============================================================
-- 1) PROGRAMMING ACTIVITIES (a container of problems)
-- ============================================================
CREATE TABLE IF NOT EXISTS programming_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  language TEXT NOT NULL DEFAULT 'C++',
  time_limit_minutes INTEGER NOT NULL DEFAULT 30,
  total_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',          -- draft | published
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2) PROGRAMMING PROBLEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS programming_problems (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES programming_activities(id) ON DELETE CASCADE,
  question_number INTEGER DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  input_format TEXT DEFAULT '',
  output_format TEXT DEFAULT '',
  starter_code TEXT DEFAULT '',
  points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3) PROGRAMMING TEST CASES
--    is_sample          -> visible to students
--    is_hidden          -> used for grading ONLY (never shown)
--    include_in_grading -> participates in the equal split of the
--                          problem's points (the SUM of "included"
--                          cases is the pool the score is divided
--                          from; points are NEVER hard-coded, they
--                          are computed at grade time)
-- ============================================================
CREATE TABLE IF NOT EXISTS programming_test_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  problem_id UUID NOT NULL REFERENCES programming_problems(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  input TEXT DEFAULT '',
  expected_output TEXT DEFAULT '',
  points INTEGER DEFAULT 0,
  is_sample BOOLEAN DEFAULT false,
  is_hidden BOOLEAN DEFAULT false,
  include_in_grading BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Safe to re-run on existing databases that predate this column.
ALTER TABLE programming_test_cases
  ADD COLUMN IF NOT EXISTS include_in_grading BOOLEAN DEFAULT true;

-- ============================================================
-- 4) PROGRAMMING SUBMISSIONS (one row per problem check/save-run)
-- ============================================================
CREATE TABLE IF NOT EXISTS programming_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES programming_activities(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES programming_problems(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name TEXT DEFAULT '',
  language TEXT DEFAULT '',
  source_code TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',        -- pending | accepted | wrong_answer
                                        -- | compilation_error | runtime_error
                                        -- | time_limit_exceeded
                                        -- | memory_limit_exceeded
  score INTEGER DEFAULT 0,
  max_score INTEGER DEFAULT 0,
  sample_passed INTEGER DEFAULT 0,
  sample_total INTEGER DEFAULT 0,
  hidden_passed INTEGER DEFAULT 0,
  hidden_total INTEGER DEFAULT 0,
  test_results JSONB DEFAULT '[]'::jsonb,
  compile_output TEXT DEFAULT '',
  runtime_ms INTEGER DEFAULT 0,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4b) PROGRAMMING TEST RESULTS (one row per test case per submission)
--     Written by the grader alongside each submission. Hidden-case
--     actual_output is intentionally left blank so hidden answers
--     are never stored anywhere readable.
-- ============================================================
CREATE TABLE IF NOT EXISTS programming_test_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES programming_submissions(id) ON DELETE CASCADE,
  test_case_id UUID NOT NULL REFERENCES programming_test_cases(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'failed',         -- passed | failed | compilation_error
                                        -- | runtime_error | time_limit_exceeded
                                        -- | memory_limit_exceeded
                                        -- | execution_service_error
  actual_output TEXT DEFAULT '',
  execution_time INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5) PROGRAMMING RESULTS (rolled-up per student per activity)
--    violations / penalty_points come from the anti-cheat
--    (standalone + live contests both use them)
-- ============================================================
CREATE TABLE IF NOT EXISTS programming_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES programming_activities(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name TEXT DEFAULT '',
  total_score INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  violations INTEGER DEFAULT 0,
  penalty_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'incomplete',     -- in_progress | completed
  submitted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(activity_id, student_id)
);

-- ============================================================
-- 6) PROGRAMMING CODE SAVES (auto-saved per problem per student)
-- ============================================================
CREATE TABLE IF NOT EXISTS programming_code_saves (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES programming_activities(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES programming_problems(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  language TEXT DEFAULT '',
  source_code TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(activity_id, problem_id, student_id)
);

-- ============================================================
-- 7) LIVE PROGRAMMING CONTESTS
--    REAL-TIME hosted coding contests: teacher opens a session
--    with a PIN, students join, host starts a shared countdown,
--    live leaderboard + anti-cheat (separate from the Quiz
--    live games - it never touches the quiz tables).
-- ============================================================

-- One contest session (host, activity, PIN)
CREATE TABLE IF NOT EXISTS prog_games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pin TEXT NOT NULL,
  activity_id UUID REFERENCES programming_activities(id) ON DELETE SET NULL,
  activity_title TEXT DEFAULT '',
  host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  duration_minutes INTEGER DEFAULT 30,
  penalty_points INTEGER DEFAULT 5,
  max_violations INTEGER DEFAULT 3,
  status TEXT DEFAULT 'waiting',          -- waiting | running | ended
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prog_games_pin ON prog_games(pin);

-- Students who joined a contest
CREATE TABLE IF NOT EXISTS prog_game_players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES prog_games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT DEFAULT '',
  violations INTEGER DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, user_id)
);

-- Live leaderboard rows (upserted as students score)
CREATE TABLE IF NOT EXISTS prog_game_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES prog_games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT DEFAULT '',
  total_score INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  problems_solved INTEGER DEFAULT 0,
  violations INTEGER DEFAULT 0,
  penalty_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'in_progress',      -- in_progress | submitted | completed
  updated_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE(game_id, user_id)
);

-- Anti-cheat violation log
CREATE TABLE IF NOT EXISTS prog_cheat_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES prog_games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Standalone (non-live) activities also track violations now
ALTER TABLE programming_results
  ADD COLUMN IF NOT EXISTS violations INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_points INTEGER DEFAULT 0;

-- ============================================================
-- 8) INDEXES (fast lookups during grading / live leaderboards)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pa_created  ON programming_activities(created_by);
CREATE INDEX IF NOT EXISTS idx_pp_activity ON programming_problems(activity_id);
CREATE INDEX IF NOT EXISTS idx_ptc_problem ON programming_test_cases(problem_id);
CREATE INDEX IF NOT EXISTS idx_ps_activity ON programming_submissions(activity_id);
CREATE INDEX IF NOT EXISTS idx_ps_problem  ON programming_submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_ps_student  ON programming_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_ptr_submission ON programming_test_results(submission_id);
CREATE INDEX IF NOT EXISTS idx_ptr_test_case   ON programming_test_results(test_case_id);
CREATE INDEX IF NOT EXISTS idx_pr_activity ON programming_results(activity_id);
CREATE INDEX IF NOT EXISTS idx_pr_student  ON programming_results(student_id);
CREATE INDEX IF NOT EXISTS idx_pcs_problem ON programming_code_saves(problem_id);
CREATE INDEX IF NOT EXISTS idx_pcs_student ON programming_code_saves(student_id);

CREATE INDEX IF NOT EXISTS idx_prog_games_host   ON prog_games(host_id);
CREATE INDEX IF NOT EXISTS idx_prog_games_status ON prog_games(status);
CREATE INDEX IF NOT EXISTS idx_pgp_game          ON prog_game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_pgr_game          ON prog_game_results(game_id);
CREATE INDEX IF NOT EXISTS idx_pcl_game          ON prog_cheat_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_pcl_user          ON prog_cheat_logs(user_id);

-- ============================================================
-- 9) SECURITY (matches the rest of the app: any authenticated
--    user reads/writes; identity is enforced in the UI by role)
-- ============================================================
ALTER TABLE programming_activities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_problems    ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_test_cases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_code_saves  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_games              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_game_players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_game_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_cheat_logs         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prog_activities_all"  ON programming_activities;
DROP POLICY IF EXISTS "prog_problems_all"    ON programming_problems;
DROP POLICY IF EXISTS "prog_tests_all"       ON programming_test_cases;
DROP POLICY IF EXISTS "prog_submissions_all" ON programming_submissions;
DROP POLICY IF EXISTS "prog_test_results_all" ON programming_test_results;
DROP POLICY IF EXISTS "prog_results_all"     ON programming_results;
DROP POLICY IF EXISTS "prog_saves_all"       ON programming_code_saves;
DROP POLICY IF EXISTS "prog_games_all"       ON prog_games;
DROP POLICY IF EXISTS "prog_players_all"     ON prog_game_players;
DROP POLICY IF EXISTS "prog_results_all"     ON prog_game_results;
DROP POLICY IF EXISTS "prog_cheatlogs_all"   ON prog_cheat_logs;

CREATE POLICY "prog_activities_all"  ON programming_activities  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_problems_all"    ON programming_problems    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_tests_all"       ON programming_test_cases  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_submissions_all" ON programming_submissions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_test_results_all" ON programming_test_results FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_results_all"     ON programming_results     FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_saves_all"       ON programming_code_saves  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_games_all"       ON prog_games              FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_players_all"     ON prog_game_players       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_results_all"     ON prog_game_results       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_cheatlogs_all"   ON prog_cheat_logs         FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 10) REALTIME (live contest updates + live leaderboard)
-- ============================================================
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['programming_activities','programming_problems','programming_test_cases',
                            'programming_submissions','programming_test_results','programming_results','programming_code_saves',
                            'prog_games','prog_game_players','prog_game_results','prog_cheat_logs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND tablename = t) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE ' || t;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- DONE! Next: hard-refresh the Programming pages
--   pages/programming/programming.html      (hub + join by PIN)
--   pages/programming/create-programming.html (teacher editor)
--   pages/programming/activity.html         (solve + contest mode)
--   pages/programming/live.html             (host panel)
--   pages/programming/results.html
-- ============================================================