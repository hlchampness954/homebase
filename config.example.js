// Copy to config.js (same folder) to pre-configure devices without the setup screen.
// The anon key is safe to publish: Row Level Security protects the data.
window.HB_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  workerUrl: 'https://homebase-ai.YOUR-SUBDOMAIN.workers.dev',
};