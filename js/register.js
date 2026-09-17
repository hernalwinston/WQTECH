// ============================================================
// register.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    let currentStep = 1;

    document.addEventListener('DOMContentLoaded', async () => {
      const user = await Auth.init();
      if (user) {
        const { data } = await supabaseClient.from('user_profiles').select('id').eq('id', user.id).maybeSingle();
        if (data) window.location.href = 'dashboard.html';
      }
    });

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

    function goToStep(step) {
      if (step === 2 && currentStep === 1) {
        const name = document.getElementById('regName').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const confirm = document.getElementById('regConfirm').value;
        const year = document.getElementById('regYear').value.trim();
        if (!name) return Utils.showToast('Please enter your name', 'error');
        if (!email) return Utils.showToast('Please enter your email', 'error');
        if (!password || password.length < 6) return Utils.showToast('Password must be at least 6 characters', 'error');
        if (password !== confirm) return Utils.showToast('Passwords do not match', 'error');
        if (!year) return Utils.showToast('Please enter your year/section', 'error');
        document.getElementById('previewName').textContent = name;
        document.getElementById('previewEmail').textContent = email;
      }

      document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`step${step}`).classList.add('active');

      document.querySelectorAll('.step-dot').forEach((d, i) => {
        d.classList.remove('active', 'done');
        if (i + 1 < step) d.classList.add('done');
        if (i + 1 === step) d.classList.add('active');
      });

      currentStep = step;
    }

    async function completeRegistration() {
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;
      const year = document.getElementById('regYear').value.trim();

      Utils.showLoading();
      const result = await Auth.registerStudent(name, year, email, password);
      Utils.hideLoading();

      if (result.success) {
        Utils.showToast('Account created!', 'success');
        setTimeout(() => window.location.href = 'dashboard.html', 800);
      } else {
        Utils.showToast(result.error, 'error');
      }
    }
  
