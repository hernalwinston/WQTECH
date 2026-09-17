// ============================================================
// game.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    let gamePin='', gameId=null, gameData=null, currentQIndex=0, questionStartTime=null;
    let timerInterval=null, hasAnswered=false, myScore=0, gamePollInterval=null;
    let previousGameStatus=null, previousQuestionIndex=-1, currentVisibleState='joining';
    let myQuestions=null, savedHasAnswered=false, lastViolationAt=0, pingInterval=null;
    let quizJoined=false, violationCount=0, localQIndex=-1, activeTimeLimit=20, realtimeChannel=null;
    let groupPollInterval=null, myCurrentGroup=null, myGroupLeader=false;

    // ---------- CONNECTION STATUS (online/offline + ping ms) ----------
    function updateConnUI(online, ms) {
      const dot = document.getElementById('connDot'), txt = document.getElementById('connText'), ping = document.getElementById('connPing');
      if (!online) { dot.style.background = '#EF4444'; txt.textContent = 'Offline'; ping.textContent = ''; return; }
      dot.style.background = '#22C55E'; txt.textContent = 'Online';
      if (ms == null) { ping.textContent = ''; return; }
      ping.textContent = ms + ' ms';
      ping.style.color = ms < 150 ? '#22C55E' : ms < 400 ? '#F59E0B' : '#EF4444';
    }

    async function measurePing() {
      if (!navigator.onLine) { updateConnUI(false); return; }
      const t0 = performance.now();
      try {
        await fetch(SUPABASE_URL + '/rest/v1/', { method: 'HEAD', cache: 'no-store' });
        updateConnUI(true, Math.round(performance.now() - t0));
      } catch (e) { updateConnUI(false); }
    }

    function startConnMonitor() {
      window.addEventListener('online', () => { updateConnUI(true); measurePing(); });
      window.addEventListener('offline', () => updateConnUI(false));
      measurePing();
      pingInterval = setInterval(measurePing, 8000);
    }

    // ---------- FULLSCREEN SECURITY (required after joining) ----------
    function isFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    }

    function fsSupported() {
      const el = document.documentElement;
      return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
    }

    function enterQuizFullscreen() {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.msRequestFullscreen) el.msRequestFullscreen();
    }

    function quizOver() {
      return !gameData || gameData.status === 'ended' || currentVisibleState === 'ended' || currentVisibleState === 'joining';
    }

    function quizLive() { return quizJoined && !quizOver(); }

    // The gate blocks the whole page whenever fullscreen is required but not active
    function refreshFsGate() {
      const need = quizLive() && fsSupported() && !isFullscreen();
      document.getElementById('fsGate').classList.toggle('active', need);
      document.body.classList.toggle('quiz-secure', quizLive());
    }

    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(ev =>
      document.addEventListener(ev, () => {
        refreshFsGate();
        if (!isFullscreen() && gameData && gameData.status === 'answering') {
          registerViolation('Exited fullscreen during a question');
        }
      })
    );

    // ---------- ANTI-CHEAT VIOLATIONS ----------
    function registerViolation(reason) {
      const now = Date.now();
      if (now - lastViolationAt < 3000 || hasAnswered) return;
      lastViolationAt = now;
      violationCount++;
      const penalty = parseInt(gameData && gameData.anti_cheat_penalty) || 0;
      myScore = Math.max(0, myScore - penalty);
      Utils.showToast(`Warning ${violationCount}: ${reason}. This violation was recorded.`, 'error');
      if (!penalty || !gameId) return;
      supabaseClient.from('cheat_logs').insert([{ game_id: gameId, user_id: Auth.currentUser.id, round_index: currentQIndex, points: -penalty, reason }]).then(null, e => console.error(e));
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Browsers throttle timers in background tabs - catch up instantly on return
        if (gameId && quizJoined) pollOnce(gameId).catch(() => {});
        return;
      }
      if (gameData && gameData.status === 'answering' && !hasAnswered && gameId) {
        registerViolation('Left the quiz tab during a question');
      }
    });

    // Alt-tab / window switch detection
    window.addEventListener('blur', () => {
      setTimeout(() => {
        if (!document.hasFocus() && gameData && gameData.status === 'answering' && !hasAnswered) {
          registerViolation('Left the quiz window during a question');
        }
      }, 400);
    });

    // ---------- SECURE MODE HARDENING ----------
    document.addEventListener('contextmenu', e => { if (quizLive()) e.preventDefault(); });

    document.addEventListener('copy', e => {
      if (quizLive() && gameData && gameData.status === 'answering') { e.preventDefault(); Utils.showToast('Copying is disabled during the quiz', 'error'); }
    });
    document.addEventListener('cut', e => {
      if (quizLive() && gameData && gameData.status === 'answering') { e.preventDefault(); }
    });
    document.addEventListener('paste', e => {
      if (quizLive() && gameData && gameData.status === 'answering') { e.preventDefault(); Utils.showToast('Pasting is disabled during the quiz', 'error'); }
    });

    // This student's personal version of the quiz (Set A / Set B / Set C...)
    // Seeded by game+user so refresh/rejoin always shows the SAME set and order.
    // Round N = question N of MY OWN set: every student answers every round,
    // just a different question than their classmates (anti-cheat by design).
    function getMyQuestions() {
      if (myQuestions) return myQuestions;
      const all = (gameData && gameData.questions) || [];
      let list = all.slice();
      if (gameData && gameData.shuffle_questions) list = Utils.seededShuffle(list, Utils.seededRandom(gameId + '|' + Auth.currentUser.id));
      const n = parseInt(gameData && gameData.questions_per_player) || 0;
      if (n > 0 && n < list.length) list = list.slice(0, n);
      myQuestions = list;
      return myQuestions;
    }

    // My position for this round: the round number IS the position in my set.
    // (-1 only as a safety net if a round exceeds my set size)
    function localIndexFor(globalIdx) {
      const n = getMyQuestions().length;
      return globalIdx >= 0 && globalIdx < n ? globalIdx : -1;
    }

    // Shuffled display order for MCQ choices (per student, per question)
    function getDisplayOptions(q, roundIdx) {
      const items = q.options.map((o, i) => ({ text: o, orig: i }));
      if (!gameData || !gameData.shuffle_options || q.type !== 'mcq') return items;
      return Utils.seededShuffle(items, Utils.seededRandom(gameId + '|' + Auth.currentUser.id + '|q' + roundIdx));
    }

    document.addEventListener('DOMContentLoaded', async () => {
      startConnMonitor();
      const user = await Auth.init();
      if (!user) { window.location.href = '../index.html'; return; }
      gamePin = new URLSearchParams(window.location.search).get('code');
      if (!gamePin) {
        document.documentElement.classList.remove('auth-gate');
        document.getElementById('state-joining').innerHTML = '<div class="waiting-screen"><h2>No Game Code</h2><p style="margin-bottom:20px;">Please join from the dashboard.</p><button class="btn btn-primary" onclick="window.location.href=\'dashboard.html\'">Go to Dashboard</button></div>';
        return;
      }
      await joinGame(user.id);
      document.documentElement.classList.remove('auth-gate');
    });

    async function joinGame(uid) {
      try {
        const { data: game, error } = await supabaseClient.from('games').select('*').eq('pin', gamePin).limit(1).maybeSingle();
        if (error || !game) {
          document.getElementById('state-joining').innerHTML = `<div class="waiting-screen"><h2>Game Not Found</h2><p style="margin-bottom:20px;">Code "${gamePin}" didn't match.</p><button class="btn btn-primary" onclick="window.location.href='dashboard.html'">Back to Dashboard</button></div>`;
          return;
        }
        gameId = game.id; gameData = game;
        previousGameStatus = game.status;
        previousQuestionIndex = game.current_question;

        const { data: banned } = await supabaseClient.from('banned').select('*').eq('user_id', uid).maybeSingle();
        if (banned) { Utils.showToast('You have been banned', 'error'); return; }

        let { data: ud } = await supabaseClient.from('user_profiles').select('*').eq('id', uid).maybeSingle();
        if (!ud) {
          const stored = JSON.parse(localStorage.getItem('qb_profile') || '{}');
          const name = stored.name || Auth.currentUser?.user_metadata?.name || 'Player';
          await supabaseClient.from('user_profiles').upsert({ id: uid, name, is_guest: true, total_points: 0, games_played: 0 }, { onConflict: 'id', ignoreDuplicates: true });
          const { data: r } = await supabaseClient.from('user_profiles').select('*').eq('id', uid).maybeSingle();
          ud = r;
        }
        if (!ud) { Utils.showToast('Error loading profile', 'error'); return; }

        await supabaseClient.from('game_players').upsert({ game_id: gameId, user_id: uid, player_name: ud.name });
        document.getElementById('myName').textContent = ud.name;

        // Joined via code - fullscreen security is now mandatory
        quizJoined = true;
        refreshFsGate();

        // Build my personal set NOW so the first question renders instantly
        try { getMyQuestions(); } catch (e) { console.error(e); }

        processGameState(game);
        startGamePolling(gameId);
        startRealtime(gameId);
      } catch (e) { console.error(e); Utils.showToast('Error joining game', 'error'); }
    }

    // Polling loop - fires IMMEDIATELY then every second, so admin actions
    // (start / pause / next question) reach players with no perceived delay.
    function pollOnce(gid) {
      return supabaseClient.from('games').select('*').eq('id', gid).single()
        .then(({ data, error }) => {
          if (error || !data) return;
          gameData = data;
          processGameState(data);
        });
    }

    function startGamePolling(gid) {
      if (gamePollInterval) clearInterval(gamePollInterval);
      pollOnce(gid);
      gamePollInterval = setInterval(() => pollOnce(gid).catch(e => console.error('Poll error:', e)), 1000);
    }

    // Instant push updates from the server (pause / next question / end) - polling stays as backup
    function startRealtime(gid) {
      if (realtimeChannel || typeof supabaseClient.channel !== 'function') return;
      try {
        realtimeChannel = supabaseClient.channel('game-' + gid)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: 'id=eq.' + gid }, payload => {
            if (payload && payload.new) { gameData = payload.new; processGameState(payload.new); }
          })
          .subscribe();
      } catch (e) { console.warn('Realtime unavailable, using polling only', e); }
    }

    function stopRealtime() {
      if (realtimeChannel && typeof supabaseClient.removeChannel === 'function') {
        try { supabaseClient.removeChannel(realtimeChannel); } catch (e) {}
      }
      realtimeChannel = null;
    }

    function processGameState(d) {
      if (d.status === 'ended') { showEndScreen(); return; }

      if ((d.status === 'answering' || d.status === 'active') && d.current_question != null) {
        const qIdx = d.current_question;
        if (currentVisibleState === 'paused') {
          // Resuming after a pause - continue the SAME round where it left off
          currentQIndex = qIdx;
          enterRoundAfterPause();
        } else if ((currentVisibleState !== 'question' && currentVisibleState !== 'roundwait' && currentVisibleState !== 'feedback') || qIdx !== currentQIndex) {
          enterRound(qIdx);
        } else {
          currentQIndex = qIdx;
        }
      } else if (d.status === 'paused') {
        if (currentVisibleState !== 'paused') {
          // Freeze everything immediately: stop the countdown, remember progress
          if (currentVisibleState === 'question') { savedHasAnswered = hasAnswered; hasAnswered = true; clearInterval(timerInterval); }
          showState('paused');
          currentVisibleState = 'paused';
        }
      } else if (d.status === 'feedback') {
        if (currentVisibleState !== 'feedback' && currentVisibleState !== 'roundwait') {
          showState('feedback');
          currentVisibleState = 'feedback';
          showFeedbackFromServer();
        }
      } else if (d.status === 'waiting') {
        if (currentVisibleState !== 'waiting') {
          showState('waiting');
          currentVisibleState = 'waiting';
        }
        if (d.mode === 'group') showGroupPanel();
        else if (groupPollInterval) { stopGroupPoll(); document.getElementById('groupPanel').style.display = 'none'; }
        return;
      }
      stopGroupPoll();
      refreshFsGate();
    }

    // ------------------------------------------------------------
    // GROUP FINDER — lobby team-up before the game (group mode only)
    // ------------------------------------------------------------
    function stopGroupPoll() { if (groupPollInterval) { clearInterval(groupPollInterval); groupPollInterval = null; } }

    async function showGroupPanel() {
      const panel = document.getElementById('groupPanel');
      if (!panel) return;
      panel.style.display = 'block';
      const groupSize = parseInt(gameData && gameData.group_size) || 2;
      const uid = Auth.currentUser.id;
      const firstRun = !groupPollInterval;
      if (firstRun) {
        groupPollInterval = setInterval(renderGroupPanel, 1500);
      }
      await renderGroupPanel();
    }

    async function renderGroupPanel() {
      const panel = document.getElementById('groupPanel');
      if (!panel) return;
      const uid = Auth.currentUser.id;
      const gid = gameId;
      const groupSize = parseInt(gameData && gameData.group_size) || 2;

      // my membership + all groups + everyone in the lobby
      let myRow = null, players = [], allGroups = [], incoming = [];
      try {
        const [myRes, playersRes, groupsRes] = await Promise.all([
          supabaseClient.from('game_players').select('*').eq('game_id', gid).eq('user_id', uid).maybeSingle(),
          supabaseClient.from('game_players').select('*').eq('game_id', gid),
          supabaseClient.from('game_groups').select('*').eq('game_id', gid)
        ]);
        myRow = myRes.data;
        players = playersRes.data || [];
        allGroups = groupsRes.data || [];
        const { data: inv } = await supabaseClient.from('group_invites').select('*').eq('game_id', gid).eq('to_user', uid).eq('status', 'pending');
        incoming = inv || [];
      } catch (e) { return; }

      myCurrentGroup = (myRow && myRow.group_id) ? allGroups.find(g => g.id === myRow.group_id) : null;
      myGroupLeader = !!myCurrentGroup && myCurrentGroup.leader_id === uid;

      const membersOf = (gid2) => allGroups.find(g => g.id === gid2);
      const myMembers = myCurrentGroup ? players.filter(p => p.group_id === myCurrentGroup.id) : [];
      const myFull = myCurrentGroup && myMembers.length >= groupSize;

      let h = '';
      h += `<h4>Find Your Group <span class="group-size-pill">Teams of ${groupSize}</span></h4>`;
      h += `<p class="gp-sub">Answer individually — your team's score is the sum of everyone's points.</p>`;

      // Current group status
      if (myCurrentGroup) {
        if (myFull) h += '<div class="group-full-note">✓ Your group is complete. Look out for the leaderboard!</div>';
        h += '<div class="group-members">';
        myMembers.forEach((m, i) => {
          const isLeader = myCurrentGroup.leader_id === m.user_id;
          h += `<span class="group-member-chip ${isLeader ? 'leader' : ''}">${isLeader ? '👑 ' : ''}${Utils.sanitize(m.player_name)}${m.user_id === uid ? ' <strong>(you)</strong>' : ''}</span>`;
        });
        h += '</div>';
      } else {
        h += '<div class="group-members"><span class="group-member-chip" style="border-style:dashed;">You haven\'t joined a group yet</span></div>';
      }

      // Incoming invites (accept / decline)
      if (incoming.length) {
        h += '<div class="group-invites"><div class="gi-title">You have an invitation</div>';
        for (const inv of incoming) {
          const fromRow = players.find(p => p.user_id === inv.from_user);
          const fromName = fromRow ? fromRow.player_name : 'A player';
          h += `<div class="group-invite-card"><span><strong>${Utils.sanitize(fromName)}</strong> invited you to their group</span>
            <span class="gi-actions">
              <button class="btn btn-success btn-sm" onclick="respondToInvite('${inv.id}', true)">Accept</button>
              <button class="btn btn-outline btn-sm" onclick="respondToInvite('${inv.id}', false)">Decline</button>
            </span></div>`;
        }
        h += '</div>';
      }

      // Create / invite panel
      h += '<div class="gi-title" style="font-size:0.8rem; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-secondary); margin-bottom:8px;">Invite a player</div>';
      h += '<div class="group-players">';
      for (const p of players) {
        if (p.user_id === uid) continue;
        const inMyGroup = p.group_id && myCurrentGroup && p.group_id === myCurrentGroup.id;
        const pGroup = p.group_id ? membersOf(p.group_id) : null;
        const pGroupMembers = pGroup ? players.filter(x => x.group_id === pGroup.id) : [];
        const pFull = pGroup && pGroupMembers.length >= groupSize;
        const invBtn = myFull
          ? '<button class="btn btn-sm" disabled>Full</button>'
          : inMyGroup
            ? '<span style="font-size:0.75rem; color:var(--success);">In your group</span>'
            : pFull
              ? '<button class="btn btn-sm" disabled>Group full</button>'
              : `<button class="btn btn-primary btn-sm" onclick="inviteToMyGroup('${p.user_id}')">Invite</button>`;
        h += `<div class="group-player-row ${inMyGroup ? 'in-my-group' : ''}"><span class="group-player-name"><span class="initial-avatar">${Utils.sanitize(p.player_name).charAt(0).toUpperCase()}</span>${Utils.sanitize(p.player_name)}</span>${invBtn}</div>`;
      }
      h += '</div>';

      // If no group yet → start one
      if (!myCurrentGroup) {
        h += `<div class="group-actions"><button class="btn btn-primary" onclick="createMyGroup()">+ Start a Group</button></div>`;
      } else if (!myFull) {
        h += `<div class="group-actions"><span style="font-size:0.8rem; color:var(--text-muted);">Share the quiz PIN — teammates join and you invite them above.</span></div>`;
      }

      panel.innerHTML = h;
    }

    async function createMyGroup() {
      if (myCurrentGroup || !gameId) return;
      try {
        const { data: pr } = await supabaseClient.from('game_players').select('id,player_name').eq('game_id', gameId).eq('user_id', Auth.currentUser.id).maybeSingle();
        await supabaseClient.from('game_groups').insert([{ game_id: gameId, name: 'My Group', leader_id: Auth.currentUser.id }]);
        const { data: g } = await supabaseClient.from('game_groups').select('*').eq('game_id', gameId).eq('leader_id', Auth.currentUser.id).single();
        if (pr && g) {
          await supabaseClient.from('game_players').update({ group_id: g.id }).eq('id', pr.id);
          myCurrentGroup = g; myGroupLeader = true;
        }
        Utils.showToast('Group created! Now invite a teammate.', 'success');
        await renderGroupPanel();
      } catch (e) { Utils.showToast('Could not create group', 'error'); }
    }

    async function inviteToMyGroup(targetUid) {
      if (!gameId || targetUid === Auth.currentUser.id) return;
      try {
        if (!myCurrentGroup) { await createMyGroup(); if (!myCurrentGroup) return; }
        const { data: me } = await supabaseClient.from('game_players').select('*').eq('game_id', gameId).eq('user_id', Auth.currentUser.id).maybeSingle();
        if (!me || !me.group_id) return Utils.showToast('Join or start a group first', 'error');
        const { data: gs } = await supabaseClient.from('game_groups').select('*').eq('id', me.group_id).single();
        const { data: members } = await supabaseClient.from('game_players').select('*').eq('game_id', gameId).eq('group_id', me.group_id);
        const groupSize = parseInt(gameData && gameData.group_size) || 2;
        if (members && members.length >= groupSize) return Utils.showToast('Your group is full', 'error');
        // cancel any old pending invite between us, then send a fresh one
        await supabaseClient.from('group_invites').delete().eq('game_id', gameId).eq('from_user', Auth.currentUser.id).eq('to_user', targetUid).eq('status', 'pending');
        const { error } = await supabaseClient.from('group_invites').insert([{ game_id: gameId, group_id: me.group_id, from_user: Auth.currentUser.id, to_user: targetUid, status: 'pending' }]);
        if (error) throw error;
        Utils.showToast('Invitation sent!', 'success');
        await renderGroupPanel();
      } catch (e) { Utils.showToast('Failed to send invite', 'error'); }
    }

    async function respondToInvite(inviteId, accept) {
      if (!inviteId) return;
      try {
        const { data: inv } = await supabaseClient.from('group_invites').select('*').eq('id', inviteId).maybeSingle();
        if (!inv) return;
        await supabaseClient.from('group_invites').update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() }).eq('id', inviteId);
        if (accept) {
          const { data: members } = await supabaseClient.from('game_players').select('*').eq('game_id', gameId).eq('group_id', inv.group_id);
          const groupSize = parseInt(gameData && gameData.group_size) || 2;
          if (members && members.length >= groupSize) { Utils.showToast('That group is already full', 'error'); return; }
          const { data: me } = await supabaseClient.from('game_players').select('id').eq('game_id', gameId).eq('user_id', Auth.currentUser.id).maybeSingle();
          await supabaseClient.from('game_players').update({ group_id: inv.group_id }).eq('id', me.id);
          Utils.showToast('You joined the group!', 'success');
        } else {
          Utils.showToast('Invitation declined', 'info');
        }
        await renderGroupPanel();
      } catch (e) { Utils.showToast('Could not respond to invite', 'error'); }
    }

    function lockAnswerUI() {
      document.querySelectorAll('.option-btn').forEach(b => b.classList.add('disabled'));
      const inp = document.getElementById('idInput');
      if (document.getElementById('identificationInput').style.display !== 'none') inp.disabled = true;
    }

    function showState(s) {
      document.querySelectorAll('.game-state').forEach(el => el.classList.remove('active'));
      document.getElementById(`state-${s}`).classList.add('active');
      document.getElementById('gamePage').classList.toggle('timer-active', s === 'question');
      refreshFsGate();
    }

    // A new server round started. If the question is part of this student's set,
    // show it with LOCAL numbering (e.g. 3 of 5). Otherwise wait gracefully.
    function enterRound(globalIdx) {
      currentQIndex = globalIdx;
      localQIndex = localIndexFor(globalIdx);
      if (localQIndex === -1) {
        clearInterval(timerInterval);
        showState('roundwait');
        currentVisibleState = 'roundwait';
        return;
      }
      hasAnswered = false;
      savedHasAnswered = false;
      showState('question');
      currentVisibleState = 'question';
      const myQs = getMyQuestions();
      const q = myQs[localQIndex];
      if (!q) return;
      document.getElementById('qNumber').textContent = localQIndex + 1;
      document.getElementById('qTotal').textContent = myQs.length;
      document.getElementById('qText').textContent = q.text;
      const chip = document.getElementById('answeredChip');
      chip.style.display = 'none'; chip.classList.remove('timeout-chip');
      const img = document.getElementById('qImage');
      if (q.imageUrl) { img.src = q.imageUrl; img.style.display = 'block'; } else { img.style.display = 'none'; }

      if (q.type === 'mcq') {
        const g = document.getElementById('mcqOptions'); g.innerHTML = ''; g.style.display = 'grid'; g.style.gridTemplateColumns = '';
        document.getElementById('identificationInput').style.display = 'none';
        const L = ['A','B','C','D'];
        getDisplayOptions(q, currentQIndex).forEach((o, pos) => { g.innerHTML += `<button class="option-btn" onclick="submitMCQ(${o.orig}, ${pos})" id="opt-${pos}"><span class="option-label">${L[pos]}</span>${Utils.sanitize(o.text)}</button>`; });
      } else if (q.type === 'truefalse') {
        const g = document.getElementById('mcqOptions'); g.innerHTML = ''; g.style.display = 'grid'; g.style.gridTemplateColumns = '1fr 1fr';
        document.getElementById('identificationInput').style.display = 'none';
        g.innerHTML = '<button class="option-btn" onclick="submitMCQ(0, 0)" id="opt-0"><span class="option-label">A</span>True</button><button class="option-btn" onclick="submitMCQ(1, 1)" id="opt-1"><span class="option-label">B</span>False</button>';
      } else if (q.type === 'identification') {
        document.getElementById('mcqOptions').style.display = 'none'; document.getElementById('mcqOptions').innerHTML = '';
        const inp = document.getElementById('idInput');
        inp.disabled = false;
        document.getElementById('identificationInput').style.display = 'block';
        inp.value = '';
        setTimeout(() => inp.focus(), 100);
      }
      questionStartTime = Date.now(); startGameTimer(q.timeLimit); refreshFsGate();
    }

    function enterRoundAfterPause() {
      localQIndex = localIndexFor(currentQIndex);
      if (localQIndex === -1) {
        clearInterval(timerInterval);
        showState('roundwait');
        currentVisibleState = 'roundwait';
        return;
      }
      showState('question');
      currentVisibleState = 'question';
      if (savedHasAnswered) {
        hasAnswered = true; lockAnswerUI();
      } else {
        hasAnswered = false;
        // Resume the SAME round clock - keep the original local start so the
        // countdown continues from the remaining time (pause time is already
        // folded into pause_total_ms by the server on resume).
        const q = getMyQuestions()[localQIndex];
        startGameTimer(q ? q.timeLimit : 20);
      }
      savedHasAnswered = false;
    }

    // Countdown uses the LOCAL round start (set to the question's configured
    // limit on enterRound), so every player's timer always begins at exactly
    // the same number the teacher set - never skewed by device clock drift.
    // Server timestamps are only a fallback when no local start exists yet.
    // Pausing stays correct because pause_total_ms / paused_at are subtracted
    // on every tick, and the admin timer bounds the round anyway.
    function questionElapsedSec() {
      let startedAt = questionStartTime;
      if (startedAt == null && gameData && gameData.question_started_at) {
        const t = new Date(gameData.question_started_at).getTime();
        if (!isNaN(t)) startedAt = t;
      }
      if (!startedAt) return null;
      const pausedMs = (gameData && gameData.pause_total_ms) || 0;
      const livePausedMs = (gameData && gameData.status === 'paused' && gameData.paused_at)
        ? Math.max(0, Date.now() - new Date(gameData.paused_at).getTime()) : 0;
      return Math.max(0, (Date.now() - startedAt - pausedMs - livePausedMs) / 1000);
    }

    function remainingSec() {
      const el = questionElapsedSec();
      if (el == null) return activeTimeLimit;
      return Math.max(0, Math.ceil(activeTimeLimit - el));
    }

    // Countdown keeps running to zero even after the player answers.
    // Once answered, the circle locks to accent color and shows when they locked in.
    function startGameTimer(sec) {
      activeTimeLimit = parseInt(sec) || 20;
      clearInterval(timerInterval);
      const el = document.getElementById('gameTimer');
      el.className = hasAnswered ? 'timer-circle timer-locked' : 'timer-circle timer-green';
      const tick = () => {
        if (gameData && gameData.status === 'paused') return; // hard freeze while paused
        const r = remainingSec();
        el.textContent = Math.max(0, r);
        if (r <= 0) {
          clearInterval(timerInterval);
          el.textContent = 0;
          document.getElementById('idInput').disabled = true;
          if (!hasAnswered) { hasAnswered = true; submitAnswer(null, true); }
          else { el.className = 'timer-circle timer-locked'; }
          return;
        }
        if (hasAnswered) {
          el.className = 'timer-circle timer-locked';
        } else {
          if (r <= 10) el.className = 'timer-circle timer-yellow';
          if (r <= 5) el.className = 'timer-circle timer-red';
        }
      };
      tick();
      timerInterval = setInterval(tick, 400);
    }

    function markAnswered(te, isTimeout) {
      const el = document.getElementById('gameTimer');
      if (el && currentVisibleState === 'question') el.className = 'timer-circle timer-locked';
      const chip = document.getElementById('answeredChip');
      if (chip && currentVisibleState === 'question') {
        chip.textContent = isTimeout ? "Time's up! No answer submitted" : `You answered at ${Math.max(0, te).toFixed(1)}s`;
        chip.classList.toggle('timeout-chip', !!isTimeout);
        chip.style.display = 'block';
      }
    }

    async function submitMCQ(orig, pos) {
      if (hasAnswered) return; hasAnswered = true;
      document.querySelectorAll('.option-btn').forEach(b => b.classList.add('disabled'));
      document.getElementById(`opt-${pos}`).classList.add('selected');
      await submitAnswer(orig, false);
    }

    async function submitIdentification() {
      if (hasAnswered) return;
      const a = document.getElementById('idInput').value.trim(); if (!a) return;
      hasAnswered = true; document.getElementById('idInput').disabled = true;
      await submitAnswer(a, false);
    }

    // Enter submits identification answers, A-D keys pick MCQ / True-False options
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (e.ctrlKey && k === 'u')) {
        if (quizLive()) { e.preventDefault(); return; }
      }
      if (!quizLive() || hasAnswered) return;
      if (e.key === 'Enter') {
        const el = document.getElementById('idInput');
        if (el && el.offsetParent !== null) submitIdentification();
        return;
      }
      const opts = document.getElementById('mcqOptions');
      if (currentVisibleState === 'question' && opts && opts.style.display !== 'none') {
        const map = { a: 0, b: 1, c: 2, d: 3 };
        const idx = map[k];
        if (idx != null) {
          const btn = document.getElementById('opt-' + idx);
          if (btn && !btn.classList.contains('disabled')) btn.click();
        }
      }
    });

    // Instant answer feedback: green "+100" when correct, red "0" when wrong
    function showScoreFlash(value, ok) {
      const p = document.createElement('div');
      p.className = 'score-popup ' + (ok ? 'correct' : 'wrong');
      p.textContent = ok ? `+${value}` : '0';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }

    async function submitAnswer(answer, isTimeout) {
      const q = getMyQuestions()[localQIndex];
      if (!q) return;
      // Same clock as the visible countdown - fast answers always score fairly
      let te = questionElapsedSec();
      if (te == null) te = Math.max(0, (Date.now() - questionStartTime) / 1000);
      te = Math.min(te, parseInt(q.timeLimit) || activeTimeLimit);
      markAnswered(te, isTimeout);
      let correct = false;
      if (!isTimeout && answer !== null) {
        if (q.type === 'mcq' || q.type === 'truefalse') correct = answer === q.correctAnswer;
        else {
          const t = answer.toLowerCase();
          const accept = String(q.correctAnswer).split(/\s*\/\s*/).map(s => s.trim().toLowerCase());
          correct = accept.includes(t);
        }
      }
      // Fast + correct = full points set by admin, slower = reduced, wrong / times up = 0
      const score = correct ? Utils.calculateSpeedScore(te, q.points, q.timeLimit) : 0;
      myScore += score;
      showScoreFlash(score, correct);
      await supabaseClient.from('game_answers').upsert({ game_id: gameId, user_id: Auth.currentUser.id, question_index: currentQIndex, answer, correct, score, time_elapsed: te });
    }

    async function showFeedbackFromServer() {
      // This round was not part of my set - keep waiting instead
      if (getMyQuestions().length && localIndexFor(currentQIndex) === -1) {
        showState('roundwait');
        currentVisibleState = 'roundwait';
        return;
      }
      showState('feedback');
      const { data: ad } = await supabaseClient.from('game_answers').select('*').eq('game_id', gameId).eq('user_id', Auth.currentUser.id).eq('question_index', currentQIndex).maybeSingle();
      const b = document.getElementById('feedbackBanner'), t = document.getElementById('feedbackTitle'), m = document.getElementById('feedbackMessage'), rb = document.getElementById('rankBadge');
      const q = getMyQuestions()[localQIndex] || getMyQuestions()[0];
      const correctText = q ? ((q.type === 'mcq' || q.type === 'truefalse') ? q.options[q.correctAnswer] : q.correctAnswer) : '';
      // Only Correct / Wrong is shown to players - never points
      if (ad) {
        if (ad.correct) { b.className = 'feedback-banner correct'; t.textContent = 'Correct!'; m.textContent = 'Great job!'; }
        else { b.className = 'feedback-banner incorrect'; t.textContent = 'Incorrect'; m.textContent = `Correct answer: ${correctText}`; }
      } else { b.className = 'feedback-banner timeout'; t.textContent = "Time's Up!"; m.textContent = `Correct answer: ${correctText}`; }
      await updateRankDisplay(rb);
      await showFeedbackLeaderboard();
    }

    async function showFeedbackLeaderboard() {
      try {
        const { data: players } = await supabaseClient.from('game_players').select('*').eq('game_id', gameId);
        if (!players) return;
        const { data: g } = await supabaseClient.from('games').select('mode,group_size').eq('id', gameId).single();
        const isGroup = !!(g && g.mode === 'group');
        const scores = [];
        for (const p of players) {
          const { data: a } = await supabaseClient.from('game_answers').select('*').eq('game_id', gameId).eq('user_id', p.user_id);
          let t = 0, c = 0;
          if (a) { a.forEach(x => { t += x.score || 0; if (x.correct) c++; }); }
          scores.push({ uid: p.user_id, name: p.player_name, total: t, correct: c, group_id: p.group_id });
        }
        let items;
        if (isGroup) {
          const byGroup = {};
          scores.forEach(s => {
            const k = s.group_id || 'none';
            (byGroup[k] = byGroup[k] || []).push(s);
          });
          items = [];
          Object.keys(byGroup).forEach(k => {
            const mems = byGroup[k];
            const total = mems.reduce((s2, m) => s2 + m.total, 0);
            items.push({
              members: mems,
              group_id: k,
              total,
              isMeGroup: !!mems.find(m => m.uid === Auth.currentUser.id)
            });
          });
          items.sort((a, b) => b.total - a.total);
        } else {
          scores.sort((a, b) => b.total - a.total);
          items = scores.map(s => ({ members: [s], group_id: null, total: s.total, isMeGroup: s.uid === Auth.currentUser.id }));
        }
        let html = '';
        items.slice(0, 5).forEach((it, i) => {
          const isMe = it.isMeGroup ? ' style="outline:2px solid var(--accent);outline-offset:2px;"' : '';
          const nameHtml = it.group_id === 'none'
            ? Utils.sanitize(it.members[0].name)
            : isGroup
              ? it.members.map(m => Utils.sanitize(m.name).split(' ')[0]).join(' + ')
              : Utils.sanitize(it.members[0].name);
          const first = it.members[0];
          html += `<div class="leaderboard-entry"${isMe}><span class="rank">#${i+1}</span><span class="leaderboard-name"><span class="initial-avatar">${Utils.sanitize((isGroup && first ? first.name : it.members[0].name)).charAt(0).toUpperCase()}</span>${nameHtml}</span><span class="leaderboard-score">${isGroup ? it.total + ' pts' : it.members[0].correct + ' correct'}</span></div>`;
        });
        document.getElementById('feedbackLeaderboard').innerHTML = html;
      } catch (e) { console.error('Leaderboard error:', e); }
    }

    async function updateRankDisplay(badge) {
      try {
        const { data: players } = await supabaseClient.from('game_players').select('*').eq('game_id', gameId);
        if (!players) return;
        const { data: g } = await supabaseClient.from('games').select('mode').eq('id', gameId).single();
        const isGroup = !!(g && g.mode === 'group');
        const scores = [];
        for (const p of players) {
          const { data: a } = await supabaseClient.from('game_answers').select('score').eq('game_id', gameId).eq('user_id', p.user_id);
          let t = 0; if (a) a.forEach(x => t += x.score || 0);
          scores.push({ uid: p.user_id, total: t, group_id: p.group_id });
        }
        let rank;
        if (isGroup) {
          const byG = {};
          scores.forEach(s => { const k = s.group_id || 'none'; (byG[k] = byG[k] || []).push(s); });
          const totals = Object.keys(byG).map(k => ({ k, total: byG[k].reduce((s2, m) => s2 + m.total, 0) }));
          totals.sort((a, b) => b.total - a.total);
          const myK = (scores.find(s => s.uid === Auth.currentUser.id) || {}).group_id || 'none';
          rank = totals.findIndex(t => t.k === myK) + 1;
        } else {
          scores.sort((a, b) => b.total - a.total);
          rank = scores.findIndex(s => s.uid === Auth.currentUser.id) + 1;
        }
        badge.textContent = `Your Rank: #${rank}`; badge.style.display = 'inline-block';
      } catch (e) { console.error(e); }
    }

    async function showEndScreen() {
      clearInterval(timerInterval);
      if (gamePollInterval) { clearInterval(gamePollInterval); gamePollInterval = null; }
      if (showEndScreen.done) return;
      showEndScreen.done = true;
      showState('ended');
      currentVisibleState = 'ended';
      refreshFsGate();
      document.body.classList.remove('quiz-secure');
      const uid = Auth.currentUser.id;

      // Authoritative totals come from the database, not the client counter
      const { data: ma } = await supabaseClient.from('game_answers').select('score,correct').eq('game_id', gameId).eq('user_id', uid);
      let dbTotal = 0, cc = 0;
      (ma || []).forEach(a => { dbTotal += a.score || 0; if (a.correct) cc++; });
      let cheatPts = 0;
      try {
        const { data: cl } = await supabaseClient.from('cheat_logs').select('points').eq('game_id', gameId).eq('user_id', uid);
        (cl || []).forEach(x => { cheatPts += x.points || 0; });
      } catch (e) { console.error(e); }
      dbTotal = Math.max(0, dbTotal + cheatPts);
      myScore = dbTotal;
      document.getElementById('finalScore').textContent = dbTotal;
      document.getElementById('finalCorrect').textContent = cc;
      document.getElementById('finalTotal').textContent = getMyQuestions().length;

      const { data: players } = await supabaseClient.from('game_players').select('*').eq('game_id', gameId);
      const isGroupEnd = !!(gameData && gameData.mode === 'group');
      const { data: groupsMap } = isGroupEnd ? await supabaseClient.from('game_groups').select('*').eq('game_id', gameId) : { data: null };
      const gm = {};
      (groupsMap || []).forEach(x => gm[x.id] = x);
      const scores = [];
      if (players) { for (const p of players) { const { data: a } = await supabaseClient.from('game_answers').select('*').eq('game_id', gameId).eq('user_id', p.user_id); let t = 0, c = 0; if (a) { a.forEach(x => { t += x.score || 0; if (x.correct) c++; }); } let gid = p.group_id; if (!gid || !gm[gid]) gid = null; scores.push({ uid: p.user_id, name: p.player_name, total: t, correct: c, totalQ: getMyQuestions().length, group_id: p.group_id, groupKey: gid }); } }

      let rankItems, isMe;
      if (isGroupEnd) {
        const byG = {};
        scores.forEach(s => { const k = s.groupKey || 'none'; (byG[k] = byG[k] || []).push(s); });
        rankItems = Object.keys(byG).map(k => ({ members: byG[k], total: byG[k].reduce((s2, m) => s2 + m.total, 0), correct: byG[k].reduce((s2, m) => s2 + m.correct, 0) }));
        rankItems.sort((a, b) => b.total - a.total);
        isMe = it => !!it.members.find(m => m.uid === uid);
      } else {
        scores.sort((a, b) => b.total - a.total);
        rankItems = scores.map(s => ({ members: [s], total: s.total, correct: s.correct }));
        isMe = it => it.members[0].uid === uid;
      }
      const myRank = rankItems.findIndex(it => isMe(it)) + 1;
      document.getElementById('finalRank').textContent = `#${myRank}`;
      let lbHtml = '';
      rankItems.forEach((item, i) => {
        const medal = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        const highlight = isMe(item) ? ' style="outline:2px solid var(--accent);outline-offset:2px;"' : '';
        let label = '';
        if (isGroupEnd) {
          label = item.members[0].groupKey === 'none' ? Utils.sanitize(item.members[0].name) : item.members.map(m => Utils.sanitize(m.name.split(' ')[0])).join(' + ');
        } else {
          label = Utils.sanitize(item.members[0].name);
        }
        const avatarName = item.members[0].name;
        lbHtml += `<div class="leaderboard-entry"${highlight}><span class="rank">#${i+1}</span><span class="leaderboard-name"><span class="initial-avatar">${Utils.sanitize(avatarName).charAt(0).toUpperCase()}</span>${label}</span><span class="leaderboard-score">${item.total} pts</span></div>`;
      });
      document.getElementById('endLeaderboard').innerHTML = lbHtml || '<p style="color:var(--text-muted);">No data available</p>';

      // Save score to the account exactly once per game
      try {
        const { data: already } = await supabaseClient.from('leaderboards').select('id').eq('game_id', gameId).eq('user_id', uid).maybeSingle();
        if (!already) {
          let pname = Auth.currentUser.user_metadata?.name || 'Player';
          const { data: gp } = await supabaseClient.from('game_players').select('player_name').eq('game_id', gameId).eq('user_id', uid).maybeSingle();
          if (gp && gp.player_name) pname = gp.player_name;
          const ins = await supabaseClient.from('leaderboards').insert([{ user_id: uid, player_name: pname, quiz_title: gameData.quiz_title || '', total_score: dbTotal, correct_count: cc, total_questions: getMyQuestions().length, game_id: gameId }]);
          if (!ins.error) {
            const { data: prof } = await supabaseClient.from('user_profiles').select('total_points, games_played').eq('id', uid).maybeSingle();
            if (prof) await supabaseClient.from('user_profiles').update({ total_points: (prof.total_points || 0) + dbTotal, games_played: (prof.games_played || 0) + 1 }).eq('id', uid);
          }
        }
      } catch (e) { console.error('Score save error:', e); }

      if (rank <= 3) Utils.createConfetti(document.getElementById('confettiContainer'));
    }

    window.addEventListener('beforeunload', e => {
      if (gamePollInterval) clearInterval(gamePollInterval); if (timerInterval) clearInterval(timerInterval); if (pingInterval) clearInterval(pingInterval); if (groupPollInterval) clearInterval(groupPollInterval);
      stopRealtime();
      if (quizLive() && gameData && gameData.status !== 'ended') { e.preventDefault(); e.returnValue = ''; }
    });
  
