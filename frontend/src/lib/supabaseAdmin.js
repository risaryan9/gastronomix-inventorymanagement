import { createClient } from '@supabase/supabase-js'

// Use the same client as regular - RLS policy allows login_key lookups
// Service role key should NEVER be in frontend code
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// Regular client - RLS policy will allow login_key queries
export const supabaseAdmin = createClient(supabaseUrl, supabaseAnonKey)
