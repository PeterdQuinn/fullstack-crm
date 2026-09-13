import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Best-effort brute-force brake.
//
// One username, one password, and nothing between an attacker and unlimited
// guesses. This is per-instance memory, so a serverless fleet weakens it — it
// is a brake, not a lock, and a long random APP_PASSWORD is still what actually
// protects the account. It costs nothing and turns an unbounded online attack
// into a slow one.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; first: number }>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const seen = attempts.get(ip);
  if (!seen || now - seen.first > ATTEMPT_WINDOW_MS) return false;
  return seen.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const seen = attempts.get(ip);
  if (!seen || now - seen.first > ATTEMPT_WINDOW_MS) attempts.set(ip, { count: 1, first: now });
  else seen.count++;
  // Bound the map so a spray across forged IPs cannot grow it without limit.
  if (attempts.size > 5000) {
    for (const [key, value] of attempts) if (now - value.first > ATTEMPT_WINDOW_MS) attempts.delete(key);
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  const { username, password } = await req.json().catch(() => ({ username: "", password: "" }));

  const expectedUser = process.env.APP_USERNAME;
  const expectedPass = process.env.APP_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return NextResponse.json({ error: "Sign-in is not configured on this server." }, { status: 500 });
  }

  // Evaluate both without short-circuiting, same as the Basic Auth path.
  const userOk = safeEqual(String(username || ""), expectedUser);
  const passOk = safeEqual(String(password || ""), expectedPass);
  if (!userOk || !passOk) {
    recordFailure(ip);
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  attempts.delete(ip);

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionToken(expectedUser),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
