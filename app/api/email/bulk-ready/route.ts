import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "This legacy bulk status route is disabled." },
    { status: 410 }
  );
}
