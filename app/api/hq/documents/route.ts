import { randomUUID } from 'node:crypto';
import { NextRequest,NextResponse } from 'next/server';
import { hqOwner } from '@/lib/hq/auth';
import { hqDb } from '@/lib/hq/db';
import { recordInput } from '@/lib/hq/workspaces';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest) {
  const owner=await hqOwner();if(!owner)return NextResponse.json({error:'Unauthorized'},{status:401});
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Same-origin request required'},{status:403});
  if(Number(req.headers.get('content-length')||0)>5*1024*1024)return NextResponse.json({error:'File exceeds 4 MB'},{status:413});
  let record;let file:File;
  try {const form=await req.formData();file=form.get('file') as File;if(!file||typeof file.arrayBuffer!=='function'||file.size>4*1024*1024||file.size===0)throw new Error('Choose a file of 1 byte to 4 MB');
    const allowed=['application/pdf','text/plain','text/csv','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if(!allowed.includes(file.type))throw new Error('Supported files: PDF, text, CSV, PNG, JPEG, Word and Excel');
    record=recordInput({workspace_id:form.get('workspace_id'),business_unit:form.get('business_unit'),record_type:'document',title:form.get('title')||file.name,body:form.get('body')||'',document_kind:form.get('document_kind')||'document',related_contact_id:form.get('related_contact_id')||null,related_project_id:form.get('related_project_id')||null});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid document'},{status:400});}
  const path=`${record.workspace_id}/${record.business_unit}/${randomUUID()}`;
  try {const db=hqDb(),bucket=db.storage.from('hq-documents');const bytes=await file.arrayBuffer();
    const uploaded=await bucket.upload(path,bytes,{contentType:'application/octet-stream',upsert:false});if(uploaded.error)throw uploaded.error;
    const {data,error}=await db.from('hq_records').insert({...record,owner_id:owner.username,storage_path:path,metadata:{...(record.metadata as object),filename:file.name,mime_type:file.type,size:file.size}}).select('id').single();
    if(error){await bucket.remove([path]);throw error;}return NextResponse.json({id:data.id},{status:201});
  }catch{return NextResponse.json({error:'Document upload failed. Check migration 031 and the private document bucket.'},{status:503});}
}
