// ============================================================
// programming.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    // ============================================================
    // PROGRAMMING HUB | dashboard (auth gate -> activities -> cards)
    // ============================================================

    let IS_TEACHER = false;
    let UID = '';

    document.addEventListener('DOMContentLoaded', async () => {
      const user = await Auth.init();
      if (!user) { window.location.href = '../index.html'; return; }
      UID = Programming.uid();
      IS_TEACHER = await Programming.isTeacher();
      document.documentElement.classList.remove('auth-gate');
      const name = (Auth.currentUser && Auth.currentUser.user_metadata && Auth.currentUser.user_metadata.name) || 'coder';
      const el = document.getElementById('userName2');
      if (el) el.textContent = name;
      document.getElementById('roleTag').style.display = IS_TEACHER ? 'inline-flex' : 'none';
      document.getElementById('studentJoin').style.display = IS_TEACHER ? 'none' : 'block';
      document.getElementById('teacherActions').style.display = IS_TEACHER ? 'block' : 'none';
      const avatarEl = document.getElementById('userAvatar');
      if (avatarEl) avatarEl.textContent = name ? name.charAt(0).toUpperCase() : '?';
      const roleEl = document.getElementById('userRole');
      if (roleEl) roleEl.textContent = IS_TEACHER ? 'Teacher' : 'Student';
      bindJoinModal();
      await renderActivities();
    });

    // ---------- JOIN LIVE CONTEST POPUP (quiz-style 6 boxes) ----------
    function openJoinModal() {
      document.getElementById('joinError').style.display = 'none';
      document.getElementById('joinModal').classList.add('active');
      const inputs = document.querySelectorAll('#codeInputs input');
      inputs.forEach(i => { i.value = ''; });
      setTimeout(() => { inputs[0].focus(); }, 60);
    }
    function closeJoinModal() {
      document.getElementById('joinModal').classList.remove('active');
    }
    function handleCodeInput(input, index) {
      input.value = input.value.replace(/\D/g, '');
      if (input.value && index < 5) {
        document.querySelectorAll('#codeInputs input')[index + 1].focus();
      }
    }
    function joinError(msg) {
      const e = document.getElementById('joinError');
      if (e) { e.textContent = msg; e.style.display = 'block'; }
      const inputs = document.querySelectorAll('#codeInputs input');
      if (inputs[0]) inputs[0].focus();
    }
    function submitJoin() {
      const code = Array.from(document.querySelectorAll('#codeInputs input')).map(i => i.value).join('');
      if (code.length !== 6 || !/^\d{6}$/.test(code)) { joinError('Enter the complete 6-digit PIN from your teacher.'); return; }
      Utils.showLoading();
      ProgLive.getGameByPin(code).then((g) => {
        Utils.hideLoading();
        if (!g) { joinError('No live contest found for that PIN.'); return; }
        if (g.status === 'ended') {
          if (g.activity_id) { window.location.href = 'results.html?activity=' + encodeURIComponent(g.activity_id); return; }
          joinError('This contest has already ended.'); return;
        }
        closeJoinModal();
        window.location.href = 'activity.html?live=' + encodeURIComponent(code);
      }).catch(() => { Utils.hideLoading(); joinError('Could not join the contest right now. Try again.'); });
    }
    function bindJoinModal() {
      const modal = document.getElementById('joinModal');
      const inputs = document.querySelectorAll('#codeInputs input');
      inputs.forEach((inp, i) => {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); submitJoin(); }
          if (e.key === 'Escape') closeJoinModal();
          if (e.key === 'Backspace' && !inp.value && i > 0) {
            inputs[i - 1].focus();
            inputs[i - 1].value = '';
          }
        });
        inp.addEventListener('paste', (e) => {
          e.preventDefault();
          const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
          for (let j = 0; j < 6 && j < paste.length; j++) {
            inputs[j].value = paste[j];
          }
          if (paste.length > 0) inputs[Math.min(paste.length, 5)].focus();
        });
      });
      modal.addEventListener('click', (e) => { if (e.target === modal) closeJoinModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('joinModal').classList.contains('active')) closeJoinModal();
      });
    }

    // ---------- ACTIVITIES ----------
    async function renderActivities() {
      const grid = document.getElementById('activitiesGrid');
      const count = document.getElementById('activityCount');
      const empty = document.getElementById('emptyState');
      try {
        const all = await Programming.listActivities();
        const acts = all.filter(a => IS_TEACHER ? (a.created_by === UID || a.status === 'published') : a.status === 'published');
        acts.sort((a, b) => (a.status === 'draft' ? 1 : 0) - (b.status === 'draft' ? 1 : 0));
        const withCounts = await Promise.all(acts.map(async a => {
          let n = 0;
          try { n = (await Programming.loadActivity(a.id)).problems.length; } catch (e) {}
          return Object.assign({}, a, { _count: n });
        }));
        count.textContent = withCounts.length + ' activit' + (withCounts.length === 1 ? 'y' : 'ies');
        if (!withCounts.length) {
          grid.innerHTML = '';
          empty.style.display = 'block';
          fillEmpty();
          return;
        }
        empty.style.display = 'none';
        grid.innerHTML = withCounts.map(cardHTML).join('');
      } catch (e) {
        console.error(e);
        Utils.showToast('Could not load activities', 'error');
        grid.innerHTML = '';
        empty.style.display = 'block';
        fillEmpty();
      }
    }

    function fillEmpty() {
      const msg = document.getElementById('emptyMsg');
      const cta = document.getElementById('emptyCta');
      if (IS_TEACHER) {
        msg.textContent = 'No programming activities yet. Create the first one for your class.';
        cta.innerHTML = '<a href="create-programming.html" class="btn btn-primary">+ Create Programming Activity</a>';
      } else {
        msg.textContent = 'No published activities yet. Check back soon!';
        cta.innerHTML = '';
      }
    }

    function cardHTML(a) {
      const mine = a.created_by === UID;
      const statusPill = '<span class="prog-status-badge ' + a.status + '">' + (a.status === 'published' ? 'Published' : 'Draft') + '</span>';
      let actions = '';
      if (IS_TEACHER) {
        actions += '<a class="btn btn-primary btn-sm" href="activity.html?id=' + a.id + '">Open</a>';
        actions += '<a class="btn btn-ghost btn-sm" href="results.html?activity=' + a.id + '">Results</a>';
        if (mine) {
          actions += '<a class="btn btn-ghost btn-sm" href="create-programming.html?id=' + a.id + '">Edit</a>';
          actions += '<button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="delActivity(\'' + a.id + '\')">Delete</button>';
        }
      } else {
        actions = '<a class="btn btn-success btn-sm" href="activity.html?id=' + a.id + '">Start Activity</a>';
      }
      const lang = langLabel(a.language);
      return '<div class="prog-card">' +
        '<div class="prog-card-top">' + langBadge(lang) + statusPill + '</div>' +
        '<h3 class="prog-card-title">' + Utils.sanitize(a.title) + '</h3>' +
        '<p class="prog-card-desc">' + Utils.sanitize(a.description || 'No description yet.') + '</p>' +
        '<div class="prog-card-meta">' + a._count + ' problem' + (a._count === 1 ? '' : 's') + ' &middot; ' + (a.total_points || 0) + ' pts &middot; ' + a.time_limit_minutes + ' min</div>' +
        '<div class="prog-card-actions">' + actions + '</div>' +
        '</div>';
    }

    function langLabel(lang) {
      const hit = Programming.LANGUAGES.find(l => l.id === lang || l.label === lang);
      return hit ? hit.label : (lang || 'C++');
    }

    function langBadge(label) {
      return '<span class="prog-lang-badge">&lt;' + Utils.sanitize(label) + '/&gt;</span>';
    }

    async function delActivity(id) {
      const list = await Programming.listActivities();
      const act = list.find(a => a.id === id);
      if (!act || act.created_by !== UID) { Utils.showToast('You can only delete activities you created', 'error'); return; }
      if (!window.confirm('Delete this activity, all its problems, test cases and results?')) return;
      try {
        await supabaseClient.from('programming_activities').delete().eq('id', id);
        Utils.showToast('Activity deleted', 'success');
        await renderActivities();
      } catch (e) {
        console.error(e);
        Utils.showToast('Could not delete activity', 'error');
      }
    }

    async function logout() { await Auth.logout(); window.location.href = '../index.html'; }
  
