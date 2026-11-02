import HqShell from '@/app/_hq/HqShell';
import { InsuranceNav } from './insurance-nav';
export default function InsuranceLayout({children}:{children:React.ReactNode}) {
  return <HqShell><div className="border-b bg-white px-4 py-3"><p className="mb-2 text-sm font-semibold text-teal-900">Peter Quinn / Insurance · Operations</p><InsuranceNav /></div>{children}</HqShell>;
}
