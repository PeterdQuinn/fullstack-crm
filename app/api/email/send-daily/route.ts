import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "This legacy route is disabled. Use the selected lead Email tab or scheduled automation." },
    { status: 410 }
  );
}
