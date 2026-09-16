-- ============================================================
-- QUIZBATTLE - COMPLETE DATABASE (single file)
-- Paste ALL of this into Supabase SQL Editor -> Run
--
-- Creates EVERYTHING in one go:
--   Quiz system (quizzes, games, players, answers, leaderboards,
--   groups, anti-cheat) + Programming Platform (activities,
--   problems, test cases, submissions, results, code saves) +
--   Live Programming Contests (prog_games, prog_game_players,
--   prog_game_results, prog_cheat_logs).
--
-- Safe to run again anytime. A full reset wipes quizzes, games,
-- scores AND registered accounts, so any previously used email
-- can register again afterwards.
-- ============================================================

-- ============================================================
-- 1) CLEANUP OLD INSTALLATION
-- ============================================================
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT trigger_name FROM information_schema.triggers
           WHERE event_object_schema = 'auth' AND event_object_table = 'users' LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || r.trigger_name || ' ON auth.users CASCADE';
  END LOOP;
END $$;

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT routine_name FROM information_schema.routines
           WHERE routine_schema = 'public' AND routine_type = 'FUNCTION' LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS public.' || r.routine_name || '() CASCADE';
  END LOOP;
END $$;

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON ' || r.tablename;
  END LOOP;
END $$;

DROP TABLE IF EXISTS game_answers CASCADE;
DROP TABLE IF EXISTS game_players CASCADE;
DROP TABLE IF EXISTS group_invites CASCADE;
DROP TABLE IF EXISTS game_groups CASCADE;
DROP TABLE IF EXISTS leaderboards CASCADE;
DROP TABLE IF EXISTS cheat_logs CASCADE;
DROP TABLE IF EXISTS banned CASCADE;
DROP TABLE IF EXISTS games CASCADE;
DROP TABLE IF EXISTS quizzes CASCADE;
DROP TABLE IF EXISTS admins CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS programming_activities CASCADE;
DROP TABLE IF EXISTS programming_problems CASCADE;
DROP TABLE IF EXISTS programming_test_cases CASCADE;
DROP TABLE IF EXISTS programming_submissions CASCADE;
DROP TABLE IF EXISTS programming_results CASCADE;
DROP TABLE IF EXISTS programming_code_saves CASCADE;
DROP TABLE IF EXISTS prog_games CASCADE;
DROP TABLE IF EXISTS prog_game_players CASCADE;
DROP TABLE IF EXISTS prog_game_results CASCADE;
DROP TABLE IF EXISTS prog_cheat_logs CASCADE;

-- Delete ALL old accounts (fixes "User already registered").
-- Old avatar files stay in storage as harmless orphans - Supabase
-- blocks direct file deletion from SQL by design.
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.sessions;
DELETE FROM auth.identities;
DELETE FROM auth.users;

-- ============================================================
-- 2) TABLES
-- ============================================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT DEFAULT '',
  name TEXT NOT NULL,
  year_section TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  is_guest BOOLEAN DEFAULT false,
  total_points INTEGER DEFAULT 0,
  games_played INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE quizzes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pin TEXT NOT NULL,
  quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL,
  quiz_title TEXT DEFAULT '',
  host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  mode TEXT DEFAULT 'individual',
  group_size INTEGER DEFAULT 1,
  status TEXT DEFAULT 'waiting',
  shuffle_questions BOOLEAN DEFAULT false,
  questions_per_player INTEGER DEFAULT 0,
  shuffle_options BOOLEAN DEFAULT false,
  anti_cheat_penalty INTEGER DEFAULT 0,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_question INTEGER DEFAULT 0,
  question_started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  pause_total_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE game_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'My Group',
  leader_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE group_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES game_groups(id) ON DELETE CASCADE,
  from_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE TABLE game_players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT DEFAULT '',
  group_id UUID REFERENCES game_groups(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, user_id)
);

CREATE TABLE game_answers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL,
  answer TEXT,
  correct BOOLEAN DEFAULT false,
  score INTEGER DEFAULT 0,
  time_elapsed DOUBLE PRECISION DEFAULT 0,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, user_id, question_index)
);

CREATE TABLE leaderboards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_name TEXT DEFAULT '',
  quiz_title TEXT DEFAULT '',
  total_score INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  violation_points INTEGER DEFAULT 0,
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  played_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2b) PROGRAMMING PLATFORM (independent from the Quiz section)
--     Separate tables, separate pages. See UPDATE-PROGRAMMING.sql
--     for an idempotent upgrade path on existing databases.
-- ============================================================

-- Activity = teacher-created programming exercise container
CREATE TABLE programming_activities (
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

-- One problem belongs to one activity
CREATE TABLE programming_problems (
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

-- Sample cases are shown to the student; hidden cases only in grading
CREATE TABLE programming_test_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  problem_id UUID NOT NULL REFERENCES programming_problems(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  input TEXT DEFAULT '',
  expected_output TEXT DEFAULT '',
  points INTEGER DEFAULT 0,
  is_sample BOOLEAN DEFAULT false,
  is_hidden BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One row per (student, problem) grading run / saved submission
CREATE TABLE programming_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES programming_activities(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES programming_problems(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name TEXT DEFAULT '',
  language TEXT DEFAULT '',
  source_code TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',       -- pending | accepted | wrong_answer | compilation_error | runtime_error | time_limit_exceeded
  score INTEGER DEFAULT 0,            -- points earned on THIS problem (from test cases passed)
  max_score INTEGER DEFAULT 0,        -- total problem points
  sample_passed INTEGER DEFAULT 0,
  sample_total INTEGER DEFAULT 0,
  hidden_passed INTEGER DEFAULT 0,
  hidden_total INTEGER DEFAULT 0,
  test_results JSONB DEFAULT '[]'::jsonb,
  compile_output TEXT DEFAULT '',
  runtime_ms INTEGER DEFAULT 0,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

-- Per-activity student roll-up (final programming result)
CREATE TABLE programming_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES programming_activities(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name TEXT DEFAULT '',
  total_score INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  violations INTEGER DEFAULT 0,
  penalty_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'incomplete',   -- in_progress | completed
  submitted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(activity_id, student_id)
);

-- Auto-save / resume storage (student's code per problem)
CREATE TABLE programming_code_saves (
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
-- 2c) LIVE PROGRAMMING CONTESTS (separate from Quiz live games)
--     REAL-TIME hosted coding contests: teacher opens a session
--     with a PIN, students join, host starts a shared countdown,
--     live leaderboard + anti-cheat. See UPDATE-PROG-LIVE.sql
--     for an idempotent upgrade path on existing databases.
-- ============================================================

-- One contest session (host, activity, PIN)
CREATE TABLE prog_games (
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

CREATE UNIQUE INDEX idx_prog_games_pin ON prog_games(pin);

-- Students who joined a contest
CREATE TABLE prog_game_players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES prog_games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT DEFAULT '',
  violations INTEGER DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, user_id)
);

-- Live leaderboard rows (upserted as students score)
CREATE TABLE prog_game_results (
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
CREATE TABLE prog_cheat_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES prog_games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cheat_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  round_index INTEGER DEFAULT -1,
  points INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  given_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE banned (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  banned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  banned_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3) INDEXES (fast lookups during live games)
-- ============================================================
CREATE INDEX idx_quizzes_created_by   ON quizzes(created_by);
CREATE INDEX idx_games_host           ON games(host_id);
CREATE INDEX idx_games_pin            ON games(pin);
CREATE INDEX idx_games_status         ON games(status);
CREATE INDEX idx_players_game         ON game_players(game_id);
CREATE INDEX idx_players_user         ON game_players(user_id);
CREATE INDEX idx_answers_game         ON game_answers(game_id);
CREATE INDEX idx_answers_user         ON game_answers(user_id);
CREATE INDEX idx_leaderboards_user    ON leaderboards(user_id);
CREATE INDEX idx_leaderboards_game    ON leaderboards(game_id);
CREATE INDEX idx_cheat_logs_game      ON cheat_logs(game_id);
CREATE INDEX idx_cheat_logs_user      ON cheat_logs(user_id);
CREATE INDEX idx_groups_game          ON game_groups(game_id);
CREATE INDEX idx_invites_game         ON group_invites(game_id);
CREATE INDEX idx_invites_to           ON group_invites(to_user);
CREATE INDEX idx_players_group        ON game_players(group_id);

CREATE INDEX idx_pa_created     ON programming_activities(created_by);
CREATE INDEX idx_pp_activity    ON programming_problems(activity_id);
CREATE INDEX idx_ptc_problem    ON programming_test_cases(problem_id);
CREATE INDEX idx_ps_activity    ON programming_submissions(activity_id);
CREATE INDEX idx_ps_problem     ON programming_submissions(problem_id);
CREATE INDEX idx_ps_student     ON programming_submissions(student_id);
CREATE INDEX idx_pr_activity    ON programming_results(activity_id);
CREATE INDEX idx_pr_student     ON programming_results(student_id);
CREATE INDEX idx_pcs_problem    ON programming_code_saves(problem_id);
CREATE INDEX idx_pcs_student    ON programming_code_saves(student_id);

CREATE INDEX idx_prog_games_host   ON prog_games(host_id);
CREATE INDEX idx_prog_games_status ON prog_games(status);
CREATE INDEX idx_pgp_game          ON prog_game_players(game_id);
CREATE INDEX idx_pgr_game          ON prog_game_results(game_id);
CREATE INDEX idx_pcl_game          ON prog_cheat_logs(game_id);
CREATE INDEX idx_pcl_user          ON prog_cheat_logs(user_id);

-- ============================================================
-- 4) SECURITY RULES
-- ============================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_players  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_answers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboards  ENABLE ROW LEVEL SECURITY;
ALTER TABLE banned        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheat_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_problems       ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_test_cases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE programming_code_saves     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_games        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_game_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE prog_cheat_logs   ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone logged-in can see names; users manage their own
CREATE POLICY "profiles_read"   ON user_profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON user_profiles FOR UPDATE USING (auth.uid() = id);

-- Admins list: visible to logged-in users, created during admin setup
CREATE POLICY "admins_read"   ON admins FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admins_insert" ON admins FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Quiz gameplay data: full access for logged-in users
CREATE POLICY "quizzes_all"      ON quizzes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "games_all"        ON games FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "players_all"      ON game_players FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "answers_all"      ON game_answers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "leaderboards_all" ON leaderboards FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "banned_all"       ON banned FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "cheat_logs_all"   ON cheat_logs FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "groups_all"       ON game_groups FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "invites_all"      ON group_invites FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "pa_all"    ON programming_activities   FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "pp_all"    ON programming_problems     FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "ptc_all"   ON programming_test_cases   FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "ps_all"    ON programming_submissions  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "pr_all"    ON programming_results      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "pcs_all"   ON programming_code_saves   FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_games_all"    ON prog_games        FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_players_all"  ON prog_game_players FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_results_all"  ON prog_game_results FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "prog_cheatlogs_all" ON prog_cheat_logs  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- 5) REALTIME (live quiz updates: start / pause / next / end)
-- ============================================================
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['games','game_players','game_answers','game_groups','group_invites',
                            'programming_activities','programming_problems','programming_test_cases',
                            'programming_submissions','programming_results','programming_code_saves',
                            'prog_games','prog_game_players','prog_game_results','prog_cheat_logs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND tablename = t) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE ' || t;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 6) AVATAR STORAGE (profile pictures)
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Avatar upload" ON storage.objects;
CREATE POLICY "Avatar upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Avatar read" ON storage.objects;
CREATE POLICY "Avatar read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');

-- ============================================================
-- DONE! Next steps:
--   1. Open pages/setup-admin.html
--   2. Register your admin account (any email works fresh)
--   3. Log in on the landing page (index.html home screen) and create a quiz
--   4. Programming Hub -> Host Live Contest (teacher) for contests
-- ============================================================
