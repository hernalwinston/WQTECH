// ============================================================
// PROGRAMMING LIVE CONTEST - SHARED BACKBONE
// ============================================================
// Hosted real-time coding contests, SEPARATE from the Quiz
// live games. Teachers open a session (PIN), students join by
// PIN, the host starts a shared countdown, and a LIVE
// leaderboard updates as students score on problems.
//
// Depends on (loaded elsewhere, in order):
//   supabase browser client (js/supabase-config.js)
//   Auth (js/auth.js)  -> Auth.currentUser { id }
//
// Everything here is exposed on window.ProgLive.
// ============================================================

window.ProgLive = (function () {
  const cx = (typeof supabaseClient !== 'undefined') ? supabaseClient : null;
  const uid = () => (Auth && Auth.currentUser && Auth.currentUser.id) || '';
  const name = () => (Auth && Auth.currentUser && Auth.currentUser.user_metadata &&
                      Auth.currentUser.user_metadata.name) || 'player';

  function genPin() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  // ------------------------------------------------------------------
  // HOST
  // ------------------------------------------------------------------
  async function createGame(opts) {
    if (!cx) throw new Error('Supabase not connected.');
    const data = opts || {};
    let pin = genPin();
    for (let i = 0; i < 6; i++) {
      const { data: hit } = await cx.from('prog_games').select('id').eq('pin', pin).maybeSingle();
      if (!hit) break;
      pin = genPin();
    }
    const { data: row, error } = await cx.from('prog_games').insert({
      pin,
      activity_id: data.activityId || null,
      activity_title: data.activityTitle || '',
      host_id: uid(),
      duration_minutes: parseInt(data.durationMinutes, 10) || 30,
      penalty_points: parseInt(data.penaltyPoints, 10) || 5,
      max_violations: parseInt(data.maxViolations, 10) || 3,
      status: 'waiting'
    }).select().single();
    if (error) throw error;
    return row;
  }

  async function getGame(id) {
    if (!cx) throw new Error('Supabase not connected.');
    const { data, error } = await cx.from('prog_games').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getGameByPin(pin) {
    if (!cx) throw new Error('Supabase not connected.');
    const { data, error } = await cx.from('prog_games')
      .select('*').eq('pin', String(pin).trim()).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function startGame(id) {
    if (!cx) throw new Error('Supabase not connected.');
    const { error } = await cx.from('prog_games').update({
      status: 'running', started_at: new Date().toISOString()
    }).eq('id', id);
    if (error) throw error;
  }

  async function endGame(id) {
    if (!cx) throw new Error('Supabase not connected.');
    const { error } = await cx.from('prog_games').update({
      status: 'ended', ended_at: new Date().toISOString()
    }).eq('id', id);
    if (error) throw error;
  }

  // ------------------------------------------------------------------
  // STUDENT JOIN
  // ------------------------------------------------------------------
  async function joinGame(pin) {
    const game = await getGameByPin(pin);
    if (!game) throw new Error('No live contest found for that PIN.');
    const user = uid();
    if (!user) throw new Error('You must be signed in.');
    if (game.status !== 'ended') {
      const { error: pe } = await cx.from('prog_game_players').upsert({
        game_id: game.id, user_id: user, player_name: name()
      }, { onConflict: 'game_id,user_id' });
      if (pe) throw pe;
      await cx.from('prog_game_results').upsert({
        game_id: game.id, user_id: user, player_name: name(),
        total_score: 0, total_points: 0, problems_solved: 0,
        violations: 0, penalty_points: 0, status: 'in_progress'
      }, { onConflict: 'game_id,user_id', ignoreDuplicates: true });
    }
    return game;
  }

  // Live score push - called whenever the student scores (after Check)
  // so the host sees progress in real time on the leaderboard.
  async function pushScore(gameId, opts) {
    if (!cx || !gameId || !uid()) return;
    const d = opts || {};
    await cx.from('prog_game_results').upsert({
      game_id: gameId, user_id: uid(), player_name: name(),
      total_score: Math.max(0, parseInt(d.total_score, 10) || 0),
      total_points: parseInt(d.total_points, 10) || 0,
      problems_solved: parseInt(d.problems_solved, 10) || 0,
      violations: parseInt(d.violations, 10) || 0,
      penalty_points: parseInt(d.penalty_points, 10) || 0,
      status: d.status || 'in_progress',
      updated_at: new Date().toISOString()
    }, { onConflict: 'game_id,user_id' }).then(null, () => {});
  }

  async function addViolation(gameId, reason) {
    if (!cx || !gameId || !uid()) return 0;
    const user = uid();
    let violations = 1;
    const { data: row } = await cx.from('prog_game_results')
      .select('violations, penalty_points')
      .eq('game_id', gameId).eq('user_id', user).maybeSingle();
    if (row) violations = (parseInt(row.violations, 10) || 0) + 1;
    const game = await getGame(gameId).catch(() => null);
    const penalty = (game && parseInt(game.penalty_points, 10)) || 5;
    const penaltyTotal = violations * penalty;
    await cx.from('prog_game_results').update({
      violations,
      penalty_points: penaltyTotal,
      updated_at: new Date().toISOString()
    }).eq('game_id', gameId).eq('user_id', user);
    await cx.from('prog_game_players').update({
      violations
    }).eq('game_id', gameId).eq('user_id', user);
    await cx.from('prog_cheat_logs').insert({
      game_id: gameId, user_id: user, player_name: name(), reason
    }).then(null, () => {});
    return violations;
  }

  // Final result stored when the student finishes / time runs out
  async function setFinal(gameId, opts) {
    if (!cx || !gameId || !uid()) return;
    const d = opts || {};
    await cx.from('prog_game_results').upsert({
      game_id: gameId, user_id: uid(), player_name: name(),
      total_score: Math.max(0, parseInt(d.total_score, 10) || 0),
      total_points: parseInt(d.total_points, 10) || 0,
      problems_solved: parseInt(d.problems_solved, 10) || 0,
      violations: parseInt(d.violations, 10) || 0,
      penalty_points: parseInt(d.penalty_points, 10) || 0,
      status: d.status || (d.completed ? 'completed' : 'submitted'),
      finished_at: new Date().toISOString()
    }, { onConflict: 'game_id,user_id' }).then(null, () => {});
  }

  // ------------------------------------------------------------------
  // HOST MONITORING (realtime + fallback reads)
  // ------------------------------------------------------------------
  function channel(id) {
    return 'plive-' + id;
  }
  function subscribeGame(id, cb) {
    if (typeof cx.channel !== 'function') return null;
    const ch = cx.channel(channel(id))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'prog_games', filter: 'id=eq.' + id },
        (p) => { if (cb) cb(p.new); })
      .subscribe();
    return ch;
  }
  function subscribeResults(gameId, cb) {
    if (typeof cx.channel !== 'function') return null;
    const ch = cx.channel('plive-res-' + gameId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'prog_game_results', filter: 'game_id=eq.' + gameId },
        () => { if (cb) cb(); })
      .subscribe();
    return ch;
  }
  function subscribeCheat(gameId, cb) {
    if (typeof cx.channel !== 'function') return null;
    const ch = cx.channel('plive-cheat-' + gameId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'prog_cheat_logs', filter: 'game_id=eq.' + gameId },
        (p) => { if (cb) cb(p.new); })
      .subscribe();
    return ch;
  }
  async function listPlayers(gameId) {
    const { data, error } = await cx.from('prog_game_players')
      .select('*').eq('game_id', gameId).order('joined_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function listResults(gameId) {
    const { data, error } = await cx.from('prog_game_results')
      .select('*').eq('game_id', gameId).order('total_score', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  async function listCheatLogs(gameId) {
    const { data, error } = await cx.from('prog_cheat_logs')
      .select('*').eq('game_id', gameId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  const remainingMs = (game) => {
    if (!game || game.status !== 'running' || !game.started_at || !game.duration_minutes) return null;
    return (new Date(game.started_at).getTime() + (game.duration_minutes * 60 * 1000)) - Date.now();
  };

  return {
    createGame, getGame, getGameByPin, startGame, endGame,
    joinGame, pushScore, addViolation, setFinal,
    subscribeGame, subscribeResults, subscribeCheat,
    listPlayers, listResults, listCheatLogs,
    remainingMs, uid, name
  };
})();