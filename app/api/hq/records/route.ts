import { NextRequest,NextResponse } from 'next/server';
import { hqOwner } from '@/lib/hq/auth';
import { hqDb } from '@/lib/hq/db';
import { listRecords } from '@/lib/hq/records';
import { recordInput,validContext,RECORD_TYPES,type WorkspaceId,type BusinessUnit,type RecordType } from '@/lib/hq/workspaces';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
  if(!await hqOwner())return NextResponse.json({error:'Unauthorized'},{status:401});
  const workspace=req.nextUrl.searchParams.get('workspace'),unit=req.nextUrl.searchParams.get('unit'),type=req.nextUrl.searchParams.get('type');
  if((workspace&&!['full_stack','peter_quinn'].includes(workspace))||(unit&&!validContext(workspace,unit))||(type&&!RECORD_TYPES.includes(type as RecordType)))return NextResponse.json({error:'Invalid context'},{status:400});
  const result=await listRecords(workspace as WorkspaceId|undefined,unit as BusinessUnit|undefined,type as RecordType|undefined);
  return NextResponse.json(result,{status:result.error?503:200});
}
export async function POST(req:NextRequest) {
  const owner=await hqOwner();if(!owner)return NextResponse.json({error:'Unauthorized'},{status:401});
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Same-origin request required'},{status:403});
  let record;
  try {record=recordInput(await req.json());}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid record'},{status:400});}
  try {const {data,error}=await hqDb().from('hq_records').insert({...record,owner_id:owner.username}).select('id').single();if(error)throw error;return NextResponse.json({id:data.id},{status:201});}
  catch{return NextResponse.json({error:'Could not save record. Verify the HQ connection and migration 031.'},{status:503});}
}
export async function PATCH(req:NextRequest) {
  if(!await hqOwner())return NextResponse.json({error:'Unauthorized'},{status:401});
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Same-origin request required'},{status:403});
  const body=await req.json().catch(()=>null);
  if(!body||!/^[a-f0-9-]{36}$/i.test(body.id)||!['open','in_progress','completed','cancelled'].includes(body.status))return NextResponse.json({error:'Invalid record or status'},{status:400});
  try {const {data,error}=await hqDb().from('hq_records').update({status:body.status,updated_at:new Date().toISOString()}).eq('id',body.id).select('id').maybeSingle();if(error)throw error;if(!data)return NextResponse.json({error:'Not found'},{status:404});return NextResponse.json({success:true});}
  catch{return NextResponse.json({error:'Record update failed'},{status:503});}
}
