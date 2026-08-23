"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";


const display = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

// Where a successful sign-in lands. This is the CRM's existing front door.
const DASHBOARD_ROUTE = "/crm/unified-dashboard";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");


  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }

    setWorking(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data: { error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not sign you in.");
      router.push(DASHBOARD_ROUTE);
      router.refresh();
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
          <p className="mt-2 text-sm text-[#4F6058]">Sign in with your CRM credentials.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <label className="block text-sm font-semibold text-[#0B1F17]">
              Username
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 min-h-[48px] w-full rounded-xl border border-[#125740]/25 bg-white px-4 font-normal text-[#0B1F17] outline-none transition-colors placeholder:text-[#4F6058]/60 focus:border-[#125740]"
                placeholder="Your username"
              />
            </label>

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

            {error && (
              <p role="alert" className="rounded-xl border border-[#8A6516]/35 bg-[#8A6516]/10 px-4 py-3 text-sm text-[#8A6516]">
                {error}
              </p>
            )}


            <button
              type="submit"
              disabled={working}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#125740] px-6 font-bold text-white transition-colors hover:bg-[#0A3A2A] disabled:opacity-60"
            >
              {working ? "Signing in…" : "Sign in"}
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
