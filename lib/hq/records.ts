import 'server-only';
import { hqDb } from './db';
import { type WorkspaceId, type BusinessUnit, type RecordType } from './workspaces';
export async function listRecords(workspace?: WorkspaceId,unit?: BusinessUnit,type?: RecordType) {
  try {
    let query=hqDb().from('hq_records').select('id,workspace_id,business_unit,record_type,title,body,status,related_contact_id,related_company_id,related_project_id,related_record_id,due_at,metadata,storage_path,created_at,updated_at').order('updated_at',{ascending:false}).limit(100);
    if(workspace)query=query.eq('workspace_id',workspace);
    if(unit)query=query.eq('business_unit',unit);
    if(type==='document')query=query.in('record_type',['document','proposal','rfp','contract','case','training']);
    else if(type==='contact')query=query.in('record_type',['contact','client']);
    else if(type)query=query.eq('record_type',type);
    const {data,error}=await query;
    if(error)throw error;
    return {data:data||[],error:null};
  } catch {return {data:[],error:'HQ records are unavailable. Configure the HQ database and apply migration 031.'};}
}
export interface SearchHit {id:string;title:string;detail:string;workspace:string;unit:string;type:string;href:string;}
export interface SearchResult {hits:SearchHit[];unavailable:string[];}
// Search values are passed to query-builder parameters, never an .or() filter.
export function searchPattern(input:string) {return '%'+input.trim().replace(/[\\%_]/g,c=>'\\'+c)+'%';}
export async function searchAll(input:string,kind?:string):Promise<SearchResult> {
  const q=input.trim();if(q.length<2||q.length>120)return {hits:[],unavailable:[]};
  const pattern=searchPattern(q),hits:SearchHit[]=[],unavailable:string[]=[];
  async function source(label:string,database:'crm'|'insurance',table:string,columns:string,field:string,map:(r:any)=>SearchHit,filter?:(query:any)=>any) {
    try {let query=hqDb(database).from(table).select(columns).ilike(field,pattern).limit(20);if(filter)query=filter(query);const {data,error}=await query;if(error)throw error;hits.push(...(data||[]).map(map));}catch{unavailable.push(label);}
  }
  const legacy=(r:any,type:string,workspace:string,href:string,title:string,detail:string):SearchHit=>({id:`${workspace==='full_stack'?'crm':'insurance'}:${type==='lead'&&workspace==='peter_quinn'?'prospect':type}:${r.id}`,title,detail,workspace,unit:r.business_unit||(workspace==='peter_quinn'?'insurance':'full_stack_core'),type,href});
  const central=(r:any)=>({id:r.id,title:r.title,detail:r.body.slice(0,160),workspace:r.workspace_id,unit:r.business_unit,type:r.record_type,href:`/hq/record/${r.id}?workspace=${r.workspace_id}`});
  const tasks:Promise<void>[]=[];
  for(const field of ['title','body','related_contact_id','related_company_id','related_project_id','related_record_id']) tasks.push(source('HQ '+field,'crm','hq_records','id,title,body,workspace_id,business_unit,record_type',field,central,query=>kind?query.eq('record_type',kind):query));
  if(!kind||kind==='contact'||kind==='lead') {
    for(const field of ['business_name','owner_name','email'])tasks.push(source('CRM leads','crm','leads','id,business_name,email,business_unit',field,r=>legacy(r,'lead','full_stack','/crm/leads',r.business_name,r.email||'')));
    for(const field of ['name','email','company'])tasks.push(source('Insurance prospects','insurance','insurance_prospects','id,name,email',field,r=>legacy(r,'lead','peter_quinn','/insurance',r.name,r.email||'')));
  }
  if(!kind||kind==='email') {
    for(const field of ['subject','message_body'])tasks.push(source('CRM communications','crm','outreach_log','id,subject,message_body,direction',field,r=>legacy(r,'email','full_stack','/crm/replies',r.subject||'Email',`${r.direction}: ${(r.message_body||'').slice(0,120)}`)));
    for(const field of ['subject','recipient','body_text'])tasks.push(source('Insurance outbox','insurance','insurance_email_outbox','id,subject,recipient',field,r=>legacy(r,'email','peter_quinn','/hq/peter-quinn/email',r.subject,r.recipient)));
  }
  if(!kind||kind==='email')tasks.push(source('Insurance replies','insurance','insurance_activities','id,summary,detail','detail->>body',r=>legacy(r,'email','peter_quinn','/insurance/activity',r.detail?.subject||r.summary,(r.detail?.body||'').slice(0,160)),query=>query.eq('kind','reply')));
  if(!kind||kind==='task')for(const database of ['crm','insurance'] as const)tasks.push(source(database+' tasks',database,database==='crm'?'follow_up_tasks':'insurance_tasks','id,task_type,notes','notes',r=>legacy(r,'task',database==='crm'?'full_stack':'peter_quinn',database==='crm'?'/crm/call-queue':'/insurance/tasks',r.task_type,r.notes||'')));
  if(!kind||kind==='activity')tasks.push(source('Insurance activity','insurance','insurance_activities','id,summary,kind','summary',r=>legacy(r,'activity','peter_quinn','/insurance/activity',r.summary,r.kind)));
  await Promise.all(tasks);
  // Expand matched people/companies to associated messages, tasks and activity.
  // Name searches must find a task even when its notes don't repeat the name.
  const matches=[...hits];
  const crmIds=matches.filter(r=>r.type==='lead'&&r.workspace==='full_stack').map(r=>r.id.split(':').pop()!);
  const insuranceIds=matches.filter(r=>r.type==='lead'&&r.workspace==='peter_quinn').map(r=>r.id.split(':').pop()!);
  const refs=[...new Set(matches.flatMap(r=>[r.id,r.id.split(':').pop()!]))];
  async function related(database:'crm'|'insurance',table:string,columns:string,field:string,ids:string[],map:(r:any)=>SearchHit) {
    if(!ids.length)return;
    try {const {data,error}=await hqDb(database).from(table).select(columns).in(field,ids).limit(30);if(error)throw error;hits.push(...(data||[]).map(map));}catch{unavailable.push(table);}
  }
  const associations:Promise<void>[]=[];
  if(!kind||kind==='email') {
    associations.push(related('crm','outreach_log','id,subject,direction,message_body','lead_id',crmIds,r=>legacy(r,'email','full_stack','/crm/replies',r.subject||'Email',(r.message_body||'').slice(0,160))));
    associations.push(related('insurance','insurance_email_outbox','id,subject,recipient','insurance_prospect_id',insuranceIds,r=>legacy(r,'email','peter_quinn','/hq/peter-quinn/email',r.subject,r.recipient)));
  }
  if(!kind||kind==='task') {
    associations.push(related('crm','follow_up_tasks','id,task_type,notes','lead_id',crmIds,r=>legacy(r,'task','full_stack','/crm/call-queue',r.task_type,r.notes||'')));
    associations.push(related('insurance','insurance_tasks','id,task_type,notes','prospect_id',insuranceIds,r=>legacy(r,'task','peter_quinn','/insurance/tasks',r.task_type,r.notes||'')));
  }
  if(!kind||kind==='activity') {
    associations.push(related('insurance','insurance_activities','id,summary,kind','prospect_id',insuranceIds,r=>legacy(r,'activity','peter_quinn','/insurance/activity',r.summary,r.kind)));
    associations.push(related('crm','lead_notes','id,note','lead_id',crmIds,r=>legacy(r,'activity','full_stack','/crm/leads','Lead note',r.note)));
    associations.push(related('crm','call_logs','id,outcome,notes','lead_id',crmIds,r=>legacy(r,'activity','full_stack','/crm/call-queue',r.outcome,r.notes||'')));
  }
  for(const field of ['related_contact_id','related_company_id','related_project_id','related_record_id'])associations.push(related('crm','hq_records','id,title,body,workspace_id,business_unit,record_type',field,refs,central));
  await Promise.all(associations);
  return {hits:[...new Map(hits.map(r=>[r.id,r])).values()].slice(0,100),unavailable:[...new Set(unavailable)]};
}

export async function legacyCollection(type:RecordType,workspace?:WorkspaceId,unit?:BusinessUnit) {
  const rows:SearchHit[]=[],unavailable:string[]=[];
  const add=async(database:'crm'|'insurance',table:string,columns:string,order:string,map:(r:any)=>SearchHit,filter?:(query:any)=>any)=>{
    try {let query=hqDb(database).from(table).select(columns).order(order,{ascending:false}).limit(30);if(unit==='hvac')query=query.eq('business_unit','hvac');if(filter)query=filter(query);const {data,error}=await query;if(error)throw error;rows.push(...(data||[]).map(map));}catch{unavailable.push(table);}
  };
  const full=workspace!=='peter_quinn', insurance=workspace!=='full_stack';
  const hit=(r:any,ws:string,title:string,detail:string,href:string):SearchHit=>({id:ws+':'+type+':'+r.id,title,detail,workspace:ws,unit:r.business_unit||(ws==='peter_quinn'?'insurance':'full_stack_core'),type,href});
  const jobs:Promise<void>[]=[];
  if(type==='email') {
    if(full)jobs.push(add('crm','outreach_log','id,subject,direction,message_body,business_unit','sent_at',r=>hit(r,'full_stack',r.subject||'Email',`${r.direction} · ${(r.message_body||'').slice(0,160)}`,'/crm/replies')));
    if(insurance)jobs.push(add('insurance','insurance_activities','id,summary,detail','created_at',r=>hit(r,'peter_quinn',r.detail?.subject||r.summary,(r.detail?.body||'').slice(0,160),'/insurance/activity'),q=>q.eq('kind','reply')));
    if(insurance)jobs.push(add('insurance','insurance_email_outbox','id,subject,recipient,status','created_at',r=>hit(r,'peter_quinn',r.subject,`${r.status} · ${r.recipient}`,'/insurance')));
  }
  if(type==='task') {
    if(full)jobs.push(add('crm','follow_up_tasks','id,task_type,status,due_at,business_unit','due_at',r=>hit(r,'full_stack',r.task_type,`${r.status} · ${r.due_at}`,'/crm/call-queue')));
    if(insurance)jobs.push(add('insurance','insurance_tasks','id,task_type,status,due_at','due_at',r=>hit(r,'peter_quinn',r.task_type,`${r.status} · ${r.due_at}`,'/insurance/tasks')));
  }
  if(type==='appointment'&&full)jobs.push(add('crm','appointments','id,meeting_date,meeting_time,notes,business_unit','created_at',r=>hit(r,'full_stack',r.meeting_date,`${r.meeting_time||''} ${r.notes||''}`,'/crm/bookings')));
  if(type==='contact') {
    if(full)jobs.push(add('crm','leads','id,business_name,email,business_unit','created_at',r=>hit(r,'full_stack',r.business_name,r.email||'','/crm/leads')));
    if(insurance)jobs.push(add('insurance','insurance_prospects','id,name,email','created_at',r=>hit(r,'peter_quinn',r.name,r.email||'','/insurance')));
  }
  await Promise.all(jobs);return {rows,unavailable};
}
