export const config = {
  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
  },
  storage: {
    mode: process.env.STORAGE_MODE || 'local', // 'local' or 'supabase'
    bucket: 'whatsapp-media',
  },
  whatsapp: {
    sessionName: 'whatsapp-session',
  },
  queue: {
    pollIntervalMs: 10000, // Check Supabase every 10 seconds
    maxMessagesPerMinute: 3,
    sendIntervalMs: 20000, // 20 seconds = 3 per minute
    maxRetries: 3,
  },
  server: {
    port: process.env.PORT || 3000,
  },
};
