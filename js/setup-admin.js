// ============================================================
// setup-admin.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    supabaseClient.from('admins').select('id').limit(1).then(({ data }) => {
      if (data && data.length > 0) {
        document.getElementById('setupForm').style.display = 'none';
        const r = document.getElementById('setupResult'); r.style.display = 'block';
        r.innerHTML = '<div class="success-box"><h3>Admin Already Exists</h3><p>An admin account is already configured.</p><p style="margin-top:12px;"><a href="admin.html">Go to Admin Login</a></p></div>';
      }
    });

    function togglePass() {
      const f = document.getElementById('adminPassword'), b = event.currentTarget;
      const eyeOpen = b.querySelector('.eye-open');
      const eyeClosed = b.querySelector('.eye-closed');
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

    async function createAdmin() {
      const name = document.getElementById('adminName').value.trim();
      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;
      if (!name) return alert('Enter a name');
      if (!email) return alert('Enter an email');
      if (!password || password.length < 6) return alert('Password must be 6+ characters');

      document.getElementById('loading-overlay').style.display = 'flex';
      try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { display_name: name } } });
        if (error) throw error;
        if (!data.user) throw new Error('No user created');

        const { error: ae } = await supabaseClient.from('admins').insert({ id: data.user.id, email, display_name: name, role: 'admin' });
        if (ae) throw ae;

        await supabaseClient.from('user_profiles').upsert({ id: data.user.id, name, total_points: 0, games_played: 0 }, { onConflict: 'id', ignoreDuplicates: true });

        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('setupForm').style.display = 'none';
        const r = document.getElementById('setupResult'); r.style.display = 'block';
        r.innerHTML = `<div class="success-box"><h3>Admin Created!</h3><p>Email: ${email}</p><p style="margin-top:12px;"><a href="admin.html">Go to Admin Login</a></p></div>`;
      } catch (err) {
        document.getElementById('loading-overlay').style.display = 'none';
        const r = document.getElementById('setupResult'); r.style.display = 'block';
        r.innerHTML = `<div class="error-box"><h3>Error</h3><p>${err.message}</p></div>`;
      }
    }
  
