"use client";

import { useEffect, useState } from "react";
import { Activity, LayoutDashboard, ListChecks, Search } from "lucide-react";

const NAV = [
  ["Overview", "/insurance/pipeline", LayoutDashboard, "board"],
  ["Discover agents", "/insurance/discover", Search, "discover"],
  ["Tasks", "/insurance/tasks", ListChecks, "tasks"],
  ["Activity", "/insurance/activity", Activity, "activity"],
] as const;

export function InsuranceNav({ mobile = false }: { mobile?: boolean }) {
  const [active, setActive] = useState("board");
  useEffect(() => {
    const sync = () => {
      const path = window.location.pathname.split("/").filter(Boolean).pop();
      setActive(path === "discover" || path === "tasks" || path === "activity" ? path : (window.location.hash.replace("#", "") || "board"));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return <nav className={mobile ? "fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white" : "flex-1 space-y-1 p-3"} aria-label="Insurance sections">
    {NAV.map(([label, href, Icon, key]) => <a key={key} href={href} aria-current={active === key ? "page" : undefined}
      className={mobile
        ? `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold ${active === key ? "bg-teal-50 text-teal-800" : "text-slate-500"}`
        : `flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${active === key ? "bg-teal-100 text-teal-900 ring-1 ring-teal-200" : "text-slate-600 hover:bg-teal-50 hover:text-teal-900"}`}>
      <Icon size={mobile ? 20 : 18} />{label}
    </a>)}
  </nav>;
}
