// ============================================================
// admin.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    let currentQuizId=null, questionCount=0, editingQuizId=null, currentGameId=null;
    let currentGameQuestions=[], currentQuestionIndex=0, adminTimerInterval=null;
    let playersPollInterval=null, answersPollInterval=null, reportData=[];

    document.addEventListener('DOMContentLoaded', async () => {
      const user = await Auth.init();
      // Gate stays hidden until we know exactly what to show.
      if (user) {
        const isAdmin = await Auth.checkAdminStatus(user.id);
        // Lift gate INSIDE the view functions so there is zero flash
        if (isAdmin) { showAdminPanel(); loadQuizzes(); loadUsers(); loadCompletedGames(); }
        else { liftGate(); document.getElementById('loginModal').classList.add('active'); }
      } else { liftGate(); document.getElementById('loginModal').classList.add('active'); }
    });

    // Called once we know exactly what view to display.
    // All content appears in the same frame — no flash.
    function liftGate() { document.documentElement.classList.remove('auth-gate'); }

    function toggleAdminPass(btn) {
      const f = btn.previousElementSibling;
      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');
      if (f.type === 'password') {
        f.type = 'text';
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
      } else {
        f.type = 'password';
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
      }
    }

    async function adminLogin() {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      if (!email || !password) return Utils.showToast('Fill in all fields', 'error');
      Utils.showLoading();
      const result = await Auth.loginAdmin(email, password);
      Utils.hideLoading();
      if (result.success) { showAdminPanel(); loadQuizzes(); loadUsers(); loadCompletedGames(); }
      else Utils.showToast(result.error, 'error');
    }

    function showAdminPanel() {
      liftGate();
      document.getElementById('loginModal').classList.remove('active');
      document.getElementById('adminLayout').style.display = 'flex';
    }

    async function adminLogout() { await Auth.logout(); location.reload(); }

    function switchTab(tab) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
      document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
      closeSidebar();
    }

    function toggleSidebar() {
      const s = document.querySelector('.sidebar');
      const b = document.getElementById('sidebarBackdrop');
      const open = s.classList.toggle('open');
      if (b) b.classList.toggle('show', open);
    }

    function closeSidebar() {
      const s = document.querySelector('.sidebar');
      const b = document.getElementById('sidebarBackdrop');
      if (s) s.classList.remove('open');
      if (b) b.classList.remove('show');
    }

    // QUIZ MANAGER
    async function loadQuizzes() {
      const { data } = await supabaseClient.from('quizzes').select('*').eq('created_by', Auth.currentUser.id);
      window._allQuizzes = data || [];
      renderQuizList();
      updateQuizStats();
      const sel = document.getElementById('gameQuizSelect');
      sel.innerHTML = '<option value="">-- Select a quiz --</option>';
      window._quizCounts = {};
      (data || []).forEach(q => { sel.innerHTML += `<option value="${q.id}">${Utils.sanitize(q.title)} (${q.questions.length} Q)</option>`; window._quizCounts[q.id] = q.questions.length; });
      sel.onchange = () => {
        const c = window._quizCounts[sel.value];
        document.getElementById('quizQCountHint').textContent = c ? `quiz has ${c} questions` : 'select a quiz to see its size';
        if (c) document.getElementById('gameItemsPerStudent').max = c;
      };
    }

    function renderQuizList() {
      const term = (document.getElementById('quizSearch')?.value || '').toLowerCase();
      const all = window._allQuizzes || [];
      const data = term ? all.filter(q => (q.title || '').toLowerCase().includes(term)) : all;
      const c = document.getElementById('quizList'), e = document.getElementById('quizEmptyState');
      if (!all.length) { c.innerHTML = ''; e.style.display = 'block'; e.querySelector('p').textContent = 'No quizzes yet. Create your first quiz!'; return; }
      if (!data.length) { c.innerHTML = ''; e.style.display = 'block'; e.querySelector('p').textContent = 'No quizzes match your search.'; return; }
      e.style.display = 'none';
      let h = '';
      data.forEach(q => {
        const qs = q.questions || [];
        const mcq = qs.filter(x => x.type === 'mcq').length;
        const tf = qs.filter(x => x.type === 'truefalse').length;
        const ident = qs.filter(x => x.type === 'identification' || !x.type).length;
        let chips = `${mcq ? `<span class="quiz-chip">${mcq} MCQ</span>` : ''}${tf ? `<span class="quiz-chip">${tf} T/F</span>` : ''}${ident ? `<span class="quiz-chip">${ident} ID</span>` : ''}`;
        h += `<div class="quiz-card"><div class="quiz-card-title">${Utils.sanitize(q.title)}</div>
          <div class="quiz-card-meta"><span>${qs.length} questions</span><span>${q.created_at ? new Date(q.created_at).toLocaleDateString() : ''}</span></div>
          <div style="margin-bottom:14px;">${chips || '<span style="font-size:0.75rem;color:var(--text-muted);">empty</span>'}</div>
          <div class="quiz-card-actions"><button class="btn btn-sm btn-outline" onclick="editQuiz('${q.id}')">Edit</button><button class="btn btn-sm btn-outline" onclick="duplicateQuiz('${q.id}')">Duplicate</button><button class="btn btn-sm btn-danger" onclick="deleteQuiz('${q.id}')">Delete</button></div></div>`;
      });
      c.innerHTML = h;
    }

    function updateQuizStats() {
      const all = window._allQuizzes || [];
      const totalQ = all.reduce((s, q) => s + ((q.questions || []).length), 0);
      const pts = [];
      all.forEach(q => (q.questions || []).forEach(x => pts.push(x.points || 100)));
      const avgPts = pts.length ? Math.round(pts.reduce((a, b) => a + b, 0) / pts.length) : 0;
      document.getElementById('quizStats').innerHTML = `
        <div class="stat-box"><div class="stat-value">${all.length}</div><div class="stat-label">Quizzes</div></div>
        <div class="stat-box"><div class="stat-value">${totalQ}</div><div class="stat-label">Total Questions</div></div>
        <div class="stat-box"><div class="stat-value">${avgPts || '-'}</div><div class="stat-label">Avg Points / Q</div></div>`;
    }

    async function duplicateQuiz(qid) {
      Utils.showLoading();
      try {
        const { data: quiz, error } = await supabaseClient.from('quizzes').select('*').eq('id', qid).single();
        if (error || !quiz) throw error;
        const { error: insErr } = await supabaseClient.from('quizzes').insert({ title: quiz.title + ' (Copy)', questions: quiz.questions, created_by: Auth.currentUser.id });
        if (insErr) throw insErr;
        Utils.showToast('Quiz duplicated!', 'success');
        loadQuizzes();
      } catch (e) { console.error(e); Utils.showToast('Could not duplicate quiz', 'error'); }
      Utils.hideLoading();
    }

    function showQuizBuilder(qid, title) {
      document.getElementById('quizListView').style.display = 'none';
      document.getElementById('quizBuilderView').style.display = 'block';
      document.getElementById('saveQuizBtn').textContent = qid ? 'Update Quiz' : 'Save Quiz';
      editingQuizId = qid || null;
      if (!qid) {
        document.getElementById('quizTitle').value = title || '';
        document.getElementById('questionsContainer').innerHTML = '';
        questionCount = 0; updateBuilderCount(); addQuestion();
      }
    }

    function closeQuizBuilder() {
      document.getElementById('quizListView').style.display = 'block';
      document.getElementById('quizBuilderView').style.display = 'none';
      editingQuizId = null;
    }

    function openCreateQuizModal() {
      document.getElementById('createQuizTitle').value = '';
      document.getElementById('createQuizModal').classList.add('active');
      setTimeout(function() { document.getElementById('createQuizTitle').focus(); }, 80);
    }

    function closeCreateQuizModal() {
      document.getElementById('createQuizModal').classList.remove('active');
    }

    function createQuizFromModal() {
      const title = document.getElementById('createQuizTitle').value.trim();
      if (!title) return Utils.showToast('Enter a quiz title', 'error');
      document.getElementById('quizTitle').value = title;
      closeCreateQuizModal();
      showQuizBuilder(null, title);
    }

    function addQuestion() {
      questionCount++; const n = questionCount;
      const div = document.createElement('div'); div.className = 'question-item'; div.id = `question-${n}`;
      div.innerHTML = `
        <div class="question-item-header"><span class="question-item-number">Question ${n}</span><button class="btn btn-sm btn-danger" onclick="removeQuestion(${n})">Remove</button></div>
        <div class="form-group"><label>Type</label>
          <select class="form-control q-type" id="qType-${n}" onchange="toggleQuestionType(${n})">
            <option value="mcq">Multiple Choice</option><option value="truefalse">True / False</option><option value="identification">Identification</option>
          </select></div>
        <div class="form-group"><label>Question Text</label><textarea class="form-control q-text" id="qText-${n}" placeholder="Type your question..."></textarea></div>
        <div class="media-upload" onclick="uploadImage(${n})"><p>Click to upload an image (optional)</p><input type="file" id="qImage-${n}" accept="image/*" style="display:none" onchange="handleImageUpload(${n})"></div>
        <div id="imagePreview-${n}" style="display:none; margin:10px 0;"><img id="qImg-${n}" style="max-width:200px; border-radius:8px;"><button class="btn btn-sm btn-danger" onclick="removeImage(${n})">Remove</button></div>
        <div id="mcqOptions-${n}">
          <div class="option-row"><input type="radio" name="correct-${n}" value="0" checked><input type="text" class="option-input" id="optA-${n}" placeholder="Option A"></div>
          <div class="option-row"><input type="radio" name="correct-${n}" value="1"><input type="text" class="option-input" id="optB-${n}" placeholder="Option B"></div>
          <div class="option-row"><input type="radio" name="correct-${n}" value="2"><input type="text" class="option-input" id="optC-${n}" placeholder="Option C"></div>
          <div class="option-row"><input type="radio" name="correct-${n}" value="3"><input type="text" class="option-input" id="optD-${n}" placeholder="Option D"></div></div>
        <div id="tfOptions-${n}" style="display:none;"><div class="option-row"><input type="radio" name="correct-${n}" value="0" checked><label>True</label></div><div class="option-row"><input type="radio" name="correct-${n}" value="1"><label>False</label></div></div>
        <div id="idOptions-${n}" style="display:none;"><div class="form-group"><label>Correct Answer (case-insensitive)</label><input type="text" class="form-control" id="idAnswer-${n}" placeholder="Type the correct answer"></div></div>
        <div class="question-meta"><div class="form-group"><label>Points</label><input type="number" class="form-control q-points" id="qPoints-${n}" value="100" min="10" max="500"></div><div class="form-group"><label>Time (seconds)</label><input type="number" class="form-control q-time" id="qTime-${n}" value="20" min="5" max="120"></div></div>`;
      document.getElementById('questionsContainer').appendChild(div);
      updateBuilderCount();
    }

    function updateBuilderCount() {
      const n = document.querySelectorAll('.question-item').length;
      const el = document.getElementById('builderQCount');
      if (el) el.textContent = n;
    }

    function removeQuestion(n) { const el = document.getElementById(`question-${n}`); if (el) el.remove(); updateBuilderCount(); }

    function toggleQuestionType(n) {
      const t = document.getElementById(`qType-${n}`).value;
      const mcqEl = document.getElementById(`mcqOptions-${n}`);
      const tfEl   = document.getElementById(`tfOptions-${n}`);
      const idEl   = document.getElementById(`idOptions-${n}`);
      mcqEl.style.display = t === 'mcq' ? 'block' : 'none';
      tfEl.style.display  = t === 'truefalse' ? 'block' : 'none';
      idEl.style.display  = t === 'identification' ? 'block' : 'none';
      if (t === 'mcq' || t === 'truefalse') {
        const checked = document.querySelector(`input[name="correct-${n}"]:checked`);
        const visible = t === 'mcq' ? mcqEl : tfEl;
        if (!checked || !visible.contains(checked)) {
          const v0 = visible.querySelector('input[name="correct-' + n + '"]');
          if (v0) v0.checked = true;
        }
      }
    }

    function uploadImage(n) { document.getElementById(`qImage-${n}`).click(); }

    function handleImageUpload(n) {
      const f = document.getElementById(`qImage-${n}`).files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = e => { document.getElementById(`qImg-${n}`).src = e.target.result; document.getElementById(`imagePreview-${n}`).style.display = 'block'; };
      r.readAsDataURL(f);
    }

    function removeImage(n) { document.getElementById(`imagePreview-${n}`).style.display = 'none'; document.getElementById(`qImage-${n}`).value = ''; }

    async function saveQuiz() {
      const title = document.getElementById('quizTitle').value.trim();
      if (!title) return Utils.showToast('Enter a quiz title', 'error');
      const items = document.querySelectorAll('.question-item');
      if (!items.length) return Utils.showToast('Add at least one question', 'error');
      const questions = [];
      for (const item of items) {
        const id = item.id.split('-')[1];
        const num = questions.length + 1;
        const type = document.getElementById(`qType-${id}`).value;
        const text = document.getElementById(`qText-${id}`).value.trim();
        if (!text) { Utils.showToast(`Question ${num}: Enter question text`, 'error'); item.scrollIntoView({ behavior: 'smooth' }); return; }
        const points = parseInt(document.getElementById(`qPoints-${id}`).value) || 100;
        const timeLimit = parseInt(document.getElementById(`qTime-${id}`).value) || 20;
        const imgEl = document.getElementById(`qImg-${id}`);
        const imageUrl = imgEl && imgEl.src && document.getElementById(`imagePreview-${id}`).style.display !== 'none' ? imgEl.src : null;
        let correctAnswer = 0, options = [];
        if (type === 'mcq') {
          const opts = ['A', 'B', 'C', 'D'].map(L => document.getElementById(`opt${L}-${id}`).value.trim());
          if (!opts[0] || !opts[1]) { Utils.showToast(`Question ${num}: Fill at least options A & B`, 'error'); item.scrollIntoView({ behavior: 'smooth' }); return; }
          const checked = document.querySelector(`input[name="correct-${id}"]:checked`);
          const ci = parseInt(checked ? checked.value : 0);
          if (!opts[ci] || !opts[ci].trim()) { Utils.showToast(`Question ${num}: The option marked as correct is empty - fill it or pick another option`, 'error'); item.scrollIntoView({ behavior: 'smooth' }); return; }
          options = opts.filter(o => o);
          correctAnswer = opts.slice(0, ci).filter(o => o).length;
        } else if (type === 'truefalse') {
          options = ['True', 'False'];
          const checked = document.querySelector(`#tfOptions-${id} input[name="correct-${id}"]:checked`);
          correctAnswer = parseInt(checked ? checked.value : 0);
        } else {
          const ans = document.getElementById(`idAnswer-${id}`).value.trim();
          if (!ans) { Utils.showToast(`Question ${num}: Enter the correct answer`, 'error'); item.scrollIntoView({ behavior: 'smooth' }); return; }
          correctAnswer = ans;
        }
        questions.push({ type, text, options, correctAnswer, points, timeLimit, imageUrl });
      }
      Utils.showLoading();
      const d = { title, questions, created_by: Auth.currentUser.id };
      let error = null;
      if (editingQuizId) { const r = await supabaseClient.from('quizzes').update(d).eq('id', editingQuizId); error = r.error; }
      else { const r = await supabaseClient.from('quizzes').insert(d); error = r.error; }
      Utils.hideLoading();
      if (error) { console.error(error); return Utils.showToast('Error saving quiz', 'error'); }
      Utils.showToast(editingQuizId ? 'Quiz updated!' : 'Quiz created!', 'success');
      closeQuizBuilder(); loadQuizzes();
    }

    async function editQuiz(qid) {
      Utils.showLoading();
      try {
        const { data: quiz, error } = await supabaseClient.from('quizzes').select('*').eq('id', qid).single();
        if (error || !quiz) { Utils.hideLoading(); return Utils.showToast('Could not load quiz', 'error'); }
        showQuizBuilder(qid);
        document.getElementById('quizTitle').value = quiz.title;
        document.getElementById('questionsContainer').innerHTML = '';
        questionCount = 0;
        (quiz.questions || []).forEach(q => { addQuestion(); fillQuestionForm(questionCount, q); });
        updateBuilderCount();
        Utils.showToast(`Loaded "${quiz.title}" with ${(quiz.questions || []).length} question(s)`, 'success');
      } catch (e) { console.error(e); Utils.showToast('Error loading quiz', 'error'); }
      Utils.hideLoading();
    }

    function fillQuestionForm(n, q) {
      const t = q.type || 'mcq';
      document.getElementById(`qType-${n}`).value = t;
      toggleQuestionType(n);
      document.getElementById(`qText-${n}`).value = q.text || '';
      document.getElementById(`qPoints-${n}`).value = (q.points != null ? q.points : 100);
      document.getElementById(`qTime-${n}`).value = (q.timeLimit != null ? q.timeLimit : 20);
      if (t === 'identification') {
        document.getElementById(`idAnswer-${n}`).value = typeof q.correctAnswer === 'string' ? q.correctAnswer : '';
      } else if (t === 'truefalse') {
        const el = document.querySelector(`#tfOptions-${n} input[name="correct-${n}"][value="${q.correctAnswer == 1 ? '1' : '0'}"]`);
        if (el) el.checked = true;
      } else {
        const L = ['A', 'B', 'C', 'D'];
        (q.options || []).forEach((o, i) => { const inp = document.getElementById(`opt${L[i]}-${n}`); if (inp) inp.value = o || ''; });
        const idx = Math.min(Math.max(parseInt(q.correctAnswer) || 0, 0), (q.options || []).length - 1);
        const el = document.querySelector(`input[name="correct-${n}"][value="${idx}"]`);
        if (el) el.checked = true;
      }
      if (q.imageUrl) { document.getElementById(`qImg-${n}`).src = q.imageUrl; document.getElementById(`imagePreview-${n}`).style.display = 'block'; }
    }

    // FILE IMPORT
    function toggleFormatGuide() {
      const g = document.getElementById('formatGuide');
      g.open = !g.open;
    }

    async function handleQuizImport(ev) {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      Utils.showLoading();
      try {
        let raw = '';
        if (ext === 'docx') {
          if (typeof mammoth === 'undefined') { Utils.hideLoading(); return Utils.showToast('DOCX reader not loaded - check internet connection', 'error'); }
          const ab = await f.arrayBuffer();
          const res = await mammoth.extractRawText({ arrayBuffer: ab });
          raw = res.value || '';
        } else if (ext === 'doc') {
          Utils.hideLoading();
          return Utils.showToast('Old .doc not supported - save as .docx or .txt first', 'error');
        } else {
          raw = await f.text();
        }
        const parsed = ext === 'csv' ? { title: '', unanswered: 0, questions: parseCsvQuiz(raw) } : parseQuizText(raw);
        Utils.hideLoading();
        if (!applyParsedQuestions(parsed, 'in the file')) return Utils.showToast('No questions found in the file. Check the Format Guide.', 'error');
      } catch (err) {
        console.error(err); Utils.hideLoading();
        Utils.showToast('Could not read that file', 'error');
      }
    }

    function togglePastePanel() {
      const p = document.getElementById('pastePanel');
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
      if (p.style.display === 'block') document.getElementById('pasteArea').focus();
    }

    // Live counter while typing: shows size + how many questions were detected
    let pasteDebounce = null;
    document.addEventListener('DOMContentLoaded', () => {
      const ta = document.getElementById('pasteArea');
      if (!ta) return;
      ta.addEventListener('input', () => {
        clearTimeout(pasteDebounce);
        pasteDebounce = setTimeout(() => {
          const raw = ta.value;
          const el = document.getElementById('pasteStats');
          if (!raw.trim()) { el.textContent = '0 characters'; return; }
          const chars = raw.length;
          try {
            const n = parseQuizText(raw).questions.length;
            el.innerHTML = `${chars.toLocaleString()} characters &bull; <strong>${n} question${n !== 1 ? 's' : ''} detected</strong>`;
          } catch (e) { el.textContent = `${chars.toLocaleString()} characters`; }
        }, 350);
      });
    });

    function insertSampleText() {
      const ta = document.getElementById('pasteArea');
      if (ta.value.trim()) { Utils.showToast('Clear the box first to load the sample', 'error'); return; }
      ta.value = SAMPLE_QUIZ_TEXT;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    }

    function clearPasteArea() {
      const ta = document.getElementById('pasteArea');
      ta.value = '';
      document.getElementById('pasteStats').textContent = '0 characters';
      ta.focus();
    }

    const SAMPLE_QUIZ_TEXT = `Science Quiz - Sample

1. What is the chemical symbol for water?
A. CO2
*B. H2O
C. O2
D. NaCl

2. The sun is a star?
Answer: True

3. Who developed the theory of relativity?
Answer: Albert Einstein`;

    function createFromPastedText() {
      const raw = document.getElementById('pasteArea').value;
      if (!raw.trim()) return Utils.showToast('Paste your quiz text first', 'error');
      Utils.showLoading();
      setTimeout(() => {
        try {
          const parsed = parseQuizText(raw);
          Utils.hideLoading();
          if (!applyParsedQuestions(parsed, 'in the pasted text')) return Utils.showToast('No questions found. Check the Format Guide.', 'error');
          document.getElementById('pastePanel').style.display = 'none';
          document.getElementById('pasteArea').value = '';
        } catch (e) { console.error(e); Utils.hideLoading(); Utils.showToast('Could not read that text', 'error'); }
      }, 30);
    }

    function applyParsedQuestions(parsed, sourceLabel) {
      const qs = parsed.questions || [];
      if (!qs.length) return false;
      let replace = questionCount === 0;
      if (!replace) replace = confirm(`Found ${qs.length} question(s) ${sourceLabel}.\n\nOK = REPLACE the current ${questionCount} question(s)\nCancel = APPEND after them`);
      if (replace) { document.getElementById('questionsContainer').innerHTML = ''; questionCount = 0; }
      const titleEl = document.getElementById('quizTitle');
      if (parsed.title && !titleEl.value.trim()) titleEl.value = parsed.title;
      qs.forEach(q => { addQuestion(); fillQuestionForm(questionCount, q); });
      let msg = `Created ${qs.length} question(s)! Review everything then Save.`;
      if (parsed.unanswered > 0) msg += ` NOTE: ${parsed.unanswered} question(s) had no marked correct answer - option A was set by default, please check them.`;
      Utils.showToast(msg, parsed.unanswered > 0 ? 'info' : 'success');
      document.getElementById('questionsContainer').scrollIntoView({ behavior: 'smooth' });
      return true;
    }

    function parseQuizText(raw) {
      const lines = raw.replace(/\r/g, '').split('\n');
      const numQ = /^\(?\d{1,3}\s*[.)]\s*/;
      const qWord = /^q(?:uestion)?\s*\d*\s*[:.)]\s*/i;
      const optRe = /^([*#^~!]?)\s*\(?\s*([a-dA-D])\s*[.)]\s*(.*)$/;
      const tfOpt = /^([*#^~!]?)\s*(true|false)\s*[.)]?\s*$/i;
      const ansRe = /^(?:answer|ans|correct(?:\s*answer)?)\s*[:\-]\s*(.*)$/i;
      const blocks = [];
      const preamble = [];
      let cur = null, skipped = 0, suggestedTitle = '';
      const usePreamble = () => {
        if (!suggestedTitle && preamble.length === 1 && preamble[0].length <= 80) suggestedTitle = preamble[0].replace(/\s+[-–—]\s+.*$/, '').trim();
        preamble.length = 0;
      };
      const flush = () => { if (cur && cur.text) blocks.push(cur); cur = null; };
      const startBlock = (body) => {
        let text = body, star = -1, answer = null;
        const lead = text.match(/^([*#^~!]?)\s*(true|false)\s*[-:.)]\s+(.*)$/i);
        if (lead) {
          if (lead[1]) star = 0;
          answer = /^t/i.test(lead[2]) ? 'true' : 'false';
          text = lead[3];
        } else {
          const trail = text.match(/(.*?)\s*[\u2013\u2014-]\s*(true|false)\s*[.)]?\s*$/i);
          if (trail) { answer = /^t/i.test(trail[2]) ? 'true' : 'false'; text = trail[1]; }
        }
        return { text: text.trim(), options: [], star, answer };
      };
      for (const line of lines) {
        const ln = line.trim();
        if (!ln) continue;
        if (qWord.test(ln)) { usePreamble(); flush(); cur = startBlock(ln.replace(qWord, '')); continue; }
        if (numQ.test(ln)) { usePreamble(); flush(); cur = startBlock(ln.replace(numQ, '')); continue; }
        if (!cur) {
          if (/\?\s*$/.test(ln)) { usePreamble(); cur = { text: ln, options: [], star: -1, answer: null }; }
          else preamble.push(ln);
          continue;
        }
        const om = ln.match(optRe);
        if (om && cur.options.length < 6 && !cur.answer) { if (om[1]) cur.star = cur.options.length; cur.options.push(om[3].trim()); continue; }
        const tm = ln.match(tfOpt);
        if (tm && cur.options.length < 2) {
          const idx = cur.options.length;
          const isTrue = /^t/i.test(tm[2]);
          if (tm[1]) cur.star = idx;
          else if (idx === 0 && cur.answer == null) cur.star = idx;
          cur.options.push(tm[2].charAt(0).toUpperCase() + tm[2].slice(1).toLowerCase());
          continue;
        }
        const am = ln.match(ansRe);
        if (am) { cur.answer = am[1].trim(); continue; }
        if (!cur.options.length && !cur.answer) cur.text += ' ' + ln;
      }
      flush();
      const qs = [];
      let unanswered = 0;
      for (const b of blocks) {
        const norm = b.options.map(o => o.toLowerCase());
        const isTF = norm.length === 2 && (norm[0] === 'true' || norm[0] === 't') && (norm[1] === 'false' || norm[1] === 'f');
        if (b.options.length >= 2) {
          let ca = b.star, resolved = true;
          if (ca < 0 && b.answer != null) {
            const al = b.answer.trim().toLowerCase();
            const m = al.match(/^\(?([a-d])[\).]?$/);
            if (m) ca = m[1].charCodeAt(0) - 97;
            else { const idx = b.options.findIndex(o => o.toLowerCase() === al); if (idx >= 0) ca = idx; else resolved = false; }
          }
          // A bare first True/False line (no * marker) is the answer for TF questions
          if (ca < 0 && isTF) ca = 0;
          if (ca < 0 || ca > b.options.length - 1) { ca = 0; resolved = false; }
          if (!resolved) unanswered++;
          qs.push({ type: isTF ? 'truefalse' : 'mcq', text: b.text.trim(), options: isTF ? ['True', 'False'] : b.options, correctAnswer: ca, points: 100, timeLimit: 20 });
        } else {
          // Single bare True/False answer line under a question, e.g. just "TRUE"
          if (b.options.length === 1) {
            const o = (b.options[0] || '').toLowerCase();
            if (o === 'true' || o === 't') { qs.push({ type: 'truefalse', text: b.text.trim(), options: ['True', 'False'], correctAnswer: 0, points: 100, timeLimit: 20 }); continue; }
            if (o === 'false' || o === 'f') { qs.push({ type: 'truefalse', text: b.text.trim(), options: ['True', 'False'], correctAnswer: 1, points: 100, timeLimit: 20 }); continue; }
          }
          if (!b.answer) { skipped++; continue; }
          const al = b.answer.trim().toLowerCase();
          if (/^(true|t|yes)$/.test(al)) { qs.push({ type: 'truefalse', text: b.text.trim(), options: ['True', 'False'], correctAnswer: 0, points: 100, timeLimit: 20 }); continue; }
          if (/^(false|f|no)$/.test(al)) { qs.push({ type: 'truefalse', text: b.text.trim(), options: ['True', 'False'], correctAnswer: 1, points: 100, timeLimit: 20 }); continue; }
          qs.push({ type: 'identification', text: b.text.trim(), options: [], correctAnswer: b.answer, points: 100, timeLimit: 20 });
        }
      }
      if (skipped) setTimeout(() => Utils.showToast(`${skipped} identification question(s) skipped - no "Answer:" line found`, 'info'), 400);
      return { title: suggestedTitle, unanswered, questions: qs };
    }

    function parseCsvQuiz(raw) {
      const rows = raw.replace(/\r/g, '').split('\n').map(r => r.split(/[,;\t]/).map(c => c.trim())).filter(r => r.some(c => c));
      const qs = [];
      for (const r of rows) {
        const text = (r[0] || '').replace(/^["']|["']$/g, '');
        if (!text || text.toLowerCase() === 'question' || text.toLowerCase() === 'question text') continue;
        const opts = r.slice(1, 5).map(c => c.replace(/^["']|["']$/g, '')).filter(Boolean);
        const ansRaw = (r[5] || '').replace(/^["']|["']$/g, '').trim();
        const pts = parseInt(r[6]) || 100;
        const tl = parseInt(r[7]) || 20;
        if (opts.length >= 2) {
          let ca = 0;
          const al = ansRaw.toLowerCase();
          const m = al.match(/^\(?([a-d])[\).]?$/);
          if (m) ca = m[1].charCodeAt(0) - 97;
          else { const i = opts.findIndex(o => o.toLowerCase() === al); if (i >= 0) ca = i; }
          const norm = opts.map(o => o.toLowerCase());
          const isTF = norm.length === 2 && norm[0] === 'true' && norm[1] === 'false';
          qs.push({ type: isTF ? 'truefalse' : 'mcq', text, options: isTF ? ['True', 'False'] : opts, correctAnswer: Math.min(ca, (isTF ? 1 : opts.length - 1)), points: pts, timeLimit: tl });
        } else if (ansRaw) {
          qs.push({ type: 'identification', text, options: [], correctAnswer: ansRaw, points: pts, timeLimit: tl });
        }
      }
      return qs;
    }

    async function deleteQuiz(qid) {
      if (!confirm('Delete this quiz?')) return;
      await supabaseClient.from('quizzes').delete().eq('id', qid);
      Utils.showToast('Quiz deleted', 'success'); loadQuizzes();
    }

    // USER MANAGEMENT
    async function loadUsers() {
      const { data } = await supabaseClient.from('user_profiles').select('*');
      const tb = document.getElementById('usersTableBody');
      if (!data || data.length === 0) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px;">No users registered</td></tr>'; return; }
      let h = '';
      data.forEach(u => {
        h += `<tr><td><strong>${Utils.sanitize(u.name)}</strong><br><small style="color:var(--text-muted)">${u.id.substring(0,8)}...</small></td>
          <td>${Utils.sanitize(u.year_section || '-')}</td><td>${u.games_played || 0}</td><td>${u.total_points || 0}</td>
          <td><button class="btn btn-sm btn-danger" onclick="banUser('${u.id}')">Ban</button></td></tr>`;
      });
      tb.innerHTML = h;
    }

    async function banUser(uid) {
      if (!confirm('Ban this user?')) return;
      await supabaseClient.from('banned').upsert({ user_id: uid, banned_by: Auth.currentUser.id });
      Utils.showToast('User banned', 'success');
    }

    // LIVE GAME
    // Rebuilds the exact same personal question set each student gets
    // (same seed logic as the player page) so admin can follow along.
    function buildPlayerSet(uid, gid, questions, settings) {
      let list = (questions || []).slice();
      if (settings && settings.shuffleQuestions) list = Utils.seededShuffle(list, Utils.seededRandom(gid + '|' + uid));
      const n = parseInt(settings && settings.itemsPerStudent) || 0;
      if (n > 0 && n < list.length) list = list.slice(0, n);
      return list;
    }

    function currentSettings() {
      return window._currentGameSettings || { shuffleQuestions: false, itemsPerStudent: 0, shuffleOptions: false };
    }

    // Total rounds = size of each student's personal set (everyone answers
    // every round - they just see different questions when shuffle is ON).
    function roundCount() {
      const st = currentSettings();
      const total = (currentGameQuestions || []).length;
      return st.itemsPerStudent > 0 ? Math.min(st.itemsPerStudent, total) : total;
    }

    // Shuffle ON = every student has their own question order (Set A/B/C...),
    // so there is no single "current question" to display on this screen.
    function personalizedMode() { return !!currentSettings().shuffleQuestions; }

    // Timer for the round: the actual question's limit, or (personalized mode)
    // the longest time limit in the quiz so no student is cut off early.
    function adminRoundSeconds() {
      if (!personalizedMode()) {
        const q = currentGameQuestions[currentQuestionIndex];
        return q ? parseInt(q.timeLimit) || 20 : 20;
      }
      let m = 20;
      (currentGameQuestions || []).forEach(q => { const t = parseInt(q.timeLimit) || 20; if (t > m) m = t; });
      return m;
    }

    function startPlayersPoll(gid) {
      stopPlayersPoll();
      const isGroupMode = (window._currentGameSettings && window._currentGameSettings.mode === 'group');
      if (isGroupMode) {
        startGroupsPoll(gid);
        return;
      }
      playersPollInterval = setInterval(async () => {
        const { data } = await supabaseClient.from('game_players').select('*').eq('game_id', gid);
        if (data) {
          let h = '';
          data.forEach(p => { h += `<div class="player-card"><span class="initial-avatar">${Utils.sanitize(p.player_name).charAt(0).toUpperCase()}</span><span class="player-name">${Utils.sanitize(p.player_name)}</span></div>`; });
          document.getElementById('playersGrid').innerHTML = h;
          document.getElementById('playerCount').textContent = `${data.length} player${data.length !== 1 ? 's' : ''} joined`;
        }
      }, 2000);
    }

    function startGroupsPoll(gid) {
      playersPollInterval = setInterval(async () => {
        const groupSize = (window._currentGameSettings && window._currentGameSettings.groupSize) || 2;
        const [playersRes, groupsRes] = await Promise.all([
          supabaseClient.from('game_players').select('*').eq('game_id', gid),
          supabaseClient.from('game_groups').select('*').eq('game_id', gid)
        ]);
        const players = playersRes.data || [];
        const groups = groupsRes.data || [];
        document.getElementById('playerCount').textContent = `${players.length} player${players.length !== 1 ? 's' : ''} joined • teams of ${groupSize}`;
        if (!groups.length) {
          document.getElementById('playersGrid').innerHTML = `<div class="player-card" style="grid-column:1/-1;"><span class="initial-avatar">👥</span><span class="player-name" style="color:var(--text-secondary);">Waiting for players to form their groups...</span></div>`;
          return;
        }
        const byGroup = {};
        players.forEach(p => { if (p.group_id) (byGroup[p.group_id] = byGroup[p.group_id] || []).push(p); });
        let h = '';
        groups.forEach((g, gi) => {
          const members = byGroup[g.id] || [];
          const full = members.length >= groupSize;
          h += `<div class="player-card" style="flex-direction:column; align-items:flex-start; gap:6px; border:1px solid ${full ? 'rgba(34,197,94,0.4)' : 'var(--card-border)'};">
            <span style="font-weight:700; font-size:0.85rem; color:${full ? 'var(--success)' : 'var(--accent)'};">Group ${gi+1} (${members.length}/${groupSize}) ${full ? '✓ Full' : ''}</span>
            <span style="font-size:0.8rem; color:var(--text-secondary);">${members.map(m => Utils.sanitize(m.player_name)).join(', ') || '<em>empty group</em>'}</span>
          </div>`;
        });
        const unassigned = players.filter(p => !p.group_id);
        if (unassigned.length) {
          h += `<div class="player-card" style="flex-direction:column; align-items:flex-start; gap:6px; border:1px dashed var(--warning);">
            <span style="font-weight:700; font-size:0.85rem; color:var(--warning);">Looking for a group (${unassigned.length})</span>
            <span style="font-size:0.8rem; color:var(--text-secondary);">${unassigned.map(m => Utils.sanitize(m.player_name)).join(', ')}</span>
          </div>`;
        }
        document.getElementById('playersGrid').innerHTML = h;
      }, 2000);
    }

    function stopPlayersPoll() { if (playersPollInterval) { clearInterval(playersPollInterval); playersPollInterval = null; } }

    async function getCheatTotals(gid) {
      const { data: cl } = await supabaseClient.from('cheat_logs').select('user_id,points').eq('game_id', gid);
      const map = {};
      (cl || []).forEach(c => { map[c.user_id] = (map[c.user_id] || 0) + (c.points || 0); });
      return map;
    }

    function startAnswersPoll(gid) {
      stopAnswersPoll();
      answersPollInterval = setInterval(async () => {
        const { data: players } = await supabaseClient.from('game_players').select('*').eq('game_id', gid);
        if (!players) return;
        window._livePlayers = {};
        window._livePlayersArr = players;
        players.forEach(p => { window._livePlayers[p.user_id] = p.player_name; });
        const cheatMap = await getCheatTotals(gid);
        // Personalized sets: every joined player answers EVERY round
        let h = '', answered = 0;
        const total = players.length;
        for (const p of players) {
          const { data: ad } = await supabaseClient.from('game_answers').select('*').eq('game_id', gid).eq('user_id', p.user_id).eq('question_index', currentQuestionIndex).single();
          if (ad) answered++;
          let sc = 'waiting', st2 = 'Waiting...';
          if (ad) { sc = ad.correct ? 'correct' : 'incorrect'; st2 = ad.correct ? 'Correct' : 'Wrong'; }
          const cp = cheatMap[p.user_id] || 0;
          h += `<div class="answer-card ${sc}"><strong style="font-size:0.85rem;">${Utils.sanitize(p.player_name)}</strong><br><small>${st2}${cp ? ` &bull; <strong style="color:#DC2626;">${cp} pts</strong>` : ''}</small><button class="btn btn-sm btn-danger" style="margin-top:6px; width:100%;" onclick="penalizePlayer('${p.user_id}')">− Points</button></div>`;
        }
        document.getElementById('answerGrid').innerHTML = h;
        document.getElementById('answersReceived').textContent = `${answered}/${total} answered`;
      }, 2000);
    }

    async function penalizePlayer(uid) {
      if (!currentGameId) return;
      const name = (window._livePlayers || {})[uid] || 'Player';
      const val = prompt(`Minus points for ${name}:\nEnter the amount (e.g. 10 = -10 points)`, '10');
      if (val === null) return;
      const pts = -Math.abs(parseInt(val) || 0);
      if (!pts) return Utils.showToast('Enter a valid number', 'error');
      const reason = prompt('Reason:', 'Cheating') || 'Manual penalty';
      const { error } = await supabaseClient.from('cheat_logs').insert([{ game_id: currentGameId, user_id: uid, round_index: currentQuestionIndex, points: pts, reason, given_by: Auth.currentUser.id }]);
      if (error) return Utils.showToast('Failed to apply penalty', 'error');
      Utils.showToast(`${name}: ${pts} points (${reason})`, 'success');
    }

    function stopAnswersPoll() { if (answersPollInterval) { clearInterval(answersPollInterval); answersPollInterval = null; } }

    function onGameModeChange(sel) {
      const groupSizeEl = document.getElementById('groupSizeGroup');
      groupSizeEl.style.display = sel.value === 'group' ? 'block' : 'none';
    }

    async function createGame() {
      const quizId = document.getElementById('gameQuizSelect').value;
      if (!quizId) return Utils.showToast('Select a quiz', 'error');
      const mode = document.getElementById('gameMode').value;
      const groupSize = parseInt(document.getElementById('groupSize').value) || 5;
      const shuffleQuestions = document.getElementById('gameShuffle').value === 'on';
      const shuffleOptions = document.getElementById('gameShuffleOptions').value === 'on';
      const cheatPenalty = parseInt(document.getElementById('gameCheatPenalty').value) || 0;
      const pin = Utils.generateGamePin();
      const { data: quiz } = await supabaseClient.from('quizzes').select('*').eq('id', quizId).single();
      if (!quiz) return Utils.showToast('Quiz not found', 'error');
      let itemsPerStudent = parseInt(document.getElementById('gameItemsPerStudent').value) || 0;
      if (itemsPerStudent > quiz.questions.length) {
        itemsPerStudent = quiz.questions.length;
        document.getElementById('gameItemsPerStudent').value = itemsPerStudent;
        Utils.showToast(`Quiz only has ${quiz.questions.length} questions - adjusted items per student.`, 'info');
      }
      if (itemsPerStudent < 0) itemsPerStudent = 0;
      const { data: gd } = await supabaseClient.from('games').insert({ pin, quiz_id: quizId, quiz_title: quiz.title, host_id: Auth.currentUser.id, mode, group_size: mode === 'group' ? groupSize : 1, status: 'waiting', questions: quiz.questions, current_question: 0, shuffle_questions: shuffleQuestions, questions_per_player: itemsPerStudent, shuffle_options: shuffleOptions, anti_cheat_penalty: cheatPenalty }).select();
      if (!gd) return Utils.showToast('Error creating game', 'error');
      currentGameId = gd[0].id;
      window._currentGameSettings = { shuffleQuestions, itemsPerStudent, shuffleOptions, mode, groupSize };
      const note = document.getElementById('shuffleNote');
      if (shuffleQuestions || shuffleOptions) {
        let parts = [];
        if (itemsPerStudent > 0 && itemsPerStudent < quiz.questions.length) parts.push(`each student gets ${itemsPerStudent} random of ${quiz.questions.length}, all at once`);
        else if (shuffleQuestions) parts.push('shuffled order per student, all at once');
        if (shuffleOptions) parts.push('shuffled choices');
        note.textContent = 'Anti-cheat ON: ' + parts.join(', ') + '. Every student answers every round with their own question.';
        note.style.display = 'block';
      } else note.style.display = 'none';
      document.getElementById('gamePinDisplay').textContent = pin;
      document.getElementById('gameSetup').style.display = 'none';
      document.getElementById('gameWaitingRoom').style.display = 'block';
      startPlayersPoll(currentGameId);
      Utils.showToast('Game created!', 'success');
    }

    async function startGame() {
      const { data: g, error: gErr } = await supabaseClient.from('games').select('*').eq('id', currentGameId).single();
      if (gErr || !g) return Utils.showToast('Error loading game', 'error');
      currentGameQuestions = g.questions; currentQuestionIndex = 0;
      window._currentGameSettings = { shuffleQuestions: !!g.shuffle_questions, itemsPerStudent: parseInt(g.questions_per_player) || 0, shuffleOptions: !!g.shuffle_options };
      pauseWasMidQuestion = false;
      document.getElementById('pauseBtn').textContent = 'Pause';
      // ONE atomic write: players see the first question on the very next
      // poll/realtime event with everything they need already included.
      const { error } = await supabaseClient.from('games').update({ status: 'answering', current_question: 0, question_started_at: new Date().toISOString(), pause_total_ms: 0, paused_at: null }).eq('id', currentGameId);
      if (error) return Utils.showToast('Error starting game', 'error');
      document.getElementById('gameWaitingRoom').style.display = 'none';
      document.getElementById('gameInPlay').style.display = 'block';
      document.getElementById('totalQNum').textContent = roundCount();
      await showCurrentQuestion();
    }

    let pauseWasMidQuestion = false;
    async function togglePause() {
      if (!currentGameId || endGameBusy) return;
      const { data: g } = await supabaseClient.from('games').select('*').eq('id', currentGameId).single();
      if (!g) return;
      const btn = document.getElementById('pauseBtn');
      const nowIso = new Date().toISOString();
      if (g.status === 'answering' || g.status === 'active') {
        pauseWasMidQuestion = true;
        clearInterval(adminTimerInterval);
        // Players freeze their countdown the moment they see status = paused
        const { error } = await supabaseClient.from('games').update({ status: 'paused', paused_at: nowIso }).eq('id', currentGameId);
        if (error) return Utils.showToast('Pause failed', 'error');
        btn.textContent = 'Resume';
        Utils.showToast('Quiz paused for everyone', 'success');
      } else if (g.status === 'paused') {
        let extraMs = 0;
        if (g.paused_at) extraMs = Math.max(0, Date.now() - new Date(g.paused_at).getTime());
        const { error } = await supabaseClient.from('games').update({ status: 'answering', paused_at: null, pause_total_ms: (g.pause_total_ms || 0) + extraMs }).eq('id', currentGameId);
        if (error) return Utils.showToast('Resume failed', 'error');
        btn.textContent = 'Pause';
        Utils.showToast('Quiz resumed', 'success');
        if (pauseWasMidQuestion && currentGameQuestions[currentQuestionIndex]) startAdminTimer(adminRoundSeconds());
      }
    }

    async function showCurrentQuestion() {
      const q = currentGameQuestions[currentQuestionIndex];
      document.getElementById('currentQNum').textContent = currentQuestionIndex + 1;
      const pct = ((currentQuestionIndex + 1) / roundCount()) * 100;
      document.getElementById('gameProgressFill').style.width = `${pct}%`;
      let h;
      if (personalizedMode()) {
        // Every student is on their OWN question this round - showing one
        // specific question here would be wrong.
        h = `<h3 style="margin-bottom:6px;">Round ${currentQuestionIndex + 1} of ${roundCount()}</h3>
             <span class="question-points">Shuffled personal sets active</span>
             <p style="color:var(--text-muted); margin-top:10px; font-size:0.9rem;">Each student is answering their own shuffled question right now (Set A / Set B / ...). Their results below update live.</p>`;
      } else {
        h = `<h3 style="margin-bottom:10px;">${Utils.sanitize(q.text)}</h3>`;
        if (q.imageUrl) h += `<img src="${q.imageUrl}" style="max-width:280px; border-radius:8px; margin-bottom:10px;">`;
        h += `<span class="question-points">${q.points} pts &bull; ${q.timeLimit}s</span>`;
      }
      document.getElementById('currentQuestionDisplay').innerHTML = h;
      // Server timestamp drives every player's countdown (pause-proof + refresh-proof)
      const { error } = await supabaseClient.from('games').update({ status: 'answering', current_question: currentQuestionIndex, question_started_at: new Date().toISOString(), pause_total_ms: 0, paused_at: null }).eq('id', currentGameId);
      if (error) console.error('Failed to update game status:', error);
      startAdminTimer(adminRoundSeconds());
      startAnswersPoll(currentGameId);
    }

    async function startAdminTimer(sec) {
      clearInterval(adminTimerInterval); let r = sec;
      const el = document.getElementById('adminTimer'); el.textContent = r; el.className = 'timer-circle timer-green';
      adminTimerInterval = setInterval(async () => {
        r--; el.textContent = r;
        if (r <= 10) el.className = 'timer-circle timer-yellow';
        if (r <= 5) el.className = 'timer-circle timer-red';
        if (r <= 0) { clearInterval(adminTimerInterval); await supabaseClient.from('games').update({ status: 'feedback' }).eq('id', currentGameId); }
      }, 1000);
    }

    async function nextQuestion() {
      clearInterval(adminTimerInterval); stopAnswersPoll();
      currentQuestionIndex++;
      // Rounds are capped at each student's personal set size
      if (currentQuestionIndex >= roundCount()) { await endGame(); return; }
      await showCurrentQuestion();
    }

    async function showLeaderboard() {
      clearInterval(adminTimerInterval);
      const { data: players } = await supabaseClient.from('game_players').select('*').eq('game_id', currentGameId);
      if (!players) return;
      const { data: aa } = await supabaseClient.from('game_answers').select('*').eq('game_id', currentGameId);
      const { data: game } = await supabaseClient.from('games').select('mode,group_size').eq('id', currentGameId).single();
      const cheatMap = await getCheatTotals(currentGameId);
      const isGroup = !!(game && game.mode === 'group');
      const groupSize = (game && game.group_size) || 2;

      const pw = players.map(p => {
        const pa = aa ? aa.filter(a => a.user_id === p.user_id) : [];
        let ts = 0, cc = 0; pa.forEach(a => { ts += a.score || 0; if (a.correct) cc++; });
        ts = Math.max(0, ts + (cheatMap[p.user_id] || 0));
        return { ...p, totalScore: ts, correctCount: cc };
      }).sort((a, b) => b.totalScore - a.totalScore);

      let h = '<h3 style="text-align:center; margin-bottom:20px;">' + (isGroup ? 'Group Leaderboard (combined scores)' : 'Leaderboard') + '</h3>';

      if (isGroup) {
        const { data: groups } = await supabaseClient.from('game_groups').select('*').eq('game_id', currentGameId);
        const gmap = {};
        groups.forEach(g => gmap[g.id] = g);
        const teamRows = [];
        const grouped = {};
        pw.forEach(p => { const gid2 = p.group_id || 'none'; (grouped[gid2] = grouped[gid2] || []).push(p); });
        Object.keys(grouped).forEach(k => {
          const members = grouped[k];
          if (k === 'none') { members.forEach(m => teamRows.push({ name: Utils.sanitize(m.player_name) + ' <span style="font-weight:400;color:var(--text-muted);">(no group)</span>', total: m.totalScore })); return; }
          const g = gmap[k];
          const total = members.reduce((s, m) => s + m.totalScore, 0);
          const names = members.map(m => Utils.sanitize(m.player_name)).join(', ');
          teamRows.push({ name: `${names} <span style="font-weight:400;color:var(--text-muted);">${members.length}/${groupSize}</span>`, total });
        });
        teamRows.sort((a, b) => b.total - a.total);
        teamRows.slice(0, 10).forEach((t, i) => {
          const ri = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}th`;
          h += `<div class="leaderboard-entry"><span class="rank">${ri}</span><span class="leaderboard-name">${t.name}</span><span class="leaderboard-score">${t.total} pts</span></div>`;
        });
      } else {
        pw.slice(0, 10).forEach((p, i) => {
          const ri = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}th`;
          h += `<div class="leaderboard-entry"><span class="rank">${ri}</span><span class="leaderboard-name"><span class="initial-avatar">${Utils.sanitize(p.player_name).charAt(0).toUpperCase()}</span>${Utils.sanitize(p.player_name)}</span><span class="leaderboard-score">${p.totalScore} pts</span></div>`;
        });
      }
      document.getElementById('currentQuestionDisplay').innerHTML = h;
      document.getElementById('answerGrid').innerHTML = '';
    }

    let endGameBusy = false;
    async function endGame() {
      if (endGameBusy || !currentGameId) return;
      endGameBusy = true;
      clearInterval(adminTimerInterval); stopPlayersPoll(); stopAnswersPoll();
      const gid = currentGameId;
      try {
        await supabaseClient.from('games').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', gid);
        const { data: players } = await supabaseClient.from('game_players').select('*').eq('game_id', gid);
        const { data: game } = await supabaseClient.from('games').select('*').eq('id', gid).single();
        const { data: aa } = await supabaseClient.from('game_answers').select('*').eq('game_id', gid);
        const { data: existingRows } = await supabaseClient.from('leaderboards').select('user_id').eq('game_id', gid);
        const have = new Set((existingRows || []).map(r => r.user_id));
        const cheatMap = await getCheatTotals(gid);
        const entries = [];
        const gSettings = { shuffleQuestions: !!game.shuffle_questions, itemsPerStudent: parseInt(game.questions_per_player) || 0, shuffleOptions: !!game.shuffle_options };
        for (const p of (players || [])) {
          if (have.has(p.user_id)) continue;
          const pa = aa ? aa.filter(a => a.user_id === p.user_id) : [];
          let ts = 0, cc = 0; pa.forEach(a => { ts += a.score || 0; if (a.correct) cc++; });
          const cp = cheatMap[p.user_id] || 0;
          // Total questions = the size of THIS player's personal set, not the whole quiz
          const myTotal = buildPlayerSet(p.user_id, gid, game.questions, gSettings).length;
          entries.push({ user_id: p.user_id, player_name: p.player_name, quiz_title: game.quiz_title, total_score: Math.max(0, ts + cp), correct_count: cc, total_questions: myTotal, violation_points: cp, game_id: gid });
        }
        if (entries.length) await supabaseClient.from('leaderboards').insert(entries);
        Utils.showToast(`Game ended! Results saved for ${entries.length} player(s).`, 'success');
      } catch (e) { console.error(e); Utils.showToast('Error saving results', 'error'); }
      endGameBusy = false;
      document.getElementById('gameInPlay').style.display = 'none';
      document.getElementById('gameSetup').style.display = 'block';
      currentGameId = null;
      loadCompletedGames();
    }

    // REPORTS
    async function loadCompletedGames() {
      const { data } = await supabaseClient.from('games').select('*').eq('host_id', Auth.currentUser.id).eq('status', 'ended').order('ended_at', { ascending: false });
      const sel = document.getElementById('reportGameSelect');
      sel.innerHTML = '<option value="">-- Select a game --</option>';
      if (data) data.forEach(g => { sel.innerHTML += `<option value="${g.id}">${Utils.sanitize(g.quiz_title)} - ${g.pin}</option>`; });
    }

    async function loadReport() {
      const gid = document.getElementById('reportGameSelect').value;
      if (!gid) return Utils.showToast('Select a game', 'error');
      Utils.showLoading();
      const { data: game } = await supabaseClient.from('games').select('*').eq('id', gid).single();
      const { data: players } = await supabaseClient.from('game_players').select('*').eq('game_id', gid);
      const { data: aa } = await supabaseClient.from('game_answers').select('*').eq('game_id', gid);
      const { data: cl } = await supabaseClient.from('cheat_logs').select('user_id,points').eq('game_id', gid);
      const vCount = {}, vPts = {};
      (cl || []).forEach(c => { vCount[c.user_id] = (vCount[c.user_id] || 0) + 1; vPts[c.user_id] = (vPts[c.user_id] || 0) + (c.points || 0); });
      const rSettings = { shuffleQuestions: !!game.shuffle_questions, itemsPerStudent: parseInt(game.questions_per_player) || 0, shuffleOptions: !!game.shuffle_options };
      reportData = [];
      for (const p of (players || [])) {
        const pa = aa ? aa.filter(a => a.user_id === p.user_id) : [];
        let ts = 0, cc = 0; pa.forEach(a => { ts += a.score || 0; if (a.correct) cc++; });
        ts = Math.max(0, ts + (vPts[p.user_id] || 0));
        const myTotal = buildPlayerSet(p.user_id, gid, game.questions, rSettings).length;
        reportData.push({ Name: p.player_name, 'Total Score': ts, 'Correct Answers': cc, 'Total Questions': myTotal, 'Accuracy %': myTotal ? Math.round((cc / myTotal) * 100) : 0, Violations: vCount[p.user_id] || 0, 'Penalty Pts': Math.abs(vPts[p.user_id] || 0) });
      }
      reportData.sort((a, b) => b['Total Score'] - a['Total Score']);
      let h = '<table class="user-table"><thead><tr><th>#</th><th>Student</th><th>Score</th><th>Correct</th><th>Accuracy</th><th>Violations</th><th>Penalty</th></tr></thead><tbody>';
      reportData.forEach((r, i) => { h += `<tr><td>${i+1}</td><td>${Utils.sanitize(r.Name)}</td><td>${r['Total Score']}</td><td>${r['Correct Answers']}/${r['Total Questions']}</td><td>${r['Accuracy %']}%</td><td>${r.Violations}</td><td>${r['Penalty Pts'] ? '-' + r['Penalty Pts'] : '0'}</td></tr>`; });
      h += '</tbody></table>';
      document.getElementById('reportResults').innerHTML = h;
      // Summary cards above the table
      const n = reportData.length;
      const avgAcc = n ? Math.round(reportData.reduce((s, r) => s + r['Accuracy %'], 0) / n) : 0;
      const top = reportData[0];
      const totalViol = reportData.reduce((s, r) => s + r.Violations, 0);
      document.getElementById('reportSummary').innerHTML = `
        <div class="stat-box"><div class="stat-value">${n}</div><div class="stat-label">Students</div></div>
        <div class="stat-box"><div class="stat-value">${avgAcc}%</div><div class="stat-label">Class Average</div></div>
        <div class="stat-box"><div class="stat-value">${top ? Utils.sanitize(top.Name.split(' ')[0]) : '-'}</div><div class="stat-label">Top Scorer (${top ? top['Total Score'] : 0} pts)</div></div>
        <div class="stat-box"><div class="stat-value">${totalViol}</div><div class="stat-label">Violations</div></div>`;
      Utils.hideLoading();
    }

    function exportReport() {
      if (!reportData.length) return Utils.showToast('Load a report first', 'error');
      Utils.downloadCSV(reportData, `quiz-report-${Date.now()}.csv`);
    }

    // =============================================
    // ADD QUESTION MODAL — Two-step flow
    // =============================================
    let aqCurrentStep = 1;
    let aqSelectedType = '';
    let aqImageData = null;
    let aqPendingQuestions = [];

    function openAddQuestionModal() {
      aqCurrentStep = 1;
      aqSelectedType = '';
      aqImageData = null;
      aqPendingQuestions = [];
      resetAqForm();
      updateAqSteps();
      document.getElementById('addQuestionModal').classList.add('active');
    }

    function closeQuestionModal() {
      document.getElementById('addQuestionModal').classList.remove('active');
    }

    function resetAqForm() {
      document.getElementById('aqQuestionText').value = '';
      document.getElementById('aqSmartPaste').value = '';
      document.getElementById('aqOptA').value = '';
      document.getElementById('aqOptB').value = '';
      document.getElementById('aqOptC').value = '';
      document.getElementById('aqOptD').value = '';
      document.getElementById('aqIdAnswer').value = '';
      document.getElementById('aqPoints').value = '100';
      document.getElementById('aqTimeLimit').value = '20';
      document.getElementById('aqImageFile').value = '';
      document.getElementById('aqImageName').textContent = '';
      document.getElementById('aqImagePreview').style.display = 'none';
      const mcq0 = document.querySelector('input[name="aqMcqCorrect"][value="0"]');
      if (mcq0) mcq0.checked = true;
      const tf0  = document.querySelector('input[name="aqTfCorrect"][value="0"]');
      if (tf0)  tf0.checked  = true;
      document.querySelectorAll('.qtype-card').forEach(c => c.classList.remove('selected'));
      document.getElementById('aqMcqGroup').style.display = 'block';
      document.getElementById('aqTfGroup').style.display  = 'none';
      document.getElementById('aqIdGroup').style.display  = 'none';
    }

    function updateAqSteps() {
      for (let i = 1; i <= 2; i++) {
        const stepEl = document.getElementById('aqStep' + i);
        const contentEl = document.getElementById('aqContent' + i);
        stepEl.classList.remove('active', 'done');
        contentEl.classList.remove('active');
        if (i < aqCurrentStep) stepEl.classList.add('done');
        if (i === aqCurrentStep) stepEl.classList.add('active');
        if (i === aqCurrentStep) contentEl.classList.add('active');
      }
      document.getElementById('aqLine1').classList.toggle('done', aqCurrentStep > 1);
      const backBtn = document.getElementById('aqBackBtn');
      const nextBtn = document.getElementById('aqNextBtn');
      backBtn.style.display = aqCurrentStep > 1 ? 'inline-flex' : 'none';
      if (aqCurrentStep === 2) {
        aqUpdatePasteCount();
        nextBtn.className = 'btn btn-success';
        aqShowTypeFields();
        document.getElementById('aqSmartPaste').focus();
      } else {
        nextBtn.textContent = 'Next \u2192';
        nextBtn.className = 'btn btn-primary';
      }
    }

    function aqShowTypeFields(overrideType) {
      const t = overrideType || aqSelectedType;
      document.getElementById('aqMcqGroup').style.display = t === 'mcq' ? 'block' : 'none';
      document.getElementById('aqTfGroup').style.display = t === 'truefalse' ? 'block' : 'none';
      document.getElementById('aqIdGroup').style.display = t === 'identification' ? 'block' : 'none';
    }

    function aqGoToStep(step) {
      aqCurrentStep = step;
      updateAqSteps();
    }

    function aqNext() {
      if (aqCurrentStep === 1) {
        if (!aqSelectedType) {
          Utils.showToast('Please select a question type', 'error');
          return;
        }
        aqGoToStep(2);
      } else if (aqCurrentStep === 2) {
        saveQuestionFromModal();
      }
    }

    function aqBack() {
      if (aqCurrentStep > 1) {
        aqCurrentStep--;
        updateAqSteps();
      }
    }

    function modalSelectType(type, el) {
      aqSelectedType = type;
      document.querySelectorAll('.qtype-card').forEach(c => c.classList.remove('selected'));
      if (el) el.classList.add('selected');
      // Auto-advance straight to the paste / details step
      aqGoToStep(2);
    }

    // ---- SMART PASTE: parses MANY questions at once ----
    function stripLoose(s) {
      return s.replace(/^\s*[#*^~!]\s*/, '').trim();
    }

    function aqParseBlocks(raw) {
      const lines = raw.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
      const blocks = [];
      let cur = null;
      const numRe    = /^(\d{1,3})\s*[.)]\s*(.*)$/;
      const qWordRe  = /^q(?:uestion)?\s*\d*\s*[:.)]\s*/i;
      const optRe    = /^([#*^~!]?)\s*\(?([a-dA-D])\s*[.)]\s*(.*)$/;
      const tfRe     = /^([#*^~!]?)\s*(true|false|t|f)\s*[.)]?\s*$/i;
      const ansRe    = /^(?:answer|ans|correct(?:\s*answer)?)\s*[:=]\s*(.*)$/i;
      const flush    = () => { if (cur && cur.text) blocks.push(cur); cur = null; };

      const newBlock = (body) => {
        let text = body, answer = '', tfIdx = -1, labelType = null;
        // Strip type labels like "1. True or False:", "Multiple Choice:", "Identification:"
        // so they never end up inside the question text - and remember the type hint.
        const lbl = text.match(/^(?:true\s+or\s+false|t\/f|true\s*false|multiple\s*choice|mcq|identification|fill\s+in\s+the\s+blank|enumeration|short\s+answer)\s*[:.)-]?\s*/i);
        if (lbl) {
          labelType = /true\s+or\s+false|t\/f|true\s*false/i.test(lbl[0]) ? 'truefalse'
            : /multiple|mcq/i.test(lbl[0]) ? 'mcq'
            : 'identification';
          text = text.slice(lbl[0].length);
        }
        const lead  = text.match(/^([#*^~!]?)\s*(true|false)\s*[-:.)]\s+(.*)$/i);
        if (lead)  { answer = lead[2]; tfIdx = /^t/i.test(lead[2]) ? 0 : 1; text = lead[3]; }
        if (!answer) {
          const trail = text.match(/(.*?)\s*[-\u2013\u2014]\s*(true|false)\s*[.)]?\s*$/i);
          if (trail) { answer = trail[2]; tfIdx = /^t/i.test(trail[2]) ? 0 : 1; text = trail[1]; }
        }
        return { text: stripLoose(text), options: [], correct: -1, answer, tf: tfIdx, labelType };
      };

      for (const ln of lines) {
        const nm = ln.match(numRe);
        const qm = !nm && ln.match(qWordRe);
        if (nm || qm) { flush(); cur = newBlock(nm ? nm[2] : ln.replace(qWordRe, '')); continue; }
        if (!cur) cur = { text: '', options: [], correct: -1, answer: '', tf: -1 };

        const om = ln.match(optRe);
        if (om && cur.options.length < 6) {
          const idx = cur.options.length;
          if (om[1]) cur.correct = idx;
          cur.options.push(om[3].trim());
          continue;
        }
        const tm = ln.match(tfRe);
        if (tm && cur.options.length < 2) {
          const idx = cur.options.length;
          const val = tm[2].charAt(0).toUpperCase() + tm[2].slice(1).toLowerCase();
          const isTrue = /^t/i.test(tm[2]);
          if (tm[1]) { cur.correct = idx; cur.tf = idx; }
          else if (idx === 0 && !cur.answer) { cur.tf = isTrue ? 0 : 1; }
          cur.options.push(val);
          continue;
        }
        const am = ln.match(ansRe);
        if (am) { if (!cur.answer) cur.answer = am[1].trim(); continue; }
        if (!cur.options.length && !cur.answer && cur.tf < 0) cur.text += (cur.text ? ' ' : '') + stripLoose(ln).replace(/^\d{1,3}[.)]\s*/, '');
      }
      flush();
      return blocks;
    }

    function aqBlockToQuestion(b) {
      const text = b.text.trim();
      if (!text) return null;
      const optIsTF  = b.options.length === 2 && /^true$/i.test(b.options[0]) && /^false$/i.test(b.options[1]);
      const ansLc    = (b.answer || '').trim().toLowerCase();
      let tfAns = -1;
      if (/^(true|t|yes|tama)$/.test(ansLc)) tfAns = 0;
      else if (/^(false|f|no|mali)$/.test(ansLc)) tfAns = 1;

      // True / False
      if (optIsTF || tfAns >= 0 || b.tf >= 0 || b.labelType === 'truefalse') {
        let correct = b.correct >= 0 ? b.correct : (tfAns >= 0 ? tfAns : b.tf);
        const resolved = correct >= 0;
        if (correct < 0) correct = 0;
        return { type: 'truefalse', text, options: ['True', 'False'], correctAnswer: correct, points: 100, timeLimit: 20, imageUrl: null, answerResolved: resolved };
      }

      // Multiple choice
      if (b.options.length >= 2 || b.labelType === 'mcq') {
        let correct = b.correct;
        if (correct < 0 && b.answer) {
          // "Answer: C. Mouse", "Answer: C) Mouse" - letter prefix + option text together
          const prefixed = b.answer.trim().match(/^\s*\(?\s*([a-dA-D])\s*[).:]\s*(.+)$/);
          if (prefixed) {
            const li = prefixed[1].toLowerCase().charCodeAt(0) - 97;
            const textIdx = b.options.findIndex(o => o && o.toLowerCase() === prefixed[2].trim().toLowerCase());
            if (textIdx >= 0) correct = textIdx;
            else if (li >= 0 && li < b.options.length) correct = li;
          }
          if (correct < 0) {
            const lm = b.answer.match(/^\(?\s*([a-dA-D])\s*[).\s]*$/);
            if (lm) correct = lm[1].toLowerCase().charCodeAt(0) - 97;
          }
          if (correct < 0) {
            const idx = b.options.findIndex(o => o && o.toLowerCase() === ansLc);
            if (idx >= 0) correct = idx;
          }
        }
        const selected = b.options.slice(0, 4);
        const resolved = correct >= 0 && correct < selected.length;
        if (correct < 0) correct = 0;
        if (correct >= selected.length) correct = selected.length - 1;
        return { type: 'mcq', text, options: selected, correctAnswer: correct, points: 100, timeLimit: 20, imageUrl: null, answerResolved: resolved };
      }

      // Identification
      if (b.answer) return { type: 'identification', text, options: [], correctAnswer: b.answer, points: 100, timeLimit: 20, imageUrl: null, answerResolved: true };
      if (b.options.length === 1) return { type: 'identification', text, options: [], correctAnswer: b.options[0], points: 100, timeLimit: 20, imageUrl: null, answerResolved: true };
      if (b.labelType === 'identification') return { type: 'identification', text, options: [], correctAnswer: '', points: 100, timeLimit: 20, imageUrl: null, answerResolved: false };

      // No options & no answer detected - still create the question so nothing is lost,
      // but flag it as UNRESOLVED so the admin is told to set the answer.
      if (aqSelectedType === 'truefalse')  return { type: 'truefalse', text, options: ['True', 'False'], correctAnswer: 0, points: 100, timeLimit: 20, imageUrl: null, answerResolved: false };
      if (aqSelectedType === 'identification') return { type: 'identification', text, options: [], correctAnswer: '', points: 100, timeLimit: 20, imageUrl: null, answerResolved: false };
      return null;
    }

    function aqSmartParse(ta) {
      const raw = ta.value;
      if (!raw.trim()) {
        aqPendingQuestions = [];
        aqUpdatePasteCount();
        return;
      }
      const blocks = aqParseBlocks(raw);
      aqPendingQuestions = blocks.map(b => aqBlockToQuestion(b)).filter(Boolean);
      aqShowTypeFields();
      if (aqPendingQuestions.length === 1) {
        const q = aqPendingQuestions[0];
        aqShowTypeFields(q.type);
        document.getElementById('aqQuestionText').value = q.text;
        if (q.type === 'mcq') {
          ['A', 'B', 'C', 'D'].forEach((L, i) => {
            const el = document.getElementById('aqOpt' + L);
            if (el) el.value = q.options[i] || '';
          });
          const r = document.querySelector(`input[name="aqMcqCorrect"][value="${Math.min(q.correctAnswer, 3)}"]`);
          if (r) r.checked = true;
        } else if (q.type === 'truefalse') {
          const r = document.querySelector(`input[name="aqTfCorrect"][value="${q.correctAnswer ? 1 : 0}"]`);
          if (r) r.checked = true;
        } else {
          document.getElementById('aqIdAnswer').value = q.correctAnswer;
        }
      } else if (aqPendingQuestions.length > 1) {
        document.getElementById('aqQuestionText').value = '';
        ['A', 'B', 'C', 'D'].forEach(L => { const el = document.getElementById('aqOpt' + L); if (el) el.value = ''; });
        document.getElementById('aqIdAnswer').value = '';
      } else if (blocks.length) {
        document.getElementById('aqQuestionText').value = blocks[0].text;
      }
      aqUpdatePasteCount();
    }

    function aqUpdatePasteCount() {
      const el = document.getElementById('aqPasteCount');
      if (el) {
        const n = aqPendingQuestions.length;
        el.innerHTML = n
          ? `<strong style="color:var(--accent);">${n}</strong> question${n !== 1 ? 's' : ''} detected - * # and prefixes are removed automatically`
          : 'Paste or type above - it converts automatically.';
      }
      const nextBtn = document.getElementById('aqNextBtn');
      if (aqCurrentStep === 2 && nextBtn) {
        const n = aqPendingQuestions.length;
        nextBtn.textContent = n > 1 ? `+ Add ${n} Questions` : '+ Add Question';
      }
    }

    // Auto-strip markers / letter prefixes in the option & answer fields on paste
    document.querySelectorAll('.aq-auto-clean').forEach(el => {
      el.addEventListener('paste', () => {
        setTimeout(() => {
          el.value = el.value.trim()
            .replace(/^\s*(?:[#*^~!])?\s*\(?[a-dA-D]\s*[.)]\s*/, '')
            .replace(/^\s*[#*^~!]\s*/, '')
            .replace(/^\s*\d{1,3}[.)]\s*/, '');
          el.dispatchEvent(new Event('input'));
        }, 30);
      });
    });

    function aqHandleImage(input) {
      const f = input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = e => {
        aqImageData = e.target.result;
        document.getElementById('aqPreviewImg').src = aqImageData;
        document.getElementById('aqImagePreview').style.display = 'block';
        document.getElementById('aqImageName').textContent = f.name;
      };
      r.readAsDataURL(f);
    }

    function aqRemoveImage() {
      aqImageData = null;
      document.getElementById('aqImageFile').value = '';
      document.getElementById('aqImageName').textContent = '';
      document.getElementById('aqImagePreview').style.display = 'none';
    }

    function saveQuestionFromModal() {
      const points = parseInt(document.getElementById('aqPoints').value) || 100;
      const timeLimit = parseInt(document.getElementById('aqTimeLimit').value) || 20;
      const imageUrl = aqImageData || null;

      // Batch path: one or many questions detected from the paste box
      if (aqPendingQuestions.length > 0) {
        const unresolved = aqPendingQuestions.filter(q => q.answerResolved === false).length;
        aqPendingQuestions.forEach(q => {
          addQuestion();
          fillQuestionForm(questionCount, Object.assign({}, q, { points, timeLimit, imageUrl }));
        });
        let msg = `${aqPendingQuestions.length} question(s) added with their correct answers!`;
        if (unresolved > 0) msg = `${aqPendingQuestions.length} question(s) added, but ${unresolved} had no detectable answer - please set them before saving.`;
        Utils.showToast(msg, unresolved > 0 ? 'info' : 'success');
        closeQuestionModal();
        document.getElementById('questionsContainer').scrollIntoView({ behavior: 'smooth' });
        return;
      }

      // Manual path: compiled from the form fields
      const text = document.getElementById('aqQuestionText').value.trim();
      if (!text) return Utils.showToast('Paste or type the question first', 'error');

      let correctAnswer = 0, options = [];
      if (aqSelectedType === 'mcq') {
        const opts = ['A', 'B', 'C', 'D'].map(L => document.getElementById('aqOpt' + L).value.trim());
        if (!opts[0] || !opts[1]) return Utils.showToast('Fill at least options A & B', 'error');
        const checked = document.querySelector('input[name="aqMcqCorrect"]:checked');
        const ci = parseInt(checked ? checked.value : 0);
        if (!opts[ci] || !opts[ci].trim()) return Utils.showToast('The option marked as correct is empty - fill it or choose another option', 'error');
        options = opts.filter(o => o);
        correctAnswer = opts.slice(0, ci).filter(o => o).length;
      } else if (aqSelectedType === 'truefalse') {
        options = ['True', 'False'];
        const checked = document.querySelector('input[name="aqTfCorrect"]:checked');
        correctAnswer = parseInt(checked ? checked.value : 0);
      } else {
        const ans = document.getElementById('aqIdAnswer').value.trim();
        if (!ans) return Utils.showToast('Enter the correct answer', 'error');
        correctAnswer = ans;
      }

      const question = { type: aqSelectedType, text, options, correctAnswer, points, timeLimit, imageUrl, answerResolved: true };
      addQuestion();
      fillQuestionForm(questionCount, question);

      Utils.showToast('Question added!', 'success');
      closeQuestionModal();
      document.getElementById('questionsContainer').scrollIntoView({ behavior: 'smooth' });
    }
  
