'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const SECTIONS=[['Dashboard','/crm/unified-dashboard'],['Replies','/crm/replies'],['Calls','/crm/call-queue'],['Bookings','/crm/bookings'],['Discovery','/crm/discovery'],['Research','/crm/dm-queue'],['Email','/crm/email-queue'],['Onboarding','/crm/onboarding'],['Automation','/crm/automation'],['Reports','/crm/reports'],['Suppressed','/crm/suppressed']];
export default function CrmNav(){const path=usePathname();return <nav aria-label="CRM tools" className="flex gap-2 overflow-x-auto border-b bg-white px-4 py-3">{SECTIONS.map(([label,href])=><Link key={href} href={href} aria-current={path===href?'page':undefined} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${path===href?'bg-teal-50 text-teal-900':'text-slate-500 hover:bg-slate-50'}`}>{label}</Link>)}</nav>;}
