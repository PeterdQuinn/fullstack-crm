import { redirect } from "next/navigation";

// The CRM dashboard is the single front door. Everything lives under /crm now.
export default function RootIndex() {
  redirect("/crm/unified-dashboard");
}
