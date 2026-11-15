'use client';
// Generated from the website src/components/admin/LegionShell.tsx. Update that source, then run scripts/sync-legion-shell.mjs.
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-location-assign-relative-destination, @next/next/no-img-element -- Full document navigation crosses the Pages/App Router service boundary. */
import { useState, type ReactNode } from 'react';
import { LayoutDashboard, Users, Search, Mail, Phone, CalendarDays, CheckSquare, FolderOpen, FileText, DollarSign, BarChart3, Settings, Menu, X, ArrowUpRight, Sparkles, ShieldCheck, ChevronDown, LogOut, Inbox, Workflow } from 'lucide-react';

const groups = [
  { label: 'Workspace', items: [
    { label: 'Overview', href: '/admin', icon: LayoutDashboard },
    { label: 'Leads & pipeline', href: '/crm/leads', icon: Users },
    { label: 'Discovery & research', href: '/crm/discovery', icon: Search },
    { label: 'Lead review', href: '/admin/lead-reviews', icon: ShieldCheck },
    { label: 'Email queue', href: '/crm/email-queue', icon: Mail },
    { label: 'Replies', href: '/crm/replies', icon: Inbox },
    { label: 'Calls & follow-ups', href: '/crm/call-queue', icon: Phone },
    { label: 'Meetings', href: '/crm/bookings', icon: CalendarDays },
  ] },
  { label: 'Delivery & growth', items: [
    { label: 'Clients', href: '/admin/clients', icon: Users },
    { label: 'Tasks', href: '/hq/full-stack/tasks', icon: CheckSquare },
    { label: 'Projects', href: '/hq/full-stack/projects', icon: FolderOpen },
    { label: 'Proposals & documents', href: '/hq/full-stack/proposals', icon: FileText },
    { label: 'Revenue', href: '/admin/analytics', icon: DollarSign },
    { label: 'Traffic & analytics', href: '/admin/traffic', icon: BarChart3 },
  ] },
];
const tools = [
  ['CRM dashboard','/crm/unified-dashboard'], ['Research queue','/crm/dm-queue'], ['Onboarding','/crm/onboarding'],
  ['CRM reports','/crm/reports'], ['Suppression list','/crm/suppressed'], ['Documents','/hq/full-stack/documents'],
  ['Contracts','/hq/full-stack/contracts'], ['RFPs / bids','/hq/full-stack/rfps'], ['Campaigns','/hq/full-stack/campaigns'],
  ['Client projects & invoices','/admin/adminDashboard'], ['Website bookings','/admin/bookings'],
  ['Booking requests','/admin/booking-request'], ['AI Operations','/admin/operations'], ['Business overview','/admin/super'],
  ['HQ command center','/hq/full-stack/dashboard'], ['Insurance workspace','/insurance'],
  ['HVAC workspace','/hq/full-stack/hvac/leads'], ['Shared inbox','/hq/shared/inbox'], ['Calendar','/hq/shared/calendar'],
  ['Contacts','/hq/shared/contacts'], ['HQ invoice records','/hq/full-stack/revenue'], ['Systems','/hq/admin/systems'],
];
export default function LegionShell({ children, path = '/admin', title = 'Overview' }: { children: ReactNode; path?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const active = (href: string) => href === '/admin' ? path === '/admin' : path === href.split('#')[0];
  return <div className="min-h-screen bg-[#f5f7fb] text-slate-900" style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
    {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" />}
    <aside aria-label="Legion sidebar" className={`${open ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0`}>
      <a href="/admin" className="flex h-20 shrink-0 items-center gap-3 border-b border-slate-100 px-6"><img src="/fullstackservicesllc-mark.svg" alt="Full Stack Services LLC" width={42} height={42} className="h-11 w-11 shrink-0 object-contain" /><span><span className="block text-sm font-bold tracking-tight text-slate-900">Full Stack Services</span><span className="block text-[10px] font-semibold tracking-[0.15em] text-slate-400">LEGION · ADMIN WORKSPACE</span></span></a>
      <div className="mx-4 mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-800">FS</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Full Stack Services</p><p className="text-xs text-slate-500">Owner workspace</p></div><ShieldCheck size={15} className="text-slate-400" /></div>
      <nav aria-label="Legion navigation" className="flex-1 space-y-6 overflow-y-auto px-3 py-6">
        {groups.map(group => <div key={group.label}><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{group.label}</p><div className="space-y-1">{group.items.map(({ label, href, icon: Icon }) => <a key={href} href={href} aria-current={active(href) ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${active(href) ? 'bg-sky-50 text-sky-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon size={17} strokeWidth={1.7} />{label}{active(href) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sky-500" />}</a>)}</div></div>)}
        <div><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Operations</p><a href="/crm/automation" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-slate-600 hover:bg-slate-50"><Workflow size={17} />Automation controls</a><details className="group"><summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-slate-600 hover:bg-slate-50"><Settings size={17} />All tools<ChevronDown size={14} className="ml-auto group-open:rotate-180" /></summary><div className="ml-5 space-y-1 border-l border-slate-200 pl-3 pt-2">{tools.map(([label, href]) => <a key={href} href={href} className="block rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-900">{label}</a>)}</div></details></div>
      </nav>
      <div className="shrink-0 border-t border-slate-100 p-4"><div className="mb-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3"><Sparkles size={16} className="mt-0.5 text-sky-600" /><div><p className="text-xs font-semibold">Lunah AI</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Agent workers are not connected yet.</p></div></div><div className="flex items-center justify-between"><a href="/" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">View website<ArrowUpRight size={13} /></a><button disabled={signingOut} onClick={async () => { setSigningOut(true); try { const r = await fetch('/api/legion/logout', { method: 'POST' }); if (!r.ok) throw new Error(); window.location.assign('/admin/login'); } catch { setSigningOut(false); alert('Sign out failed. Please try again.'); } }} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><LogOut size={13} />{signingOut ? 'Signing out…' : 'Sign out'}</button></div></div>
    </aside>
    <div className="min-w-0 lg:pl-64"><header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 backdrop-blur sm:px-8"><div className="flex min-w-0 items-center gap-3"><button aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-lg border border-slate-200 p-2 lg:hidden">{open ? <X size={18} /> : <Menu size={18} />}</button><span className="hidden text-sm text-slate-400 sm:inline">Workspace</span><span className="hidden text-slate-300 sm:inline">/</span><span className="truncate text-sm font-semibold">{title}</span></div><div className="flex items-center gap-3"><a href="/hq/shared/search" aria-label="Search workspace" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500"><Search size={15} /><span className="hidden sm:inline">Search workspace</span></a><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#172b4d] text-xs font-semibold text-white" title="Owner">FS</span></div></header><main id="legion-content" className="min-w-0">{children}</main></div>
  </div>;
}
