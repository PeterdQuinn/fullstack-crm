import { NextRequest,NextResponse } from 'next/server';
import { hqOwner } from '@/lib/hq/auth';
import { searchAll } from '@/lib/hq/records';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
  if(!await hqOwner())return NextResponse.json({error:'Unauthorized'},{status:401});
  const q=req.nextUrl.searchParams.get('q')||'';
  if(q.trim().length<2||q.length>120)return NextResponse.json({error:'Search needs 2–120 characters'},{status:400});
  return NextResponse.json(await searchAll(q));
}
