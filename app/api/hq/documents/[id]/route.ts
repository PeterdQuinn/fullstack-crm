import { NextRequest,NextResponse } from 'next/server';
import { hqOwner } from '@/lib/hq/auth';
import { hqDb } from '@/lib/hq/db';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:{id:string}}) {
  if(!await hqOwner())return NextResponse.json({error:'Unauthorized'},{status:401});
  if(!/^[a-f0-9-]{36}$/i.test(params.id))return NextResponse.json({error:'Not found'},{status:404});
  try {const db=hqDb();const {data,error}=await db.from('hq_records').select('storage_path,metadata,workspace_id,business_unit').eq('id',params.id).eq('record_type','document').single();
    if(error||!data?.storage_path)return NextResponse.json({error:'Not found'},{status:404});
    if(!data.storage_path.startsWith(`${data.workspace_id}/${data.business_unit}/`))return NextResponse.json({error:'Invalid document context'},{status:409});
    const signed=await db.storage.from('hq-documents').createSignedUrl(data.storage_path,60,{download:data.metadata?.filename||'document'});if(signed.error||!signed.data)throw signed.error;
    const response=NextResponse.redirect(signed.data.signedUrl);response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
  }catch{return NextResponse.json({error:'Document unavailable'},{status:503});}
}
