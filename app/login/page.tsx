"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const display = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

// Where a successful sign-in lands. This is the CRM's existing front door.
const DASHBOARD_ROUTE = "/crm/unified-dashboard";

type Mode = "password" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!isSupabaseConfigured()) {
      setError("Sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (mode === "password" && !password) {
      setError("Enter your password.");
      return;
    }

    setWorking(true);
    try {
      if (mode === "password") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw new Error(signInError.message);
        router.push(DASHBOARD_ROUTE);
        router.refresh();
        return;
      }

      const { error: linkError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}${DASHBOARD_ROUTE}` },
      });
      if (linkError) throw new Error(linkError.message);
      setNotice(`Check ${email.trim()} for a sign-in link.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not sign you in.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main
      className={`${display.variable} ${body.variable} ${mono.variable} flex min-h-screen flex-col bg-[#F7F9F8] text-[#0B1F17] antialiased`}
      style={{ fontFamily: "var(--font-body)" }}
    >
      <header className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <Link href="/" className="font-mono text-xs tracking-[0.2em] text-[#0E7A45]" style={{ fontFamily: "var(--font-mono)" }}>
          FULL&nbsp;STACK&nbsp;CRM
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 pb-20 sm:px-8">
        <div className="w-full max-w-md rounded-2xl border border-[#125740]/30/15 bg-white p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
            Sign in
          </h1>
          <p className="mt-2 text-sm text-[#4F6058]">Access your pipeline.</p>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-[#125740]/30/15 p-1">
            {(["password", "magic"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => { setMode(option); setError(""); setNotice(""); }}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  mode === option ? "bg-[#125740] text-[#0B1F17]" : "text-[#4F6058] hover:text-[#0B1F17]"
                }`}
              >
                {option === "password" ? "Password" : "Magic link"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <label className="block text-sm font-semibold text-[#0B1F17]">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 min-h-[48px] w-full rounded-xl border border-[#125740]/30/25 bg-[#F7F9F8] px-4 font-normal text-[#0B1F17] outline-none transition-colors placeholder:text-[#4F6058]/60 focus:border-[#125740]"
                placeholder="you@company.com"
              />
            </label>

            {mode === "password" && (
              <label className="block text-sm font-semibold text-[#0B1F17]">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 min-h-[48px] w-full rounded-xl border border-[#125740]/30/25 bg-[#F7F9F8] px-4 font-normal text-[#0B1F17] outline-none transition-colors placeholder:text-[#4F6058]/60 focus:border-[#125740]"
                  placeholder="••••••••"
                />
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-xl border border-[#8A6516]/35 bg-[#8A6516]/10 px-4 py-3 text-sm text-[#8A6516]">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-xl border border-[#125740]/30 bg-[#125740]/10 px-4 py-3 text-sm text-[#0E7A45]">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={working}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#125740] px-6 font-bold text-white transition-colors hover:bg-[#0A3A2A] disabled:opacity-60"
            >
              {working ? "Signing in…" : mode === "password" ? "Sign in" : "Send magic link"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#4F6058]">
            <Link href="/" className="underline underline-offset-4 transition-colors hover:text-[#0B1F17]">
              Back to home
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
