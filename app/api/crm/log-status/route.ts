import { NextRequest, NextResponse } from "next/server";
import { logStatusChange, type AuditSource } from "@/lib/audit";

// Records a lead status change in status_audit_log. Used by the leads UI, whose
// browser (anon) client is blocked by RLS from writing the audit table directly.
// Sits behind the CRM's Basic Auth (see middleware), so callers are the owner.
export async function POST(req: NextRequest) {
  try {
    const { leadId, from, to, field, source } = await req.json();

    if (!leadId || !to) {
      return NextResponse.json({ error: "leadId and to are required" }, { status: 400 });
    }

    // Default to "owner" (this route is only reachable through the authed UI);
    // only accept the two known sources.
    const src: AuditSource = source === "automation" ? "automation" : "owner";

    await logStatusChange({ leadId, from: from ?? null, to, field: field || "status", source: src });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("log-status error:", error);
    return NextResponse.json({ error: "Failed to log status" }, { status: 500 });
  }
}
