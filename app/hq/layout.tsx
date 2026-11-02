import { redirect } from 'next/navigation';
import { hqOwner } from '@/lib/hq/auth';
import HqShell from '@/app/_hq/HqShell';
export const dynamic='force-dynamic';
export default async function HqLayout({children}:{children:React.ReactNode}) {
  if(!await hqOwner()) redirect('/login');
  return <HqShell>{children}</HqShell>;
}
