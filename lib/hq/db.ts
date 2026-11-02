import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function hqDb(source: 'crm' | 'insurance' = 'crm') {
  const url = source === 'crm' ? process.env.NEXT_PUBLIC_SUPABASE_URL : process.env.INSURANCE_SUPABASE_URL;
  const key = source === 'crm' ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.INSURANCE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`${source === 'crm' ? 'HQ' : 'Insurance'} data source is not configured`);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: init?.signal || AbortSignal.timeout(6000) }) },
  });
}
