// ============================================================
// history.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    document.addEventListener('DOMContentLoaded', async () => {
      const user = await Auth.init();
      if (!user) { window.location.href = '../index.html'; return; }
      if (Auth.isAdmin) { window.location.href = 'admin.html'; return; }
      await loadHistory(user.id);
    });

    async function loadHistory(uid) {
      const { data: entries } = await supabaseClient.from('leaderboards')
        .select('*').eq('user_id', uid).order('played_at', { ascending: false });

      const c = document.getElementById('historyContainer');
      if (!entries || entries.length === 0) {
        c.innerHTML = '<div class="empty-state"><p>No games played yet. Join a game to get started!</p></div>';
        return;
      }

      let html = '';
      for (const e of entries) {
        const { data: answers } = await supabaseClient.from('game_answers')
          .select('*').eq('game_id', e.game_id).eq('user_id', uid).order('question_index');

        let correctCount = 0, wrongCount = 0;
        const detailRows = [];
        if (answers && answers.length > 0) {
          answers.forEach((a, i) => {
            if (a.correct) correctCount++; else wrongCount++;
            const icon = a.correct
              ? '<span class="correct-tag">&#10003; Correct</span>'
              : '<span class="wrong-tag">&#10007; Wrong</span>';
            detailRows.push(`
              <div class="detail-row">
                <div class="detail-q">Question ${i+1}</div>
                <div class="detail-result">${icon}</div>
                <div class="detail-score">${a.score || 0} pts</div>
              </div>
            `);
          });
        }

        const played = new Date(e.played_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
        const qCount = e.total_questions || (answers ? answers.length : 0);
        const viol = e.violation_points || 0;
        const violTag = viol < 0 ? `<div class="rank" style="color:#DC2626;">${viol} penalty pts</div>` : '';

        html += `
          <div class="history-card" onclick="this.classList.toggle('open')">
            <div class="history-top">
              <div class="history-icon">${(e.quiz_title||'Q').charAt(0).toUpperCase()}</div>
              <div class="history-info">
                <h4>${Utils.sanitize(e.quiz_title || 'Quiz')}</h4>
                <p>${played} &middot; ${qCount} questions</p>
              </div>
              <div class="history-score">
                <div class="pts">${e.total_score || 0} pts</div>
                <div class="rank">${e.correct_count || 0}/${qCount} correct</div>
                ${violTag}
              </div>
              <div class="history-toggle">&#9662;</div>
            </div>
            <div class="history-details">
              ${detailRows.join('')}
              <div class="summary-bar">
                <span class="correct-count">&#10003; ${correctCount} correct</span>
                <span class="wrong-count">&#10007; ${wrongCount} wrong</span>
                ${viol < 0 ? `<span style="color:#DC2626;">Penalties: ${viol} pts</span>` : ''}
                <span>Score: ${e.total_score || 0} pts</span>
              </div>
            </div>
          </div>
        `;
      }
      c.innerHTML = html;
    }
  
