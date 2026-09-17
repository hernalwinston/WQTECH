// ============================================================
// dashboard.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    let userData = null;

    document.addEventListener('DOMContentLoaded', async () => {
      const user = await Auth.init();
      if (!user) { window.location.href = '../index.html'; return; }
      if (Auth.isAdmin) { window.location.href = 'admin.html'; return; }
      // Only confirmed students reach this point - reveal the page
      document.documentElement.classList.remove('auth-gate');
      await loadUserProfile(user.id);
      await loadPreviousResults(user.id);
    });

    async function loadUserProfile(uid) {
      let { data } = await supabaseClient.from('user_profiles').select('*').eq('id', uid).single();
      if (!data) {
        const stored = JSON.parse(localStorage.getItem('qb_profile') || '{}');
        const name = stored.name || Auth.currentUser?.user_metadata?.name || '';
        if (name) {
          await supabaseClient.from('user_profiles').upsert({
            id: uid, name: name, year_section: stored.yearSection || '',
            email: Auth.currentUser?.email || '',
            is_guest: false, total_points: 0, games_played: 0
          }, { onConflict: 'id' });
          const { data: r } = await supabaseClient.from('user_profiles').select('*').eq('id', uid).single();
          if (r) data = r;
        }
      }
      if (!data) return;
      userData = data;
      renderProfile(data);
    }

    function renderProfile(d) {
      const avatarEl = document.getElementById('userAvatar');
      if (d.avatar_url) {
        avatarEl.innerHTML = `<img src="${d.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      } else {
        avatarEl.textContent = d.name ? d.name.charAt(0).toUpperCase() : '?';
      }
      document.getElementById('userName').textContent = d.name;
      document.getElementById('userYear').textContent = d.year_section || '';
      document.getElementById('totalPoints').textContent = d.total_points || 0;
      document.getElementById('gamesPlayed').textContent = d.games_played || 0;
    }

    async function loadPreviousResults(uid) {
      const { data } = await supabaseClient.from('leaderboards').select('*').eq('user_id', uid).order('played_at', { ascending: false }).limit(10);
      const c = document.getElementById('resultsContainer');
      if (!data || data.length === 0) { c.innerHTML = '<div class="empty-state"><p>No games played yet. Join a game to get started!</p></div>'; return; }
      let html = '';
      data.forEach(r => {
        html += `<div class="result-item">
          <div class="result-icon">${(r.quiz_title || 'Q').charAt(0)}</div>
          <div class="result-info"><h4>${Utils.sanitize(r.quiz_title || 'Quiz')}</h4><p>${r.correct_count || 0}/${r.total_questions || 0} correct</p></div>
          <div class="result-score">${r.total_score || 0} pts</div>
        </div>`;
      });
      c.innerHTML = html;
    }

    function joinGameModal() {
      document.getElementById('joinModal').classList.add('active');
      document.querySelector('#codeInputs input').focus();
    }

    function closeJoinModal() { document.getElementById('joinModal').classList.remove('active'); }

    function handleCodeInput(input, index) {
      input.value = input.value.toUpperCase();
      if (input.value && index < 5) document.querySelectorAll('#codeInputs input')[index + 1].focus();
    }

    function submitGameCode() {
      const code = Array.from(document.querySelectorAll('#codeInputs input')).map(i => i.value).join('');
      if (code.length !== 6) return Utils.showToast('Enter all 6 digits', 'error');
      window.location.href = `game.html?code=${code}`;
    }

    async function logout() { await Auth.logout(); window.location.href = '../index.html'; }
  
