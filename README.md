Admin account
email: admin
password: admin123

---

# QuizBattle - Real-Time Quiz Game System (Supabase)

A complete quiz game system with admin dashboard, student registration, live games with real-time scoring, leaderboards, and reports. Fully powered by **Supabase** (auth + Postgres + realtime + storage) - no Firebase.

---

## Design

**White + Night Mode** — Clean, consistent interface with light and dark themes. Toggle between them with the switch in the navbar. The system automatically detects your OS preference on first visit and remembers your choice.

- **Light Mode:** Pure white background, glassmorphism cards, soft shadows
- **Dark Mode:** Deep black background, subtle purple glow on hover, dark glass cards
- **Accent:** Indigo (#6366F1) for all buttons, links, and highlights

The whole system shares one design language:

| Area | Stylesheet |
|------|-----------|
| All pages (nav, cards, buttons, forms) | `css/main.css` |
| Programming module (hub, create, activity, results) | `css/programming.css` |

---

## Features

- **Admin Panel** — Create quizzes (MCQ, True/False, Identification), manage users, host live games
- **Programming Platform** — Teachers publish coding activities (C, C++, C#, Java, Python); students solve, run and submit with sample + hidden test case grading
- **Live Programming Contests** — Teachers host real-time coding contests with a PIN, live leaderboard, and anti-cheat (fullscreen lock, tab/window-switch penalties, auto-lockout)
- **Student Dashboard** — Register, join games with PIN codes, view past results
- **Live Games** — Real-time quiz competition with timer, speed scoring, and leaderboard
- **Reports** — Export CSV reports of game results
- **Light/Dark Mode** — Persistent theme toggle with OS preference detection

---

## Setup (2 Steps)

### Step 1: Run the SQL
1. Go to your Supabase Dashboard
2. Click **SQL Editor**
3. **Want everything?** Paste `supabase/schema.sql` (one file → quiz + programming + live contests) and click **Run**
4. **Programming only?** Paste `supabase/programming.sql` (one file → activities, problems, grading, live contests) and click **Run**

> The `supabase/` folder has just 2 files:
> - `schema.sql` - ONE file for the WHOLE system (fresh install / everything)
> - `programming.sql` - ONE file for the Programming platform only (safe on existing DBs)

### Step 2: Turn Off Email Confirmation
1. Go to **Authentication > Providers > Email**
2. Turn **OFF** "Confirm email"
3. Click Save

### Step 3 (required): Deploy the secure code runner API to Vercel
Run/Check code goes through the **WQTech runner API** at `/api/programming-run` (`api/programming-run.js`), deployed together with this site on **Vercel**. It is the secure backend/adapter: it authenticates the caller, maps languages (C, C++, C#, Java, Python, JavaScript, TypeScript, Go, Rust, Ruby), talks to the execution provider server-side and normalizes results — the browser never calls a provider directly and no provider key is ever exposed to the frontend. **Supabase is used only for database / storage / authentication.**

```
vercel            # or: push the repo to GitHub and import it in Vercel
```

Make sure `SUPABASE_URL` is the same project the site already uses (`https://rknsbfykyulrejnbwjuf.supabase.co`).

Configure providers in **Vercel → Project → Settings → Environment Variables**:

- `SUPABASE_URL` — `https://rknsbfykyulrejnbwjuf.supabase.co` (used to verify the caller's JWT; required unless `RUNNER_SKIP_AUTH=1`)
- `RUNNER_PROVIDER` — `auto | piston | judge0` (default `auto`)
- `PISTON_BASE_URL` — e.g. `https://piston.your-domain.com/api/v2` (self-hosted Piston; the primary recommended provider — no cpu/memory limit params, so the old out-of-range HTTP 400 cannot happen)
- `JUDGE0_URL` — self-hosted Judge0 CE `http://host:2358/submissions`; if unset the public CE instance is used as the last-resort fallback with quota-safe clamped limits
- `JUDGE0_API_KEY` — Judge0 CE admin key (kept server-side only)
- `RUNNER_SKIP_AUTH` — leave unset in production (only `1` to allow unauthenticated calls during testing)

Sanity check after deploy: open `<your-vercel-url>/api/programming-run/health`.

Optionally run `supabase/seed-programming.sql` in the Supabase SQL Editor to create the "C++ Basic Programming" demo activity (Sum of N Integers, 20 pts, 4 samples + 2 hidden cases). Seed data is idempotent. No Supabase Edge Functions or CLI are required.

---

## How to Use

1. Open `index.html` in your browser
2. From the navbar area, log in as a student (register if new)
3. For admin: open `pages/setup-admin.html` to create an admin account (default: email `admin`, password `admin123`), then use the **Admin** tab on the landing page (access code: `admin123`)
4. Admin creates quizzes in the Quiz Manager tab
5. Admin starts a Live Game and shares the 6-digit PIN
6. Students join from their dashboard using the PIN
7. Questions are served in real-time with countdown timers
8. Scores are calculated based on correctness + speed
9. Leaderboards and reports are available after the game

### Live Programming Contests

1. Teacher opens **Programming Hub** and clicks **Host Live Contest**
2. Pick a published activity, configure the contest (duration, max violations), and create it — a 6-digit PIN is generated
3. Share the PIN; students go to **Programming Hub** and enter it in the **Join Live Contest** box (jumps straight into `activity.html?live=PIN`)
4. Students wait in the waiting room until the host starts the contest
5. While running, the student page enforces **fullscreen + stay-locked** anti-cheat: every tab/window switch or fullscreen exit adds a violation and deducts points; at the max violation count the contest locks and auto-submits
6. The host sees a live leaderboard (scores update per successful check) and a violation feed, with **+1 min** extend and **End Contest**
7. On end, final scores are stored per student in `programming_results` (with `violations` / `penalty_points`) and shown on the host's final board

---

## Files

```
quiz-system/
├── index.html              # Landing page (hero + features + footer)
├── supabase/
│   ├── schema.sql          # ONE file: whole system (quiz + programming + live contests)
│   └── programming.sql     # ONE file: programming platform only (safe to re-run)
├── css/
│   ├── main.css            # Complete design system (light/dark)
│   └── programming.css     # Programming module design system
├── js/
│   ├── supabase-config.js  # Supabase connection (URL + publishable key)
│   ├── theme.js            # Light/Dark mode toggle logic
│   ├── auth.js             # Student + admin authentication
│   ├── avatars.js          # Avatar picker data
│   ├── programming-shared.js # Programming module logic
│   ├── programming-live.js   # Live Contest logic (window.ProgLive)
│   └── utils.js            # Utility functions
├── images/
├── pages/
│   ├── register.html       # Student registration (2-step)
│   ├── setup-admin.html    # First-time admin setup
│   ├── dashboard.html      # Student dashboard
│   ├── profile.html        # Profile + avatar picker
│   ├── history.html        # Past results
│   ├── rankings.html       # Leaderboard rankings
│   ├── game.html           # Live game player view
│   ├── admin.html          # Admin panel (quiz builder, live game, reports)
│   └── programming/        # Programming platform
│       ├── programming.html         # Activity hub
│       ├── create-programming.html  # Teacher build/editor
│       ├── activity.html            # Student solve screen (split-screen IDE + live mode)
│       ├── live.html                # Teacher Live Contest host panel
│       └── results.html             # Results + submissions
└── assets/
    ├── images/             # Profile photos (e.g. me.jpg)
    └── avatars/            # Avatar SVGs (cat, dog, fox, ...)
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `user_profiles` | Student profiles (name, points) |
| `admins` | Admin/teacher accounts |
| `quizzes` | Quizzes with questions (JSONB) |
| `games` | Game sessions with PIN codes |
| `game_players` | Players joined to a game |
| `game_answers` | Individual answers per question |
| `game_groups` / `group_invites` | Group Mode teams in a lobby |
| `leaderboards` | Historical game results |
| `cheat_logs` / `banned` | Anti-cheat tracking |
| `programming_activities` | Programming exercise container |
| `programming_problems` | Individual coding problems |
| `programming_test_cases` | Sample + hidden grading cases |
| `programming_submissions` | Per-problem graded submissions |
| `programming_results` | Per-student activity roll-up |
| `programming_code_saves` | Auto-save / resume storage |
| `prog_games` | Live contest sessions with PIN codes |
| `prog_game_players` | Students joined to a live contest |
| `prog_game_results` | Live leaderboard entries (upserted per student) |
| `prog_cheat_logs` | Anti-cheat violations during contests |

---

## Supabase Connection

All files use this config from `js/supabase-config.js`:
```
URL:  https://rknsbfykyulrejnbwjuf.supabase.co
Key:  sb_publishable_1eOKsHa61pzfly5n4DMutg_hOpDQLMe
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Database error saving new user" | Drop all triggers in SQL Editor, re-run `supabase/schema.sql` |
| "Email not confirmed" | Turn off email confirmation in Authentication > Providers > Email |
| No quizzes showing | Run `supabase/schema.sql` first, then create quizzes in admin panel |
| Live game not updating | App uses polling (2s interval) - this is normal |
| Can't login as admin | Make sure you registered through `pages/setup-admin.html` first |