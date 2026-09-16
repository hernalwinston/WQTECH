// ============================================================
// SUPABASE CONFIGURATION
// ============================================================
const SUPABASE_URL = "https://rknsbfykyulrejnbwjuf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1eOKsHa61pzfly5n4DMutg_hOpDQLMe";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});
