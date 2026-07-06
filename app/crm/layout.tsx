import CrmNav from "./_components/CrmNav";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <CrmNav />
      {/* Offset content: left sidebar on desktop, bottom tab bar on mobile
          (pb-16 = the ~64px mobile bar so nothing hides behind it). */}
      <div className="pb-16 md:pb-0 md:pl-60">{children}</div>
    </div>
  );
}
