import HqShell from '@/app/_hq/HqShell';
import CrmNav from './_components/CrmNav';
export default function CRMLayout({children}:{children:React.ReactNode}) {
  return <HqShell><CrmNav />{children}</HqShell>;
}
