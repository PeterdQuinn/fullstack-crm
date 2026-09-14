import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { InsuranceNav } from "./insurance-nav";

export default function InsuranceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-5"><Link href="/insurance" className="text-base font-bold leading-tight text-teal-900">The Learning Lantern<span className="block text-xs font-medium text-slate-500">Academy · Insurance</span></Link></div>
        <InsuranceNav />
        <Link href="/workspace" className="m-3 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><ArrowLeftRight size={16} /> Switch company</Link>
      </aside>
      <header className="border-b border-slate-200 bg-white md:ml-64"><div className="flex items-center justify-between px-4 py-4 md:px-7"><Link href="/insurance" className="text-base font-bold text-teal-900 md:hidden">Learning Lantern Academy</Link><span className="hidden text-sm font-semibold text-slate-500 md:block">Insurance operations</span><Link href="/workspace" className="text-xs font-bold text-slate-600 md:hidden">Switch</Link></div></header>
      <div className="pb-16 md:ml-64 md:pb-0">{children}</div>
      <InsuranceNav mobile />
    </div>
  );
}
