-- ============================================================
-- SEED: "C++ Basic Programming" - the spec's example activity
-- ============================================================
-- Creates the recommended demo the moment the tables exist:
--   Activity : C++ Basic Programming (15 min, 20 pts)
--   Problem  : Sum of N Integers (20 pts)
--   Test case: 4 samples (shown to students, included in grading)
--              2 hidden (never shown, included in grading)
--
--   Grading pool = 6 test cases -> 20 / 6 = 3 pts each + 2 pts
--   remainder -> the first two grading cases are worth 4 pts and
--   the rest 3 pts, summing to exactly 20. (Points are computed at
--   grade time by the runner; the test-case points column is unused.)
--
-- Safe to run at any time: skips everything if an activity with this
-- exact title already exists. Paste into Supabase SQL Editor -> Run.
-- ============================================================

DO $$
DECLARE
  act_id  UUID;
  prob_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM programming_activities WHERE title = 'C++ Basic Programming') THEN
    RAISE NOTICE 'Seed: activity "C++ Basic Programming" already exists - skipping.';
    RETURN;
  END IF;

  INSERT INTO programming_activities (title, description, language, time_limit_minutes, total_points, status)
  VALUES (
    'C++ Basic Programming',
    E'Solve the programming problems using C++. You may run your code freely, then check it against the hidden graders before you submit.',
    'C++',
    15,
    20,
    'published'
  )
  RETURNING id INTO act_id;

  INSERT INTO programming_problems (activity_id, question_number, title, description, input_format, output_format, starter_code, points)
  VALUES (
    act_id,
    1,
    'Sum of N Integers',
    E'Given N integers, write a program that calculates and prints the sum of all N integers.',
    E'The first line contains an integer N.\nThe second line contains N integers.',  -- Numeric range friendly for beginners.
    E'Print the sum of the N integers.',
    E'#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    int sum = 0;\n\n    cin >> n;\n\n    // Write your code here\n\n    cout << sum;\n\n    return 0;\n}\n',
    20
  )
  RETURNING id INTO prob_id;

  INSERT INTO programming_test_cases (problem_id, label, input, expected_output, is_sample, is_hidden, include_in_grading, sort_order)
  VALUES
    (prob_id, 'Sample 1', E'5\n10 20 30 40 50\n', E'150\n', true,  false, true, 0),
    (prob_id, 'Sample 2', E'4\n5 10 15 20\n',     E'50\n',  true,  false, true, 1),
    (prob_id, 'Sample 3', E'3\n7 8 9\n',          E'24\n',  true,  false, true, 2),
    (prob_id, 'Sample 4', E'6\n1 2 3 4 5 6\n',    E'21\n',  true,  false, true, 3),
    (prob_id, 'Hidden 1', E'5\n-5 10 -3 8 2\n',   E'12\n',  false, true,  true, 4),
    (prob_id, 'Hidden 2', E'1\n0\n',              E'0\n',   false, true,  true, 5);

  RAISE NOTICE 'Seed created activity % with problem %, 6 grading test cases.', act_id, prob_id;
END $$;