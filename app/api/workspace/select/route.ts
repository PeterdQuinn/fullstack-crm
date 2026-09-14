import { NextRequest, NextResponse } from "next/server";
import {
  createWorkspaceToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifySessionToken,
  WORKSPACE_COOKIE,
  type Workspace,
} from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!(await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const workspace = body.workspace as Workspace;
  if (workspace !== "fss" && workspace !== "producerforge") {
    return NextResponse.json({ error: "Unknown workspace." }, { status: 400 });
  }
  const response = NextResponse.json({ ok: true, workspace });
  response.cookies.set({
    name: WORKSPACE_COOKIE,
    value: await createWorkspaceToken(workspace),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
