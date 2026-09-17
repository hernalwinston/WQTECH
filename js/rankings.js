// ============================================================
// rankings.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    document.addEventListener('DOMContentLoaded', async () => {
      const user = await Auth.init();
      if (!user) { window.location.href = '../index.html'; return; }
      // Admins have no student dashboard - send them back to the admin panel
      if (Auth.isAdmin) {
        document.querySelectorAll('a[href="dashboard.html"]').forEach(a => a.setAttribute('href', 'admin.html'));
      }
      await loadRankings(user.id);
    });

    function getInitial(name) { return name ? name.charAt(0).toUpperCase() : '?'; }
    function avatarHtml(url, name, size) {
      if (url) return `<img src="${url}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;">`;
      return getInitial(name);
    }

    async function loadRankings(uid) {
      const { data: players } = await supabaseClient.from('user_profiles')
        .select('id, name, avatar_url, total_points, games_played')
        .order('total_points', { ascending: false }).limit(100);

      if (!players || players.length === 0) {
        document.getElementById('rankingsList').innerHTML = '<div class="empty-state"><p>No rankings yet. Play a game to get started!</p></div>';
        return;
      }

      const podium = document.getElementById('podium');
      const top3 = players.slice(0, 3);
      const order = [1, 0, 2];
      let pHtml = '';
      order.forEach(i => {
        const p = top3[i];
        if (!p) return;
        const cls = i === 0 ? 'p1' : i === 1 ? 'p2' : 'p3';
        pHtml += `
          <div class="podium-slot ${cls}">
            <div class="podium-rank">#${i+1}</div>
            <div class="podium-avatar">${avatarHtml(p.avatar_url, p.name, 52)}</div>
            <div class="podium-name">${Utils.sanitize(p.name)}</div>
            <div class="podium-pts">${p.total_points} pts</div>
          </div>
        `;
      });
      podium.innerHTML = pHtml;

      let rHtml = '';
      players.slice(3, 100).forEach((p, i) => {
        const me = p.id === uid ? ' is-me' : '';
        rHtml += `
          <div class="rank-row${me}">
            <span class="rank-num">#${i+4}</span>
            <div class="rank-avatar">${avatarHtml(p.avatar_url, p.name, 38)}</div>
            <span class="rank-name">${Utils.sanitize(p.name)}</span>
            <div style="text-align:right;">
              <div class="rank-pts">${p.total_points} pts</div>
              <div class="rank-games">${p.games_played} games</div>
            </div>
          </div>
        `;
      });
      document.getElementById('rankingsList').innerHTML = rHtml;
    }
  
