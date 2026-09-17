// ============================================================
// index.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    function toggleMobile() { document.getElementById('mobileMenu').classList.toggle('active'); }
    function closeMobile() { document.getElementById('mobileMenu').classList.remove('active'); }

    let isAdminMode = false;

    function togglePass(fieldId, btn) {
      const field = document.getElementById(fieldId);
      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');
      if (field.type === 'password') {
        field.type = 'text';
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
      } else {
        field.type = 'password';
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
      }
    }

    function checkAdminCode(input) {
      const v = input.value.trim();
      const card = document.getElementById('heroLogin');
      const label = document.getElementById('modeLabel');
      const title = document.getElementById('loginTitle');
      const subtitle = document.getElementById('loginSubtitle');
      const sf = document.getElementById('studentForm');
      const af = document.getElementById('adminForm');

      if (v === ADMIN_ACCESS_CODE) {
        isAdminMode = true;
        card.classList.add('admin-mode');
        label.textContent = 'Admin Access';
        title.textContent = 'Admin Portal';
        subtitle.textContent = 'Sign in with your admin credentials';
        sf.style.display = 'none';
        af.style.display = 'block';
        input.value = '';
        input.placeholder = 'Admin mode active';
        input.disabled = true;
        input.style.opacity = '0.5';
        document.getElementById('aEmail').focus();
      }
    }

    function showLoginError(msg) {
      const el = document.getElementById('loginError');
      el.textContent = msg;
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    async function studentLogin() {
      const email = document.getElementById('sEmail').value.trim();
      const password = document.getElementById('sPass').value;
      if (!email || !password) return showLoginError('Fill in all fields');

      localStorage.setItem('qb_credentials', JSON.stringify({ email, password }));
      document.getElementById('loading-overlay').style.display = 'flex';

      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: adminCheck } = await supabaseClient.from('admins').select('id').eq('id', data.user.id).maybeSingle();
        if (adminCheck) {
          document.getElementById('loading-overlay').style.display = 'none';
          return showLoginError('This is an admin account. Use the admin access code.');
        }

        window.location.href = 'pages/dashboard.html';
      } catch (e) {
        document.getElementById('loading-overlay').style.display = 'none';
        showLoginError(e.message || 'Login failed');
      }
    }

    async function adminLogin() {
      const email = document.getElementById('aEmail').value.trim();
      const password = document.getElementById('aPass').value;
      if (!email || !password) return showLoginError('Fill in all fields');

      document.getElementById('loading-overlay').style.display = 'flex';

      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: adminRow, error: adminErr } = await supabaseClient.from('admins').select('id').eq('id', data.user.id).maybeSingle();
        if (adminErr || !adminRow) {
          await supabaseClient.auth.signOut();
          document.getElementById('loading-overlay').style.display = 'none';
          return showLoginError('This account is not an admin.');
        }

        window.location.href = 'pages/admin.html';
      } catch (e) {
        document.getElementById('loading-overlay').style.display = 'none';
        showLoginError(e.message || 'Login failed');
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session && session.user) {
          const { data: adminCheck } = await supabaseClient.from('admins').select('id').eq('id', session.user.id).maybeSingle();
          window.location.href = adminCheck ? 'pages/admin.html' : 'pages/dashboard.html';
        }
      } catch (e) { console.error(e); }
    });
  
