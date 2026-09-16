// ============================================================
// AUTHENTICATION MODULE (Supabase)
// ============================================================

// ============================================================
// ADMIN ACCESS GATE CODE (index.html + login form on the landing page)
// Only people who know this code can reach the admin login
// form. Change it to anything you want.
// ============================================================
const ADMIN_ACCESS_CODE = 'admin123';

const Auth = {
  currentUser: null,
  isAdmin: false,

  // Translate raw Supabase errors into messages students actually understand
  friendlyAuthError(error) {
    const m = (error && error.message) || 'Something went wrong. Please try again.';
    if (/already registered|already exists|duplicate key/i.test(m)) return 'This email already has an account. Please login instead, or use a different email.';
    if (/invalid login credentials/i.test(m)) return 'Wrong email or password. Please try again.';
    if (/email not confirmed/i.test(m)) return 'Please confirm your email first (check your inbox), then login.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
    if (/at least 6|password should be|requires a valid password/i.test(m)) return 'Password must be at least 6 characters.';
    if (/valid email|invalid format/i.test(m)) return 'Please enter a valid email address.';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'No internet connection. Check your network and try again.';
    if (/anonymous sign-ins are disabled/i.test(m)) return 'Please register with your email to continue.';
    return m;
  },

  init() {
    return new Promise((resolve) => {
      supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (session && session.user) {
          this.currentUser = session.user;
          this.checkAdminStatus(session.user.id).then(() => resolve(session.user));
        } else {
          this.currentUser = null;
          this.isAdmin = false;
          resolve(null);
        }
      }).catch(err => {
        console.error('Auth init error:', err);
        this.currentUser = null;
        this.isAdmin = false;
        resolve(null);
      });
    });
  },

  // ---- ADMIN: Register (via setup-admin.html) ----
  async registerAdmin(email, password, displayName) {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { display_name: displayName } }
      });
      if (error) throw error;
      if (!data.user) throw new Error("No user created");

      const { error: adminError } = await supabaseClient.from("admins").insert({
        id: data.user.id,
        email: email,
        display_name: displayName,
        role: "admin"
      });
      if (adminError) throw adminError;

      if (!data.session) {
        const { error: signInErr } = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });
        if (signInErr) console.warn("Auto sign-in note:", signInErr.message);
      }

      this.currentUser = data.user;
      this.isAdmin = true;
      return { success: true, uid: data.user.id };
    } catch (error) {
      return { success: false, error: this.friendlyAuthError(error) };
    }
  },

  // ---- ADMIN: Login ----
  async loginAdmin(email, password) {
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });
      if (error) throw error;

      const { data: adminRow, error: adminErr } = await supabaseClient
        .from("admins")
        .select("id, display_name, email")
        .eq("id", data.user.id)
        .maybeSingle();

      if (adminErr) throw adminErr;
      if (!adminRow) {
        await supabaseClient.auth.signOut();
        return { success: false, error: "This account is not an admin. Go to setup-admin.html first." };
      }

      this.currentUser = data.user;
      this.isAdmin = true;
      return { success: true, uid: data.user.id, admin: adminRow };
    } catch (error) {
      return { success: false, error: this.friendlyAuthError(error) };
    }
  },

  // ---- STUDENT: Register ----
  async registerStudent(name, yearSection, email, password) {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name } }
      });
      if (error) throw error;
      if (!data.user) throw new Error("No user created");

      const { error: profileErr } = await supabaseClient.from("user_profiles").upsert({
        id: data.user.id,
        email: email,
        name: name,
        year_section: yearSection,
        is_guest: false,
        total_points: 0,
        games_played: 0
      }, { onConflict: 'id', ignoreDuplicates: true });

      if (profileErr) console.warn("Profile note:", profileErr.message);

      localStorage.setItem("qb_credentials", JSON.stringify({ email, password }));
      localStorage.setItem("qb_profile", JSON.stringify({
        id: data.user.id,
        name: name,
        yearSection: yearSection
      }));

      if (!data.session) {
        const { error: signInErr } = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });
        if (signInErr && /not confirmed/i.test(signInErr.message)) {
          return { success: false, error: 'Account created! Please confirm your email (check your inbox), then login.' };
        }
        if (signInErr) console.warn('Auto sign-in note:', signInErr.message);
      }

      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session && session.user) {
        this.currentUser = session.user;
      } else {
        this.currentUser = data.user;
      }
      this.isAdmin = false;

      return { success: true, uid: data.user.id };
    } catch (error) {
      return { success: false, error: this.friendlyAuthError(error) };
    }
  },

  // ---- STUDENT: Login using stored credentials ----
  async loginStudent() {
    try {
      const creds = JSON.parse(localStorage.getItem("qb_credentials"));
      if (!creds) return { success: false, error: "No saved account. Please register first." };

      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: creds.email,
        password: creds.password
      });
      if (error) throw error;

      this.currentUser = data.user;
      this.isAdmin = false;
      return { success: true, uid: data.user.id };
    } catch (error) {
      localStorage.removeItem("qb_credentials");
      localStorage.removeItem("qb_profile");
      return { success: false, error: this.friendlyAuthError(error) };
    }
  },

  // ---- GUEST: Quick join ----
  async guestLogin(name) {
    try {
      const email = "guest_" + Date.now() + "@quizbattle.app";
      const password = "Guest_" + Date.now() + "!";

      const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name } }
      });
      if (error) throw error;
      if (!data.user) throw new Error("No user created");

      const { error: profileErr } = await supabaseClient.from("user_profiles").upsert({
        id: data.user.id,
        name: name,
        is_guest: true,
        total_points: 0,
        games_played: 0
      }, { onConflict: 'id', ignoreDuplicates: true });

      if (profileErr) console.warn("Profile note:", profileErr.message);

      if (!data.session) {
        const { error: signInErr } = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });
        if (signInErr) console.warn("Auto sign-in note:", signInErr.message);
      }

      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session && session.user) {
        this.currentUser = session.user;
      } else {
        this.currentUser = data.user;
      }
      this.isAdmin = false;

      return { success: true, uid: data.user.id };
    } catch (error) {
      return { success: false, error: this.friendlyAuthError(error) };
    }
  },

  async checkAdminStatus(uid) {
    try {
      const { data } = await supabaseClient
        .from("admins")
        .select("id")
        .eq("id", uid)
        .maybeSingle();
      this.isAdmin = !!data;
      return !!data;
    } catch {
      this.isAdmin = false;
      return false;
    }
  },

  async logout() {
    await supabaseClient.auth.signOut();
    this.currentUser = null;
    this.isAdmin = false;
    localStorage.removeItem("qb_credentials");
    localStorage.removeItem("qb_profile");
  }
};
