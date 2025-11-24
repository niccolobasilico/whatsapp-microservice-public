import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

if (!config.supabase.url || !config.supabase.key) {
  throw new Error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_KEY environment variables.');
}

export const supabase = createClient(config.supabase.url, config.supabase.key);
