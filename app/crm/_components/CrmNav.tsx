"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquare,
  Phone,
  Calendar,
  Mail,
  Send,
  GraduationCap,
  Users,
  Ban,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// The 4 primary destinations — these are the mobile bottom-bar tabs.
const PRIMARY: NavItem[] = [
  { label: "Home", href: "/crm/unified-dashboard", icon: Home },
  { label: "Replies", href: "/crm/replies", icon: MessageSquare },
  { label: "Calls", href: "/crm/call-queue", icon: Phone },
  { label: "Bookings", href: "/crm/bookings", icon: Calendar },
];

// Desktop sidebar shows everything; mobile bottom bar shows only PRIMARY.
const SECONDARY: NavItem[] = [
  { label: "Email Queue", href: "/crm/email-queue", icon: Mail },
  { label: "DM Queue", href: "/crm/dm-queue", icon: Send },
  { label: "Onboarding", href: "/crm/onboarding", icon: GraduationCap },
  { label: "All Leads", href: "/crm/leads", icon: Users },
  { label: "Suppressed", href: "/crm/suppressed", icon: Ban },
  { label: "Reports", href: "/crm/reports", icon: BarChart3 },
];

function isActive(pathname: string, href: string) {
  if (href === "/crm/unified-dashboard") {
    return pathname === href || pathname === "/crm";
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export default function CrmNav() {
  const pathname = usePathname() || "";

  return (
    <>
      {/* ── Desktop: fixed left sidebar (md and up) ───────────────────────── */}
      <aside className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-40 md:w-60 md:flex-col md:border-r md:border-gray-200 md:bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
            FS
          </div>
          <div className="text-sm font-bold leading-tight text-gray-900">
            Full&nbsp;Stack
            <span className="block text-xs font-medium text-gray-400">CRM</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {[...PRIMARY, ...SECONDARY].map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-light text-brand"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ── Mobile: fixed bottom tab bar (below md) ───────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {PRIMARY.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                active ? "text-brand" : "text-gray-400"
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
