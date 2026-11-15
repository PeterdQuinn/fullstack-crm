'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { FULL_STACK, INSURANCE, HVAC, SHARED, ADMIN, type Section } from '@/lib/hq/workspaces';

export default function HqShell({children}:{children:React.ReactNode}) {
  const path=usePathname() || '';
  const [recordInsurance,setRecordInsurance]=useState(false);
  useEffect(()=>setRecordInsurance(path.startsWith('/hq/record/') && new URLSearchParams(window.location.search).get('workspace')==='peter_quinn'),[path]);
  const insurance=recordInsurance || path.startsWith('/insurance') || path.startsWith('/crm/insurance') || path.startsWith('/hq/peter-quinn');
  const shared=path.startsWith('/hq/shared'); const admin=path.startsWith('/hq/admin');
  const area=insurance?'peter-quinn':'full-stack';
  const [open,setOpen]=useState(false);
  const [hvacContext,setHvacContext]=useState(false);
  useEffect(()=>setHvacContext(window.location.search.includes("business_unit=hvac")),[path]);
  function menu(items:Section[],prefix:string) {return items.map(item=>{
    const href=item.href || `${prefix}/${item.slug}`;
    const active=(href.includes('?') ? path===href.split('?')[0] && hvacContext : path===href) || (href!='/insurance' && path.startsWith(href+'/'));
    return <Link key={item.slug} href={href} onClick={e=>{setOpen(false);if(href.startsWith("/crm/leads")){e.preventDefault();window.location.assign(href);}}} aria-current={active?'page':undefined}
      className={`block rounded-lg px-3 py-2 text-sm ${active?'bg-teal-50 font-semibold text-teal-900':'text-slate-600 hover:bg-slate-100'}`}>{item.label}</Link>;
  });}
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
      <Link href="/hq" className="shrink-0 text-sm font-extrabold tracking-widest text-teal-900">FULL STACK HQ</Link>
      <nav aria-label="Business workspace" className="flex gap-1 overflow-x-auto text-xs sm:text-sm">
        <Link href="/hq/full-stack/dashboard" className={`rounded-lg px-3 py-2 ${!insurance&&!shared&&!admin?'bg-teal-900 text-white':'hover:bg-slate-100'}`}>Full Stack Services</Link>
        <Link href="/hq/peter-quinn/dashboard" className={`rounded-lg px-3 py-2 ${insurance?'bg-teal-900 text-white':'hover:bg-slate-100'}`}>Peter Quinn / Insurance</Link>
      </nav>
      <button onClick={()=>setOpen(!open)} aria-expanded={open} aria-controls="hq-navigation" className="rounded border px-3 py-2 text-xs md:hidden">Menu</button>
      <form className="hidden md:block" action="/hq/shared/search"><input name="q" aria-label="Search HQ" placeholder="Search everything…" className="w-40 rounded-lg border bg-slate-50 px-3 py-2 text-sm" /></form>
    </header>
    <aside id="hq-navigation" className={`${open?'block':'hidden'} fixed bottom-0 left-0 top-16 z-40 w-64 overflow-y-auto border-r bg-white p-3 md:block`}>
      <Link href="/hq" onClick={()=>setOpen(false)} className="mb-3 block rounded-lg px-3 py-2 text-sm font-bold">Command Center</Link>
      <p className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">{admin?'Admin':shared?'Shared':insurance?'Peter Quinn / Insurance':'Full Stack Services'}</p>
      <nav aria-label="Workspace sections">{menu(admin?ADMIN:shared?SHARED:insurance?INSURANCE:FULL_STACK,`/hq/${admin?'admin':shared?'shared':area}`)}
      {!insurance&&!shared&&!admin&&<details open={path.includes('/hvac') || (hvacContext)} className="mt-3 border-t pt-3"><summary className="cursor-pointer px-3 py-2 text-sm font-bold">HVAC · Product line</summary><div className="ml-3 border-l pl-2">{menu(HVAC,'/hq/full-stack/hvac')}</div></details>}</nav>
      <nav aria-label="Shared and administration" className="mt-5 border-t pt-3">
        <Link href="/hq/shared/search" onClick={()=>setOpen(false)} className="block px-3 py-2 text-sm font-semibold">Shared</Link>
        <Link href="/hq/admin/systems" onClick={()=>setOpen(false)} className="block px-3 py-2 text-sm font-semibold">Admin</Link>
        <p className="px-3 py-2 text-xs text-slate-400">Owner workspace</p>
        <button onClick={async()=>{await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login';}} className="px-3 py-2 text-xs text-slate-500">Sign out</button>
      </nav>
    </aside>
    <main className="min-w-0 md:pl-64">{children}</main>
  </div>;
}
