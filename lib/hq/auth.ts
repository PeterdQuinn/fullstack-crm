import 'server-only';
import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

// Only the existing configured operator is admitted in Phase 2. Role names
// describe the future model; they do not grant access to new users today.
export async function hqOwner() {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username || !password) return null;
  if (await verifySessionToken(cookies().get(SESSION_COOKIE)?.value)) return { username, role: 'owner' as const };
  const authorization = headers().get('authorization') || '';
  if (!authorization.startsWith('Basic ')) return null;
  let supplied = '';
  try { supplied = atob(authorization.slice(6)); } catch { return null; }
  const expected = `${username}:${password}`;
  let mismatch = supplied.length ^ expected.length;
  for (let i = 0; i < Math.max(supplied.length, expected.length); i++) mismatch |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return mismatch === 0 ? { username, role: 'owner' as const } : null;
}
