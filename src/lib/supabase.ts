import { createClient } from "@supabase/supabase-js";

// Public client credentials — safe to ship in browser code.
const SUPABASE_URL = "https://qjkdhellmjwmpvwxhshi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BkH36tfJJcfGvjbNUclhgQ_RFkubnbG";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
