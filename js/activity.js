// ============================================================
// activity.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    // ============================================================
    // PROGRAMMING ACTIVITY | split-screen IDE
    // Supports BOTH:
    //   activity.html?id=ACTIVITY_ID        (standalone activity)
    //   activity.html?live=PIN              (live hosted contest)
    // ============================================================
    // ---------- STATE ----------
    let ACTIVITY_ID = null, ACTIVITY = null, PROBLEMS = [], CURRENT = 0, TEACHER = false;
    let LANG_CONFIG = null, RUN_LANG = '', currentCodeByProblem = {}, lastBest = {};
    let sampleInputs = {}, VISITED = {}, saveTimer = null, lastSavedAt = 0;
    let timerHandle = null, liveTick = null, timeUp = false, finalized = false, checkingAll = false;

    // Live contest + anti-cheat
    let LIVE = false, LIVE_GAME = null, LIVE_CHANNEL = null, contestActive = false;
    let VIOLATIONS = 0, LAST_VIOL = 0, LOCKED_OUT = false, LOCKOUT_DONE = false;

    // ---------- HELPERS ----------
    const $ = (id) => {
      const el = document.getElementById(id);
      if (el) return el;
      return { textContent:'', innerHTML:'', className:'',
        style:{display:'',setProperty(){},getPropertyValue(){return''}},
        classList:{add(){},remove(){},toggle(){},contains(){return false}},
        focus(){},click(){},scrollHeight:0,scrollTop:0,value:'',
        setAttribute(){},getAttribute(){return''},querySelector(){return null},querySelectorAll(){return[]},
        insertAdjacentHTML(){},appendChild(){},removeChild(){},replaceChildren(){}
      };
    };
    const getEditorValue = () => { const e = $('editor'); return e && e.value ? e.value : ''; };
    const penaltyPerViolation = () => (LIVE_GAME && LIVE_GAME.penalty_points) || 5;
    const maxViolations = () => (LIVE_GAME && LIVE_GAME.max_violations) || 3;

    function resolveLanguage(label) {
      const found = (Programming.LANGUAGES || []).find(l => String(l.label || '').toLowerCase() === String(label || '').toLowerCase());
      return found || Programming.langById('cpp');
    }
    function codeFor(p) { return Object.prototype.hasOwnProperty.call(currentCodeByProblem, p.id) ? currentCodeByProblem[p.id] : (p.starter_code || LANG_CONFIG.starter); }
    function rememberBest(p, report) {
      if (!lastBest[p.id] || (report.score || 0) > (lastBest[p.id].score || 0)) lastBest[p.id] = report;
    }
    function setBusy(b) {
      ['btnRun', 'btnSave', 'btnCheck', 'btnSubmit', 'btnSubmitBottom'].forEach(id => { const el = $(id); if (el) el.disabled = b; });
    }
    function setProgress(text) { $('consoleOut').innerHTML = '<div class="pa-con muted">' + Utils.sanitize(text) + '</div>'; }
    function appendConsole(text, cls) {
      const el = $('consoleOut');
      el.innerHTML += '<div class="pa-con ' + (cls || '') + '">' + Utils.sanitize(text) + '</div>';
      el.scrollTop = el.scrollHeight;
    }
    function resetConsole() { $('consoleOut').innerHTML = ''; }
    function showFatal(msg) {
      document.documentElement.classList.remove('auth-gate');
      $('app').innerHTML = '<div class="pa-fatal"><div class="pa-fatal-card"><h2>' + Utils.sanitize(msg) + '</h2><button class="btn btn-primary" onclick="window.location.href=\'../dashboard.html\'">Back to Dashboard</button></div></div>';
    }

    // ---------- ANTI-CHEAT ----------
    function isFs() { return !!(document.fullscreenElement); }
    async function requestFs() {
      try { if (!isFs() && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) {}
    }
    async function exitFs() {
      try { if (isFs() && document.exitFullscreen) await document.exitFullscreen(); } catch (e) {}
    }
    function relockFullscreen() {
      requestFs();
      setTimeout(() => { if (isFs()) $('lockOverlay').classList.remove('active'); }, 350);
    }
    function showViolBanner(reason) {
      $('violMsg').textContent = reason;
      $('violExtra').textContent = ' — ' + VIOLATIONS + ' / ' + maxViolations() + ' violations (' + (VIOLATIONS * penaltyPerViolation()) + ' pts penalty)';
      $('violBanner').style.display = 'flex';
      clearTimeout(window.__vbt);
      window.__vbt = setTimeout(() => { if (!LOCKED_OUT) $('violBanner').style.display = 'none'; }, 6000);
    }
    function updateViolUI() {
      $('violCount').innerHTML = VIOLATIONS + '<span style="font-size:0.8rem;opacity:0.7;"> / <span>' + maxViolations() + '</span></span>';
      $('violMax').textContent = maxViolations();
      $('penaltyNote').textContent = penaltyPerViolation() + ' pts';
      $('maxViolNote').textContent = maxViolations() + ' violations';
      const vcLive = $('violCountLive');
      if (vcLive && vcLive.textContent !== undefined) vcLive.textContent = VIOLATIONS + ' / ' + maxViolations();
      if (LIVE) {
        $('livePenalty').textContent = '-' + (VIOLATIONS * penaltyPerViolation());
        if ($('liveScore')) $('liveScore').textContent = currentGrossScore() - (VIOLATIONS * penaltyPerViolation());
      }
    }
    function currentGrossScore() {
      return PROBLEMS.reduce((s, p) => s + ((lastBest[p.id] && lastBest[p.id].score) || 0), 0);
    }
    function currentSolved() {
      return PROBLEMS.filter(p => lastBest[p.id] && lastBest[p.id].status === 'accepted').length;
    }
    async function recordViolation(reason) {
      if (!contestActive || TEACHER || LOCKED_OUT || finalized || timeUp) return;
      const now = Date.now();
      if (now - LAST_VIOL < 3000) return;
      LAST_VIOL = now;
      VIOLATIONS++;
      updateViolUI();
      showViolBanner(reason);
      if (LIVE && LIVE_GAME) {
        try { VIOLATIONS = await ProgLive.addViolation(LIVE_GAME.id, reason); } catch (e) {}
        updateViolUI();
        pushLiveScore();
      }
      if (VIOLATIONS >= maxViolations()) lockOut('Maximum rule violations reached');
    }
    function setupAntiCheat() {
      document.addEventListener('fullscreenchange', () => {
        if (LOCKED_OUT || finalized) return;
        if (!contestActive) { $('lockOverlay').classList.remove('active'); return; }
        if (!isFs()) {
          recordViolation('Exited fullscreen');
          if (!LOCKED_OUT) $('lockOverlay').classList.add('active');
        } else {
          $('lockOverlay').classList.remove('active');
        }
      });
      window.addEventListener('blur', () => {
        if (document.visibilityState === 'visible' && contestActive && !LOCKED_OUT) recordViolation('Left the page window');
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && contestActive) recordViolation('Switched tabs / minimized the page');
      });
      document.addEventListener('contextmenu', (e) => {
        if (contestActive && !TEACHER) e.preventDefault();
      });
      document.addEventListener('pointerdown', () => {
        if (contestActive && !TEACHER && !isFs() && !LOCKED_OUT && !finalized) requestFs();
      });
    }

    // ---------- RENDER: HEADER / PROBLEM LIST ----------
    function renderHeader() {
      document.title = 'Programming · ' + ACTIVITY.title;
      $('activityTitle').textContent = ACTIVITY.title || 'Programming Activity';
      $('langChip').textContent = LANG_CONFIG.label;
      $('editorLangChip').textContent = LANG_CONFIG.label.toUpperCase();
      if (LIVE) {
        $('liveChip').style.display = 'inline-flex';
        $('topTag').textContent = 'Programming Live Contest';
        $('liveChipText').textContent = 'LIVE · ' + (LIVE_GAME.pin || '');
      }
    }
    function renderProblemList() {
      $('problemList').innerHTML = PROBLEMS.map((p, i) => {
        const done = lastBest[p.id] && lastBest[p.id].status === 'accepted';
        return '<button class="pa-problem' + (i === CURRENT ? ' active' : '') + '" onclick="selectProblem(' + i + ')">' +
          '<span class="pa-pnum">' + (i + 1) + '</span>' +
          '<span class="pa-ptxt">' + Utils.sanitize(p.title || ('Problem ' + (i + 1))) + '</span>' +
          '<span class="pa-ppts' + (done ? ' done' : '') + '">' + (p.points || 0) + '</span>' +
        '</button>';
      }).join('');
    }
    function renderStatement(p) {
      const inl = p.input_format ? '<div class="pa-sec"><h4>Input Format</h4><pre class="pa-pre">' + Utils.sanitize(p.input_format) + '</pre></div>' : '';
      const outl = p.output_format ? '<div class="pa-sec"><h4>Output Format</h4><pre class="pa-pre">' + Utils.sanitize(p.output_format) + '</pre></div>' : '';
      $('problemStatement').innerHTML =
        '<div class="pa-problem-title"><span class="pa-plabel">' + (p.question_number || (CURRENT + 1)) + '</span>' +
        '<h2>' + Utils.sanitize(p.title || 'Problem') + '</h2>' +
        '<span class="pa-plabel pts">' + (p.points || 0) + ' pts</span></div>' +
        '<div class="pa-sec"><h4>Problem Statement</h4><p class="pa-desc">' + Utils.sanitize(p.description || '') + '</p></div>' +
        inl + outl +
        '<div class="pa-sec"><h4>Sample Cases</h4><div id="sampleList"><p class="pa-empty">Loading samples…</p></div></div>';
    }

    // ---------- SAMPLES ----------
    async function loadSamples(p) {
      const list = $('sampleList');
      if (!list) return;
      try {
        const vis = await Programming.getVisibleTestCases(p.id);
        sampleInputs[p.id] = (vis.sample && vis.sample.length) ? (vis.sample[0].input || '') : '';
        if (!vis.sample || !vis.sample.length) { list.innerHTML = '<p class="pa-empty">No sample cases provided for this problem.</p>'; return; }
        list.innerHTML = vis.sample.map((t, i) =>
          '<div class="pa-sample"><div class="pa-sample-h">Sample ' + (i + 1) + '</div><div class="pa-sample-b">' +
            '<div><span class="pa-sample-lbl">Input</span><pre>' + Utils.sanitize(t.input || '') + '</pre></div>' +
            '<div><span class="pa-sample-lbl">Output</span><pre>' + Utils.sanitize(t.expected_output || '') + '</pre></div>' +
          '</div></div>'
        ).join('');
      } catch (e) { console.error(e); list.innerHTML = '<p class="pa-empty">Could not load sample cases.</p>'; }
    }

    // ---------- EDITOR ----------
    function syncGutter() {
      const ta = $('editor'), g = $('gutterLines');
      const lines = ta.value.split('\n').length;
      let out = '';
      for (let i = 1; i <= lines; i++) out += i + '\n';
      g.textContent = out;
      $('gutterWrap').scrollTop = ta.scrollTop;
    }
    function updateCursor() {
      const ta = $('editor');
      const upTo = ta.value.slice(0, ta.selectionStart).split('\n');
      $('cursorPos').textContent = 'Ln ' + upTo.length + ', Col ' + ((upTo[upTo.length - 1] || '').length + 1);
    }

    // ---------- SYNTAX HIGHLIGHTING (overlay) ----------
    const HL_LANGS = {
      'c': {
        line: '//', pre: true,
        kw: ['auto','break','case','const','continue','default','do','else','enum','extern','for','goto','if','inline','register','return','restrict','sizeof','static','struct','switch','typedef','union','volatile','while','_Bool','_Complex','_Generic','signed','unsigned','void'],
        types: ['int','char','float','double','long','short','size_t','ssize_t','int8_t','int16_t','int32_t','int64_t','uint8_t','uint16_t','uint32_t','uint64_t','FILE','bool']
      },
      'c++': {
        line: '//', pre: true,
        kw: ['alignas','alignof','and','asm','auto','bitand','bitor','break','case','catch','class','const','consteval','constexpr','constinit','continue','co_await','co_return','co_yield','delete','do','dynamic_cast','else','enum','explicit','export','extern','for','friend','goto','if','inline','mutable','namespace','new','noexcept','not','operator','or','private','protected','public','register','reinterpret_cast','requires','return','sizeof','static','static_cast','switch','template','this','thread_local','throw','try','typedef','typename','union','using','virtual','volatile','while','xor','final','override','struct','class'],
        types: ['int','char','float','double','long','short','bool','void','signed','unsigned','string','wchar_t','auto','size_t','vector','map','set','pair','unordered_map','unordered_set','deque','list','stack','queue','priority_queue','string_view','optional','unique_ptr','shared_ptr','true','false','nullptr','max','min']
      },
      'csharp': {
        line: '//', pre: false,
        kw: ['abstract','as','base','break','case','catch','checked','class','const','continue','delegate','do','else','enum','event','explicit','extern','finally','fixed','for','foreach','goto','if','implicit','in','interface','internal','is','lock','namespace','new','operator','out','override','params','private','protected','public','readonly','ref','return','sealed','sizeof','stackalloc','static','struct','switch','this','throw','try','typeof','unchecked','unsafe','using','virtual','volatile','while','async','await','get','set','value','var','yield','partial','record','init','when','where'],
        types: ['int','uint','long','ulong','short','ushort','byte','sbyte','float','double','decimal','bool','char','string','object','void','List','Dictionary','HashSet','Queue','Stack','Tuple','stringbuilder','StringBuilder','Console','Math','Task','null','true','false','dynamic']
      },
      'java': {
        line: '//', pre: false,
        kw: ['abstract','assert','break','case','catch','class','const','continue','default','do','else','enum','extends','final','finally','for','goto','if','implements','import','instanceof','interface','native','new','package','private','protected','public','return','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while','record','sealed','yield','var','permitted','_'],
        types: ['int','long','float','double','boolean','char','byte','short','String','Integer','Long','Float','Double','Boolean','Character','Byte','Short','Math','Object','List','ArrayList','HashMap','HashSet','Arrays','Collections','System','true','false','null','Scanner','void']
      },
      'python': {
        line: '#', pre: false,
        kw: ['and','as','assert','async','await','break','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield','match','case','None','True','False'],
        types: ['int','float','str','bool','list','dict','tuple','set','bytes','complex','range','object','self','__init__','print']
      }
    };
    function hlEscape(s) { return s.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function highlightToHtml(src) {
      const cfg = HL_LANGS[RUN_LANG] || HL_LANGS['c++'];
      const re = new RegExp([
        /\/\*[\s\S]*?\*\//.source,
        /"""[\s\S]*?"""|'''[\s\S]*?'''/.source,
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/.source,
        /\b(?:0[xX][0-9a-fA-F]+(?:\.[0-9a-fA-F]+)?|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)\b/.source,
        cfg.pre ? /(?:^\s*|\n\s*)#[^\n]*/.source : '',
        cfg.line === '#' ? /#[^\n]*/.source : /\/\/[^\n]*/.source,
        /[A-Za-z_]\w*/.source
      ].filter(Boolean).join('|'), 'gm');
      let out = '', last = 0, m;
      while ((m = re.exec(src))) {
        out += hlEscape(src.slice(last, m.index));
        const t = m[0];
        let cls;
        if (/^\/\*|^\/\/|^#/.test(t)) cls = cfg.pre && /^#/.test(t) ? 'tok-pre' : 'tok-cmt';
        else if (/^["']/.test(t)) cls = 'tok-str';
        else if (/^\d|\b0[xX]/.test(t)) cls = 'tok-num';
        else if (cfg.kw && cfg.kw.indexOf(t) !== -1) cls = 'tok-kw';
        else if (cfg.types && cfg.types.indexOf(t) !== -1) cls = 'tok-type';
        else if (/\s*\(/.test(src.slice(m.index + t.length, m.index + t.length + 32))) cls = 'tok-fn';
        else cls = 'tok-var';
        out += '<span class="' + cls + '">' + hlEscape(t) + '</span>';
        last = m.index + t.length;
      }
      out += hlEscape(src.slice(last));
      return out;
    }
    function syncHighlight() {
      const hl = $('highlightLayer');
      if (!hl) return;
      const ta = $('editor');
      hl.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
    }
    function renderHighlight() {
      const ta = $('editor'), hl = $('highlightLayer');
      if (!hl) return;
      const src = ta.value || '';
      const s = Math.min(ta.selectionStart, ta.selectionEnd);
      const e = Math.max(ta.selectionStart, ta.selectionEnd);
      let html = '';
      if (s > 0) html += highlightToHtml(src.slice(0, s));
      if (e > s) html += '<mark class="hl-sel">' + highlightToHtml(src.slice(s, e)) + '</mark>';
      if (e < src.length) html += highlightToHtml(src.slice(e));
      hl.innerHTML = html + '<br>';
      syncHighlight();
    }
    function updateSaveStatus(state) {
      const el = $('saveStatus');
      if (state === 'error') { el.textContent = 'Save failed'; el.className = 'pa-save pa-save-warn'; return; }
      if (state === 'saving') { el.textContent = 'Saving…'; el.className = 'pa-save pa-save-ok'; return; }
      if (lastSavedAt) { el.textContent = 'Saved ' + new Date(lastSavedAt).toLocaleTimeString(); el.className = 'pa-save pa-save-ok'; }
      else { el.textContent = 'Work in progress'; el.className = 'pa-save'; }
    }
    function scheduleSave() {
      updateSaveStatus('saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveCurrent(), 800);
    }
    async function saveCurrent() {
      const p = PROBLEMS[CURRENT];
      if (!p) return;
      const src = getEditorValue();
      currentCodeByProblem[p.id] = src;
      try { await Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, src); lastSavedAt = Date.now(); updateSaveStatus(); }
      catch (e) { updateSaveStatus('error'); }
    }
    async function manualSave() {
      const p = PROBLEMS[CURRENT];
      if (!p || checkingAll) return;
      const src = getEditorValue();
      currentCodeByProblem[p.id] = src;
      try { await Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, src); lastSavedAt = Date.now(); updateSaveStatus(); Utils.showToast('Code saved', 'success'); }
      catch (e) { updateSaveStatus('error'); Utils.showToast('Could not save right now', 'error'); }
    }
    function bindEditor() {
      const ta = $('editor'), gw = $('gutterWrap');
      ta.addEventListener('input', () => { syncGutter(); updateCursor(); renderHighlight(); scheduleSave(); });
      ta.addEventListener('keyup', () => { updateCursor(); renderHighlight(); });
      ta.addEventListener('click', () => { updateCursor(); renderHighlight(); });
      ta.addEventListener('mouseup', renderHighlight);
      ta.addEventListener('select', renderHighlight);
      ta.addEventListener('scroll', () => { gw.scrollTop = ta.scrollTop; syncHighlight(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !checkingAll) {
          e.preventDefault();
          const s = ta.selectionStart, en = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
          ta.selectionStart = ta.selectionEnd = s + 2;
          syncGutter(); updateCursor(); renderHighlight(); scheduleSave();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); manualSave(); }
      });
    }
    async function loadRemote(p) {
      try {
        const saved = await Programming.loadSavedCode(ACTIVITY_ID, p.id);
        if (saved && saved.source) {
          currentCodeByProblem[p.id] = saved.source;
          if (PROBLEMS[CURRENT].id === p.id) { $('editor').value = saved.source; syncGutter(); updateCursor(); renderHighlight(); updateSaveStatus(); }
          VISITED[p.id] = true;
        }
      } catch (e) { console.error(e); }
    }
    async function selectProblem(i) {
      if (i === CURRENT || checkingAll || finalized || LOCKED_OUT) return;
      const prev = PROBLEMS[CURRENT], next = PROBLEMS[i];
      try { await Programming.saveCode(ACTIVITY_ID, prev.id, RUN_LANG, getEditorValue()); lastSavedAt = Date.now(); }
      catch (e) {}
      CURRENT = i;
      renderProblemList(); renderStatement(next);
      resetConsole();
      $('editor').value = codeFor(next); syncGutter(); updateCursor(); renderHighlight();
      loadSamples(next);
      if (!VISITED[next.id]) loadRemote(next);
    }

    // ---------- CONSOLE / RUN ----------
    function renderRunResult(res) {
      let failed = false;
      if (res.compile_error) {
        appendConsole('Compilation Error', 'err'); appendConsole(res.compile_error || '', 'err'); failed = true;
      } else if (res.compile_output) {
        appendConsole('Compilation output', 'warn'); appendConsole(res.compile_output || '', 'warn');
      }
      if (res.runtime_error) {
        appendConsole('Runtime Error — ' + (res.runtime_error || 'the program crashed'), 'err');
        if (res.stderr) appendConsole(res.stderr, 'err');
        failed = true;
      }
      if (res.time_limit_exceeded || res.status === 'tle') { appendConsole('Time Limit Exceeded (code ran too long)', 'err'); failed = true; }
      if (res.memory_limit_exceeded || res.status === 'mle') { appendConsole('Memory Limit Exceeded (used too much memory)', 'err'); failed = true; }
      if (!failed && res.stderr) appendConsole(res.stderr, 'warn');
      if (res.stdout) { appendConsole('-- program output --', 'muted'); appendConsole(res.stdout, 'ok'); }
      if (!failed && !res.stdout && !res.stderr && !res.compile_error) appendConsole('Run finished with no output.', 'muted');
      if (typeof res.time_ms === 'number') appendConsole('Execution time: ' + res.time_ms + ' ms', 'time pa-con-time');
      return failed;
    }
    function showRunError(prefix, e) {
      const meta = (e && e.meta) || {};
      appendConsole(prefix + (((e && e.message) || 'unknown error')), 'err');
      if (e && (e.kind === 'execution' || e.kind === 'configuration')) {
        appendConsole('— Code Runner Error —', 'muted');
        appendConsole('The execution service rejected the request:', 'muted');
        if (e.status) appendConsole('Status: ' + e.status, 'muted');
        if (meta.provider) appendConsole('Provider: ' + meta.provider, 'muted');
        if (meta.language) appendConsole('Language: ' + meta.language, 'muted');
        if (meta.version) appendConsole('Version: ' + meta.version, 'muted');
        appendConsole('Check the browser/Supabase console for the complete request and response.', 'muted');
        console.error('Code Runner Error:', { message: (e && e.message) || '', detail: (e && e.detail) || '', meta });
      }
    }
    const RUN_HTML = '<svg class="pa-run-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    let ioActive = false, ioPlan = null, ioStep = 0, ioUserInputs = [], ioLineEl = null, ioLineOpen = false, ioP = null, ioSrc = '';

    // Detect ordered cout/printf/Console.Write|ReadLine/System.out.print|Scanner.nextXxx/
    // Python print|input pairs so the console becomes a TRUE interactive terminal
    // (program prompt -> you type -> Enter -> next prompt), for C, C++, C#, Java AND Python.
    function literalText(s) {
      return String(s || '').slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }
    function ioOutStep(key, statement, literals) {
      const texts = literals.map(literalText);
      const text = texts.join('');
      const lastRaw = (literals[literals.length - 1] || '').slice(1, -1);
      let nl = !!texts.some(t => t.indexOf('\n') !== -1);
      if (key === 'csharp') nl = nl || /\bWriteLine\s*\(/.test(statement);
      else if (key === 'java') nl = nl || /println\s*\(/.test(statement) || (/\bprintf\s*\(/.test(statement) && /\\n/.test(statement));
      else if (key === 'c++') nl = nl || /\bendl\b/.test(statement);
      const dynamic = texts.some(t => /%[-+0 #\.\d]*[diufegscxXop]/.test(t)) || /\$\{/.test(statement) || /\{[^{}]*\}/.test(texts.join(' '));
      return dynamic ? { t: 'dyn' } : { t: 'out', text, nl };
    }
    function extractIOPlan(source, langKey) {
      const key = String(langKey || 'c++').toLowerCase();
      const isPy = key === 'python';
      // Generic stdin-read detection for the other languages (JS/TS/Go/Rust/
      // Ruby): we can't statically parse their prompts reliably, so we open
      // the terminal for a full line of input and let the probe + "Finish"
      // button handle continued / repeated reads.
      const genPattern = {
        javascript: /readline|readLine|process\.stdin|readFileSync\s*\(\s*0|readLineSync|prompt\s*\(/i,
        typescript: /readline|readLine|process\.stdin|readFileSync\s*\(\s*0|readLineSync|prompt\s*\(/i,
        go: /fmt\.Scan|Scanln|Scanner|os\.Stdin|bufio|NewReader\s*\(\s*os\.Stdin/i,
        rust: /std::io|io::stdin|read_line|read_line\(|BufReader/i,
        ruby: /\bgets\b|readline|ARGF|read_nonblock|STDIN\./i
      };
      if (genPattern[key]) {
        if (genPattern[key].test(String(source || ''))) {
          return { steps: [{ t: 'in' }], inputs: 1 };
        }
        return null;
      }
      if (!isPy && ['c', 'c++', 'csharp', 'java'].indexOf(key) === -1) return null;
      let code = String(source || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/^\s*#[^\n]*$/gm, '');
      const steps = [];
      if (isPy) {
        for (const raw of code.split('\n')) {
          const s = raw.trim();
          if (!s) continue;
          const im = s.match(/input\s*\(([^)]*)\)/);
          if (im) {
            const prm = (im[1] || '').trim().match(/^('(?:\\'|[^'\\])*'|"(?:\\"|[^"\\])*")/);
            if (prm) steps.push({ t: 'out', text: literalText(prm[1]), nl: false });
            steps.push({ t: 'in' });
            continue;
          }
          if (/print\s*\(/.test(s)) {
            const strs = s.match(/"(?:\\"|[^"\\])*"|'(?:\\'|[^'\\])*'/g) || [];
            steps.push(ioOutStep(key, s, strs));
          }
        }
      } else {
        const outPat = key === 'c' ? /printf\s*\(/ :
                       key === 'csharp' ? /Console\s*\.\s*(Write|WriteLine)\s*\(/ :
                       key === 'java' ? /System\s*\.\s*out\s*\.\s*(print|println|printf)\s*\(/ :
                       /cout\s*<</;
        const inPat = key === 'c' ? /scanf\s*\(|fgets\s*\(|getchar\s*\(|getc\s*\(|std::getline\s*\(\s*cin/i :
                      key === 'csharp' ? /ReadLine\s*\(/ :
                      key === 'java' ? /\.\s*next(Int|Long|Double|Float|Line|Short|Byte|Boolean|BigInteger|BigDecimal)?\s*\(/ :
                      /cin\s*>>|getline\s*\(\s*cin|std::getline\s*\(\s*cin/i;
        for (const raw of code.split(';')) {
          const s = raw.trim();
          if (!s) continue;
          if (outPat.test(s)) {
            const strs = s.match(/"(?:\\"|[^"\\])*"|'(?:\\'|[^'\\])*'/g) || [];
            steps.push(ioOutStep(key, s, strs));
          } else if (inPat.test(s)) {
            steps.push({ t: 'in' });
          }
        }
      }
      const inputs = steps.filter(x => x.t === 'in').length;
      if (inputs < 1 || inputs > 40) return null;
      return { steps, inputs };
    }
    function interactiveTail(realOut, steps) {
      let out = realOut, pos = 0;
      for (const s of steps) {
        if (s.t !== 'out' || !s.text) continue;
        const idx = out.indexOf(s.text, pos);
        if (idx === -1) return null;
        pos = idx + s.text.length;
      }
      return out.slice(pos);
    }
    function scrollConsole() { const el = $('consoleOut'); if (el && el.scrollHeight) el.scrollTop = el.scrollHeight; }
    function newLine() {
      const el = $('consoleOut'); const d = document.createElement('div');
      d.className = 'pa-con'; el.appendChild(d); scrollConsole(); return d;
    }
    function addTextToLine(el, text) { if (!el) return; el.innerHTML += Utils.sanitize(String(text == null ? '' : text)); scrollConsole(); }
    function showLiveInput(lineEl) {
      removeLiveInput();
      const inp = document.createElement('input');
      inp.className = 'pa-li'; inp.id = 'liveInput';
      inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocapitalize', 'off');
      inp.setAttribute('autocorrect', 'off'); inp.setAttribute('spellcheck', 'false');
      inp.placeholder = '';
      inp.style.width = '3ch';
      inp.addEventListener('input', () => { inp.style.width = Math.max(inp.value.length + 2, 3) + 'ch'; });
      const blk = document.createElement('i'); blk.className = 'pa-blk';
      lineEl.appendChild(inp); lineEl.appendChild(blk);
      scrollConsole();
      try { inp.focus(); } catch (e) {}
    }
    function removeLiveInput() {
      const inp = document.getElementById('liveInput');
      if (inp) inp.remove();
      document.querySelectorAll('#consoleOut .pa-blk').forEach(b => b.remove());
    }
    function ioNext() {
      while (ioStep < ioPlan.steps.length) {
        const s = ioPlan.steps[ioStep];
        if (s.t === 'out') {
          if (!ioLineOpen || !ioLineEl) { ioLineEl = newLine(); ioLineOpen = true; }
          addTextToLine(ioLineEl, s.text);
          if (s.nl) ioLineOpen = false;
          ioStep++;
        } else if (s.t === 'dyn') {
          if (!ioLineOpen || !ioLineEl) { ioLineEl = newLine(); }
          ioLineOpen = false;
          ioStep++;
        } else {
          if (!ioLineEl) ioLineEl = newLine();
          ioLineOpen = false;
          showLiveInput(ioLineEl);
          ioStep++;
          return;
        }
      }
      finishInteractive();
    }
    function startInteractive(p, src, plan) {
      ioActive = true; ioPlan = plan; ioStep = 0; ioUserInputs = [];
      ioLineEl = null; ioLineOpen = false; ioP = p; ioSrc = src;
      resetConsole();
      ioNext();
    }
    function cancelInteractive() {
      ioActive = false; ioPlan = null; ioStep = 0; ioUserInputs = []; ioP = null; ioSrc = '';
      removeLiveInput();
      appendConsole('— interaction cancelled —', 'muted');
    }
    function ioCommit(value) {
      const inp = document.getElementById('liveInput');
      if (!inp) return;
      const val = value;
      removeLiveInput();
      addTextToLine(ioLineEl, ' ' + val);
      ioUserInputs.push(val);
      ioLineOpen = false;
      ioNext();
    }
    // "Finish input" control: for programs that keep reading (loops until
    // EOF / input never ends), the student decides when they are done and
    // runs the program with everything they typed — no fake insert, no
    // auto-truncation.
    function addDoneButton() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pa-done-btn';
      btn.textContent = 'Finish input → run';
      btn.style.cssText = 'display:block;margin:8px 0 2px;font-size:0.74rem;font-weight:700;color:#6366F1;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.45);border-radius:999px;padding:5px 14px;cursor:pointer;line-height:1.2;';
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); doneWithInput(); });
      const ln = newLine();
      ln.className = 'pa-con pa-con-done';
      ln.appendChild(btn);
      scrollConsole();
    }
    function doneWithInput() {
      const inp = document.getElementById('liveInput');
      if (inp) {
        if (inp.value.length) { addTextToLine(ioLineEl, ' ' + inp.value); ioUserInputs.push(inp.value); }
        removeLiveInput();
      }
      finishInteractive(true);
    }
    function ioHandleKey(e) {
      if (!ioActive) return;
      const inp = document.getElementById('liveInput');
      if (!inp) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ioCommit(inp.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelInteractive(); }
    }
    document.addEventListener('keydown', ioHandleKey, true);

    function trimOut(s) {
      return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
    }
    function normOut(s) {
      return String(s == null ? '' : s).replace(/\s+$/g, '');
    }
    function finishConsole(state) {
      setBusy(false);
      $('btnRun').innerHTML = RUN_HTML + ' Run Code';
      $('consoleHint').textContent = state || 'Program finished — press Run Code again or use Check Code to grade';
    }

    // Called whenever the plan's collected inputs end. Re-runs the program
    // with those inputs, then probes with ONE extra line ("9") to learn
    // whether the program is still blocked on input (loops never auto-fill
    // or truncate): if the probe changes stdout, the student must type the
    // next value instead of us pretending the run finished.
    async function finishInteractive(forceDone) {
      const p = ioP, src = ioSrc;
      if (!p) { await deactivateInteractive(); return; }
      setBusy(true);
      $('btnRun').innerHTML = RUN_HTML + ' Running…';
      removeLiveInput();
      try {
        await Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, src);
        lastSavedAt = Date.now(); updateSaveStatus();
      } catch (e) { try { scheduleSave(); } catch (e2) { updateSaveStatus('error'); } }
      const stdin = ioUserInputs.join('\n') + '\n';
      // EOF sentinel for the probe: a NON-NUMERIC token. When the program is
      // a "read numbers until end of file" loop (while (cin >> n) ... total),
      // parsing the sentinel FAILS, which behaves exactly like EOF — so the
      // loop finishes the same way it would on a real terminal (Ctrl+Z/D) and
      // the correct sum is shown. The old numeric probe ("9") was consumable,
      // so it changed the output and every EOF-loop kept "still reading".
      const EOF_PROBE = '__wq_eof__';
      const stillNeedMore = !forceDone && ioPlan && ioPlan.inputs > ioUserInputs.length;
      let res = null;
      if (!stillNeedMore) {
        try {
          res = await Programming.runInSandbox({ language: RUN_LANG, source: src, stdin, timeoutMs: 4000 });
        } catch (e) {
          showRunError('Could not run: ', e);
          finishConsole();
          await deactivateInteractive();
          return;
        }
      }
      // Probe only when the student has NOT pressed "Finish input" and has
      // already supplied every statically-detected input. The probe appends
      // one extra (never 0, never numeric) EOF-sentinel line to learn whether
      // the program is still blocked reading from the terminal.
      const probe = (!forceDone && !stillNeedMore)
        ? await Programming.runInSandbox({ language: RUN_LANG, source: src, stdin: stdin + EOF_PROBE + '\n', timeoutMs: 4000 })
            .catch((e) => { console.error(e); return null; })
        : null;
      const probeErr = probe && (probe.compile_error || probe.runtime_error || probe.status === 'tle');
      const needsMore = stillNeedMore
        || (!forceDone && probe && !probeErr && normOut(probe.stdout) !== normOut(res.stdout) && !res.compile_error);
      if (needsMore) {
        const tail = res ? interactiveTail(res.stdout || '', ioPlan ? ioPlan.steps : []) : null;
        const shown = res ? trimOut(tail == null ? (res.stdout || '') : tail) : '';
        if (shown) appendConsole(shown, 'ok');
        ioLineEl = newLine(); ioLineOpen = false;
        showLiveInput(ioLineEl);
        addDoneButton();
        finishConsole(stillNeedMore
          ? ('This program reads ' + ioPlan.inputs + ' value(s) — you entered ' + ioUserInputs.length + '. Type the next value and press Enter, or use "Finish input" below')
          : 'The program may still be reading input — type the next value and press Enter, or use "Finish input" below');
        return;
      }
      if (res.compile_error) { appendConsole('Compilation Error', 'err'); appendConsole(res.compile_error || '', 'err'); finishConsole(); await deactivateInteractive(); return; }
      if (res.runtime_error) { appendConsole('Runtime Error — ' + (res.runtime_error || 'the program crashed'), 'err'); if (res.stderr) appendConsole(res.stderr, 'err'); finishConsole(); await deactivateInteractive(); return; }
      if (probe && (probe.runtime_error || probe.compile_error) && !res.runtime_error && !res.compile_error && !res.stderr && (!res.stdout || !res.stdout.trim())) {
        appendConsole('Runtime Error — ' + (probe.runtime_error || 'the program crashed'), 'err');
        if (probe.stderr) appendConsole(probe.stderr, 'err');
        finishConsole(); await deactivateInteractive(); return;
      }
      if (res.status === 'tle' || (probe && probe.status === 'tle')) { appendConsole('Time Limit Exceeded (code ran too long)', 'err'); finishConsole(); await deactivateInteractive(); return; }
      if (res.status === 'mle' || (probe && probe.status === 'mle')) { appendConsole('Memory Limit Exceeded (used too much memory)', 'err'); finishConsole(); await deactivateInteractive(); return; }
      const srcOut = String((probe || res).stdout || '');
      const tail = interactiveTail(srcOut, ioPlan ? ioPlan.steps : []);
      const trimmed = trimOut(tail == null ? (res.stdout || '') : tail);
      if (trimmed) appendConsole(trimmed, 'ok');
      appendConsole('Program finished successfully.', 'ok');
      finishConsole();
      await deactivateInteractive();
    }
    async function deactivateInteractive() {
      ioActive = false; ioPlan = null; ioStep = 0; ioUserInputs = []; ioP = null; ioSrc = '';
    }

    async function runDirect(p, src) {
      setBusy(true);
      $('btnRun').innerHTML = RUN_HTML + ' Running…';
      resetConsole();
      try {
        await Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, src);
        lastSavedAt = Date.now(); updateSaveStatus();
      } catch (e) {
        try { scheduleSave(); } catch (e2) { updateSaveStatus('error'); }
      }
      try {
        const res = await Programming.runInSandbox({ language: RUN_LANG, source: src, stdin: '', timeoutMs: 4000 });
        const failed = renderRunResult(res);
        if (!failed) appendConsole('Program finished successfully.', 'ok');
      } catch (e) {
        showRunError('Could not run: ', e);
      }
      $('consoleHint').textContent = 'Program finished — press Run Code again or use Check Code to grade';
      $('btnRun').innerHTML = RUN_HTML + ' Run Code';
      setBusy(false);
    }

    async function runCode() {
      const p = PROBLEMS[CURRENT];
      if (!p || checkingAll || LOCKED_OUT || finalized || $('btnRun').disabled || ioActive) return;
      const src = getEditorValue();
      if (!src || !src.trim()) { Utils.showToast('Write some code first', 'error'); return; }
      currentCodeByProblem[p.id] = src;
      const plan = extractIOPlan(src, RUN_LANG);
      if (plan) { startInteractive(p, src, plan); return; }
      await runDirect(p, src);
    }

    async function checkCode() {
      const p = PROBLEMS[CURRENT];
      if (!p || checkingAll || LOCKED_OUT || finalized || $('btnCheck').disabled || ioActive) return;
      const src = getEditorValue();
      if (!src || !src.trim()) { Utils.showToast('Write some code first', 'error'); return; }
      currentCodeByProblem[p.id] = src;
      setBusy(true);
      resetConsole();
      appendConsole('Checking against the activity test cases…', 'muted');
      try {
        await Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, src);
        lastSavedAt = Date.now(); updateSaveStatus();
      } catch (e) { try { scheduleSave(); } catch (e2) { updateSaveStatus('error'); } }
      try {
        const report = await Programming.checkCode({ activityId: ACTIVITY_ID, problem: p, source: src, language: RUN_LANG });
        rememberBest(p, report);
        refreshProgressCard();
        if (LIVE) await pushLiveScore();
        openGradeOverlay(p, report);
      } catch (e) {
        showRunError('Could not check: ', e);
      }
      setBusy(false);
    }

    // ---------- CHECK / GRADE ----------
    const STATUS_MAP = {
      accepted: { t: 'Accepted', c: 'success' },
      wrong_answer: { t: 'Wrong Answer', c: 'warn' },
      compilation_error: { t: 'Compilation Error', c: 'err' },
      runtime_error: { t: 'Runtime Error', c: 'err' },
      time_limit_exceeded: { t: 'Time Limit Exceeded', c: 'warn' },
      memory_limit_exceeded: { t: 'Memory Limit Exceeded', c: 'warn' },
      execution_service_error: { t: 'Execution Service Error', c: 'err' },
      pending: { t: 'Pending', c: 'warn' }
    };
    function msgClass(m) {
      if (m === 'Passed') return 'pass';
      if (m === 'Failed') return 'fail';
      if (m === 'Compilation Error' || m === 'Runtime Error' || m === 'Execution Service Error') return 'err';
      return 'warn';
    }
    function openGradeOverlay(p, report) {
      const st = STATUS_MAP[report.status] || STATUS_MAP.pending;
      $('gradeStatusPill').textContent = st.t;
      $('gradeStatusPill').className = 'pa-status-pill st-' + st.c;
      const results = report.test_results || [];
      const graded = results.filter(r => r.included_in_grading !== false);
      const passed = graded.filter(r => r.passed).length;
      const gradeTotal = (report.grading_count != null) ? report.grading_count : graded.length;
      let rows = '', hiddenIndex = 0;
      if (report.status === 'execution_service_error') {
        rows = '<div class="pa-row pa-svc-err">' +
          '<div class="pa-row-main"><div class="pa-row-title">Grading service temporarily unreachable</div>' +
          '<div class="pa-row-sub">The code-runner service could not be reached, so this attempt was <b>not</b> judged — your code wasn\u2019t marked wrong. Check again in a moment.</div></div></div>';
      }
      results.forEach((r) => {
        const isSample = r.expected !== 'Hidden';
        if (!isSample) hiddenIndex++;
        const name = r.label ? r.label : (isSample ? 'Sample case' : 'Hidden case ' + hiddenIndex);
        const msgPill = '<span class="pa-row-msg m-' + msgClass(r.message) + '">' + Utils.sanitize(r.message || '') + '</span>';
        let sub = '';
        if (isSample) {
          sub = '<div class="pa-row-sub"><span class="pa-cmp">Input:</span><span class="pa-cmp-pre">' + Utils.sanitize(r.input || '(none)') + '</span>' +
                '<span class="pa-cmp">Expected Output:</span><span class="pa-cmp-pre">' + Utils.sanitize(r.expected || '') + '</span>' +
                '<span class="pa-cmp">Your Output:</span><span class="pa-cmp-pre">' + Utils.sanitize(r.output || '(no output)') + '</span></div>';
        } else if (r.passed) {
          sub = '<div class="pa-row-sub">Hidden test case passed.</div>';
        } else {
          sub = '<div class="pa-row-sub">This hidden test case failed. Review your logic and edge cases, then check again.</div>';
        }
        rows += '<div class="pa-row ' + (r.passed ? 'passed' : 'failed') + '">' +
          '<span class="pa-ico ' + (r.passed ? 'pass' : 'fail') + '">' + (r.passed ? '✓' : '✗') + '</span>' +
          '<div class="pa-row-main"><div class="pa-row-title">' + Utils.sanitize(name) + ' ' + msgPill + '</div>' + sub + '</div>' +
          '<span class="pa-row-pts">' + (r.included_in_grading === false ? 'Not graded' : ('+' + (r.points || 0) + ' pts')) + '</span>' +
        '</div>';
      });
      $('gradeBody').innerHTML = rows || '<p class="pa-empty">No test cases in this problem.</p>';
      $('gradePassed').innerHTML = passed + ' / ' + gradeTotal + ' <small>Test cases passed</small>';
      $('gradeScore').innerHTML = 'Score: ' + (report.score || 0) + ' / ' + (report.max_score || 0) + ' <small>points</small>';
      $('gradeOverlay').classList.add('active');
    }
    function closeGradeOverlay() { $('gradeOverlay').classList.remove('active'); }

    async function pushLiveScore() {
      if (!LIVE || !LIVE_GAME) return;
      const totalPoints = PROBLEMS.reduce((s, p) => s + (p.points || 0), 0);
      const scored = Math.max(0, currentGrossScore() - (VIOLATIONS * penaltyPerViolation()));
      await ProgLive.pushScore(LIVE_GAME.id, {
        total_score: scored, total_points: totalPoints,
        problems_solved: currentSolved(), violations: VIOLATIONS,
        penalty_points: VIOLATIONS * penaltyPerViolation()
      });
      $('liveScore').textContent = scored;
      $('liveSolved').textContent = currentSolved();
    }
    function refreshProgressCard() {
      $('progSolved').textContent = currentSolved() + ' / ' + PROBLEMS.length;
      $('progScore').textContent = currentGrossScore() - (VIOLATIONS * penaltyPerViolation()) + ' pts';
      renderProblemList();
    }

    // ---------- SUBMIT / FINALIZE ----------
    async function goToResults() {
      if (LOCKOUT_DONE) return;
      LOCKOUT_DONE = true;
      for (const p of PROBLEMS) { try { await Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, codeFor(p)); } catch (e) {} }
      const res = await Programming.finalizeActivity(ACTIVITY_ID, PROBLEMS, lastBest,
        { violations: VIOLATIONS, penaltyPoints: penaltyPerViolation() });
      if (LIVE && LIVE_GAME) {
        const totalPoints = PROBLEMS.reduce((s, p) => s + (p.points || 0), 0);
        await ProgLive.setFinal(LIVE_GAME.id, {
          total_score: (res && res.ok) ? res.totalScore : Math.max(0, currentGrossScore() - (VIOLATIONS * penaltyPerViolation())),
          total_points: totalPoints, problems_solved: currentSolved(),
          violations: VIOLATIONS,
          penalty_points: VIOLATIONS * penaltyPerViolation(),
          completed: !!(res && res.completed)
        });
      }
      Utils.showToast('Submitted! Score: ' + (res && res.ok ? res.totalScore : 0), 'success');
      window.location.href = 'results.html?activity=' + ACTIVITY_ID;
    }
    function goToResultsNow() { goToResults(); }
    async function gradeEveryProblem(prelude) {
      for (let i = 0; i < PROBLEMS.length; i++) {
        const p = PROBLEMS[i];
        setProgress(prelude + ' — Problem ' + (i + 1) + ' of ' + PROBLEMS.length + '…');
        const src = codeFor(p);
        try {
          await Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, src);
          lastSavedAt = Date.now();
          const report = await Programming.checkCode({ activityId: ACTIVITY_ID, problem: p, source: src, language: RUN_LANG });
          rememberBest(p, report);
        } catch (e) { console.error(e); }
      }
      refreshProgressCard();
    }
    async function prepareFinalize() {
      if (finalized) return;
      finalized = true;
      checkingAll = true;
      setBusy(true);
      if (timerHandle) { try { timerHandle.stop(); } catch (e) {} }
      if (liveTick) clearInterval(liveTick);
      resetConsole();
      await gradeEveryProblem('Submitting');
      setProgress('Finalizing results…');
      await goToResults();
      try { setBusy(false); } catch (e) {}
    }
    async function submitAll() {
      if (checkingAll || finalized || LOCKED_OUT) return;
      if (!confirm('Check & Submit all problems? Your latest code for every problem will be graded and locked — you can no longer edit after submitting.')) return;
      await prepareFinalize();
    }
    async function lockOut(reason) {
      if (LOCKED_OUT || finalized || timeUp) return;
      LOCKED_OUT = true;
      timeUp = true;
      contestActive = false;
      updateViolUI();
      $('lockedText').textContent = reason + '. Your work is being submitted automatically.';
      $('lockedOverlay').classList.add('active');
      $('violBanner').style.display = 'flex';
      $('violMsg').textContent = reason;
      $('lockOverlay').classList.remove('active');
      setBusy(true);
      await gradeEveryProblem('Locked out — submitting');
      setProgress('Finalizing results…');
      await goToResults();
      setBusy(false);
    }

    // ---------- TIMER ----------
    function showTimer(secsLeft, idle) {
      if (idle) { $('timerText').textContent = '—:—'; $('timerBox').classList.add('idle'); $('timerBox').classList.remove('danger'); return; }
      const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
      const ss = String(secsLeft % 60).padStart(2, '0');
      $('timerText').textContent = mm + ':' + ss;
      $('timerBox').classList.remove('idle');
      $('timerBox').classList.toggle('danger', secsLeft <= 60);
    }
    function startStandaloneTimer() {
      if (TEACHER) { showTimer(0, true); return; }
      const minutes = Math.max(1, parseInt(ACTIVITY.time_limit_minutes, 10) || 30);
      timerHandle = Programming.startTimer({
        totalMinutes: minutes,
        onTick: ({ mm, ss, done }) => {
          if (done) { showTimer(0); onTimeUp(); return; }
          showTimer((parseInt(mm, 10) * 60) + parseInt(ss, 10));
        },
        onEnd: () => {}
      });
    }
    function startLiveTicking() {
      if (liveTick) clearInterval(liveTick);
      if (TEACHER) { showTimer(0, true); return; }
      const tick = () => {
        if (!LIVE_GAME) return;
        if (LIVE_GAME.status === 'ended') { if (liveTick) clearInterval(liveTick); onTimeUp(); return; }
        if (LIVE_GAME.status === 'running') {
          const ms = ProgLive.remainingMs(LIVE_GAME);
          if (ms == null) { showTimer(Math.max(1, LIVE_GAME.duration_minutes * 60)); return; }
          const secs = Math.ceil(ms / 1000);
          if (secs <= 0) { if (liveTick) clearInterval(liveTick); onTimeUp(); return; }
          showTimer(secs);
        } else {
          showTimer(0, true);
        }
      };
      liveTick = setInterval(tick, 1000);
      tick();
    }
    async function onTimeUp() {
      if (timeUp || finalized || checkingAll || LOCKED_OUT) return;
      timeUp = true;
      contestActive = false;
      Utils.showToast("Time's Up! Your work is being submitted automatically.", 'info');
      await prepareFinalize();
    }

    // ---------- LIVE MODE ----------
    function onLiveGameUpdate(g) {
      const prev = LIVE_GAME;
      LIVE_GAME = g;
      if (g.status === 'running' && (!prev || prev.status !== 'running')) {
        startContestSession();
      } else if (g.status === 'ended') {
        if (contestActive) {
          contestActive = false;
          onTimeUp();
        } else {
          window.location.replace('results.html?activity=' + encodeURIComponent(ACTIVITY_ID || ''));
        }
      } else if (g.status === 'running' && prev && prev.status === 'running') {
        showTimer(Math.max(0, Math.ceil((ProgLive.remainingMs(g) || 0) / 1000)));
      }
    }
    function startContestSession() {
      if (contestActive || TEACHER) return;
      contestActive = true;
      $('liveStatus').textContent = 'Running';
      $('liveStatus').className = 'pa-live-status running';
      $('waitingOverlay').classList.remove('active');
      hideWaiting();
      startLiveTicking();
      updateViolUI();
      requestFs();
      Utils.showToast('Contest started! Locked to fullscreen.', 'info');
    }
    function showWaiting() {
      $('waitingOverlay').style.display = 'flex';
      $('waitingOverlay').classList.add('active');
      $('liveStatus').textContent = 'Waiting for host';
      $('liveStatus').className = 'pa-live-status waiting';
    }
    function hideWaiting() {
      $('waitingOverlay').style.display = 'none';
      $('waitingOverlay').classList.remove('active');
    }
    function initLiveMode() {
      const params = new URLSearchParams(window.location.search);
      const pin = params.get('live');
      if (!pin) return Promise.resolve(false);
      return ProgLive.joinGame(pin).then((game) => {
        LIVE = true;
        LIVE_GAME = game;
        ACTIVITY_ID = game.activity_id;
        $('liveCard').style.display = 'block';
        $('waitingPin').textContent = game.pin;
        $('liveScore').textContent = '0';
        updateViolUI();
        if (game.status === 'ended') {
          window.location.replace('results.html?activity=' + encodeURIComponent(game.activity_id || ''));
          return true;
        }
        if (game.status === 'running') {
          startContestSession();
        } else {
          showWaiting();
          startLiveTicking();
        }
        return true;
      });
    }

    // ---------- BOOT ----------
    window.addEventListener('beforeunload', () => {
      const p = PROBLEMS[CURRENT];
      if (p && !finalized) { try { Programming.saveCode(ACTIVITY_ID, p.id, RUN_LANG, getEditorValue()); } catch (e) {} }
      if (LIVE && LIVE_GAME && !finalized) { try { pushLiveScore(); } catch (e) {} }
    });

    document.addEventListener('DOMContentLoaded', async () => {
      if (typeof Auth === 'undefined' || !Auth.init) { window.location.replace('../index.html'); return; }
      const user = await Auth.init();
      if (!user) { window.location.href = '../index.html'; return; }
      document.documentElement.classList.remove('auth-gate');
      Utils.showLoading();

      try { TEACHER = await Programming.isTeacher(); } catch (e) { TEACHER = false; }
      setupAntiCheat();

      // Non-blocking runner deployment check: if the /api/programming-run
      // Vercel function is not deployed, Run/Check will fail - warn early.
      Programming.checkRunnerHealth().then(health => {
        if (health && !health.ok) {
          Utils.showToast(health.message || 'Code runner API is not deployed.', 'error');
        }
      }).catch(() => {});

      const params = new URLSearchParams(window.location.search);
      const pin = params.get('live');
      if (pin) {
        try {
          const ok = await initLiveMode();
          if (!ok) { Utils.hideLoading(); showFatal('Could not join the live contest.'); return; }
        } catch (e) {
          Utils.hideLoading();
          showFatal(e && e.message ? e.message : 'Could not join the live contest. The PIN may be wrong or the contest ended.');
          return;
        }
      } else {
        ACTIVITY_ID = params.get('id');
        if (!ACTIVITY_ID) { Utils.hideLoading(); showFatal('No activity selected. Open this page from the Programming dashboard.'); return; }
      }

      try {
        const { activity, problems } = await Programming.loadActivity(ACTIVITY_ID);
        if (!activity) { Utils.hideLoading(); showFatal('Activity not found. It may have been removed.'); return; }
        ACTIVITY = activity; PROBLEMS = problems || [];
        LANG_CONFIG = resolveLanguage(activity.language);
        RUN_LANG = LANG_CONFIG.piston;
        renderHeader();
        if (TEACHER) $('teacherBanner').style.display = 'block';
        for (const p of PROBLEMS) currentCodeByProblem[p.id] = p.starter_code || LANG_CONFIG.starter;
        if (!PROBLEMS.length) { Utils.hideLoading(); showFatal('This activity has no problems yet.'); return; }
        renderProblemList();
        renderStatement(PROBLEMS[0]);
        bindEditor();
        $('editor').value = codeFor(PROBLEMS[0]);
        syncGutter(); updateCursor(); renderHighlight();
        await loadSamples(PROBLEMS[0]);
        refreshProgressCard();

        if (LIVE) {
          if (LIVE_GAME && typeof supabaseClient.channel === 'function') {
            LIVE_CHANNEL = ProgLive.subscribeGame(LIVE_GAME.id, onLiveGameUpdate);
          }
          if (LIVE_GAME && LIVE_GAME.status === 'ended') {
            window.location.replace('results.html?activity=' + encodeURIComponent(ACTIVITY_ID || ''));
            return;
          }
          if (LIVE_GAME && LIVE_GAME.status === 'running') startLiveTicking();
        } else {
          startStandaloneTimer();
          contestActive = true;   // standalone: rules active from the start
          if (!TEACHER) requestFs();
          Utils.showToast('Fair Play Rules are active — stay in fullscreen.', 'info');
        }
        Utils.hideLoading();
        Utils.showToast('Language: ' + LANG_CONFIG.label + ' — starter code ready', 'info');
        if (PROBLEMS[0]) loadRemote(PROBLEMS[0]);
      } catch (e) {
        console.error(e);
        Utils.hideLoading();
        showFatal('Something went wrong loading the activity. Please try again.');
      }
    });
  
