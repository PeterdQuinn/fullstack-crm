import { headers } from 'next/headers';
import HqShell from '@/app/_hq/HqShell';
import CrmNav from './_components/CrmNav';
export default function CRMLayout({children}:{children:React.ReactNode}) {
  return <HqShell embedded={headers().get('x-legion-embedded')==='1'}><CrmNav embedded={headers().get('x-legion-embedded')==='1'} />{children}</HqShell>;
}
