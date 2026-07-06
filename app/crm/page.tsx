import { redirect } from "next/navigation";

// The CRM home is the redesigned dashboard. Keep /crm as a stable entry point.
export default function CRMIndex() {
  redirect("/crm/unified-dashboard");
}
