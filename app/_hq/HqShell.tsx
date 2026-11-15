'use client';
import { usePathname } from 'next/navigation';
import LegionShell from './LegionShell';
import StandaloneShell from './HqShell.standalone';
import type { ReactNode } from 'react';
const labels: Record<string,string> = {'leads':'Leads & pipeline','discovery':'Discovery & research','email-queue':'Email queue','replies':'Replies','call-queue':'Calls & follow-ups','bookings':'Meetings','tasks':'Tasks','documents':'Documents','projects':'Projects','proposals':'Proposals','automation':'Automation controls','dashboard':'Command center','unified-dashboard':'CRM dashboard','search':'Search workspace'};
export default function HqShell({children, embedded=false}:{children:ReactNode; embedded?:boolean}) {
 const path=usePathname()||'/hq';
 if(!embedded) return <StandaloneShell>{children}</StandaloneShell>;
 const segment=path.split('/').filter(Boolean).pop()||'HQ';
 return <LegionShell path={path} title={labels[segment]||segment.replace(/-/g,' ')}>{children}</LegionShell>;
}
