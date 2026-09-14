"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const workspaces = [
  { id: "fss", title: "Full Stack Services", description: "CRM, customers, jobs, and automation.", route: "/crm/unified-dashboard" },
  { id: "producerforge", title: "The Learning Lantern Academy", description: "Insurance producer recruiting, bilingual matching, and academy operations.", route: "/insurance" },
] as const;

export default function WorkspacePage() {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function choose(workspace: (typeof workspaces)[number]) {
    setWorking(workspace.id);
    setError("");
    const response = await fetch("/api/workspace/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: workspace.id }),
    });
    if (!response.ok) {
      setError("Your session expired. Please sign in again.");
      setWorking(null);
      return;
    }
    router.push(workspace.route);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[#F7F9F8] px-5 py-16 text-[#0B1F17] sm:px-8">
      <div className="mx-auto max-w-4xl">
        <p className="font-mono text-xs tracking-[0.2em] text-[#0E7A45]">FULL STACK CRM</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Choose your workspace</h1>
        <p className="mt-3 max-w-xl text-[#4F6058]">Each workspace is isolated to its own database and permissions boundary.</p>
        {error && <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {workspaces.map((workspace) => (
            <button key={workspace.id} onClick={() => choose(workspace)} disabled={working !== null}
              className="rounded-2xl border border-[#125740]/15 bg-white p-7 text-left transition hover:-translate-y-1 hover:border-[#125740]/40 hover:shadow-lg disabled:opacity-60">
              <h2 className="text-xl font-bold">{workspace.title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#4F6058]">{workspace.description}</p>
              <span className="mt-8 inline-block text-sm font-semibold text-[#125740]">{working === workspace.id ? "Opening…" : "Open workspace →"}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
