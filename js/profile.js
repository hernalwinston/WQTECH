// ============================================================
// profile.html - page logic (extracted from inline <script>)
// Loaded AFTER the shared scripts (supabase-config, theme, utils, auth, ...).
// ============================================================

    let profileData = null;

    document.addEventListener('DOMContentLoaded', async () => {
      const user = await Auth.init();
      if (!user) { window.location.href = '../index.html'; return; }
      if (Auth.isAdmin) { window.location.href = 'admin.html'; return; }
      await loadProfile(user.id);
      await loadRank(user.id);
    });

    async function loadProfile(uid) {
      const { data } = await supabaseClient.from('user_profiles').select('*').eq('id', uid).single();
      if (!data) { window.location.href = 'dashboard.html'; return; }
      profileData = data;

      document.getElementById('editName').value = data.name || '';
      document.getElementById('editYear').value = data.year_section || '';
      document.getElementById('editBio').value = data.bio || '';
      document.getElementById('statPoints').textContent = data.total_points || 0;
      document.getElementById('statGames').textContent = data.games_played || 0;

      if (data.avatar_url) {
        document.getElementById('avatarLetter').style.display = 'none';
        const img = document.createElement('img');
        img.src = data.avatar_url;
        document.getElementById('avatarDisplay').insertAdjacentElement('afterbegin', img);
      } else {
        document.getElementById('avatarLetter').textContent = data.name ? data.name.charAt(0).toUpperCase() : '?';
      }
    }

    async function loadRank(uid) {
      const { data: all } = await supabaseClient.from('user_profiles').select('id, total_points').order('total_points', { ascending: false });
      if (all) {
        const rank = all.findIndex(p => p.id === uid) + 1;
        document.getElementById('statRank').textContent = rank > 0 ? '#' + rank : '-';
      }
    }

    async function uploadAvatar(input) {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return Utils.showToast('Image must be under 2MB', 'error');

      Utils.showLoading();
      const ext = file.name.split('.').pop();
      const path = `avatars/${Auth.currentUser.id}.${ext}`;

      const { error: upErr } = await supabaseClient.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) { Utils.hideLoading(); return Utils.showToast('Upload failed', 'error'); }

      const { data: urlData } = supabaseClient.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();

      await supabaseClient.from('user_profiles').update({ avatar_url: publicUrl }).eq('id', Auth.currentUser.id);

      const oldImg = document.querySelector('#avatarDisplay img');
      if (oldImg) oldImg.remove();
      document.getElementById('avatarLetter').style.display = 'none';
      const img = document.createElement('img');
      img.src = publicUrl;
      document.getElementById('avatarDisplay').insertAdjacentElement('afterbegin', img);

      Utils.hideLoading();
      Utils.showToast('Photo updated!', 'success');
    }

    async function saveProfile() {
      const name = document.getElementById('editName').value.trim();
      const year = document.getElementById('editYear').value.trim();
      const bio = document.getElementById('editBio').value.trim();
      if (!name) return Utils.showToast('Name is required', 'error');

      Utils.showLoading();
      const { error } = await supabaseClient.from('user_profiles').update({
        name: name, year_section: year, bio: bio
      }).eq('id', Auth.currentUser.id);
      Utils.hideLoading();

      if (error) return Utils.showToast(error.message, 'error');

      const status = document.getElementById('saveStatus');
      status.style.display = 'block';
      setTimeout(() => { status.style.display = 'none'; }, 3000);

      document.getElementById('avatarLetter').textContent = name.charAt(0).toUpperCase();
    }
  
