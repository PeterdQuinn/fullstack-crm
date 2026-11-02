export type WorkspaceId = 'full_stack' | 'peter_quinn';
export type BusinessUnit = 'full_stack_core' | 'hvac' | 'insurance';
export const RECORD_TYPES = ['contact','client','email','campaign','proposal','rfp','document','contract','project','task','activity','invoice','appointment','opportunity','note','case','carrier_note','training','job','dispatch'] as const;
export type RecordType = typeof RECORD_TYPES[number];
export function validContext(workspace: unknown, unit: unknown): workspace is WorkspaceId {
  return workspace === 'full_stack' ? unit === 'full_stack_core' || unit === 'hvac' : workspace === 'peter_quinn' && unit === 'insurance';
}
export type Section = { slug: string; label: string; type?: RecordType; href?: string; description?: string };
export const FULL_STACK: Section[] = [
  {slug:'dashboard',label:'Dashboard'}, {slug:'leads',label:'Leads',href:'/crm/leads'},
  {slug:'clients',label:'Clients',type:'client'}, {slug:'pipeline',label:'Sales Pipeline',type:'opportunity'},
  {slug:'email',label:'Email',href:'/crm/email-queue'}, {slug:'campaigns',label:'Ads / Campaigns',type:'campaign'},
  {slug:'outreach',label:'Outreach',href:'/crm/call-queue'}, {slug:'proposals',label:'Proposals',type:'proposal'},
  {slug:'rfps',label:'RFPs / Bids',type:'rfp'}, {slug:'projects',label:'Projects',type:'project'},
  {slug:'documents',label:'Documents',type:'document'}, {slug:'contracts',label:'Contracts',type:'contract'},
  {slug:'revenue',label:'Invoices / Revenue',type:'invoice'}, {slug:'tasks',label:'Tasks',type:'task'},
  {slug:'notes',label:'Notes',type:'note'}, {slug:'website',label:'Website / Client Portal'},
];
export const INSURANCE: Section[] = [
  {slug:'dashboard',label:'Dashboard'}, {slug:'leads',label:'Insurance Leads',href:'/insurance/discover'},
  {slug:'prospects',label:'Prospects',href:'/insurance'}, {slug:'pipeline',label:'Insurance Pipeline',href:'/insurance/pipeline'},
  {slug:'email',label:'Email / Outreach',type:'email'}, {slug:'tasks',label:'Tasks',href:'/insurance/tasks'},
  {slug:'activities',label:'Activities',href:'/insurance/activity'}, {slug:'appointments',label:'Appointments',type:'appointment'},
  {slug:'cases',label:'Policies / Cases',type:'case'}, {slug:'carrier-notes',label:'Carrier Notes',type:'carrier_note'},
  {slug:'documents',label:'Documents',type:'document'}, {slug:'proposals',label:'Proposals / Illustrations',type:'proposal'},
  {slug:'marketing',label:'Marketing',type:'campaign'}, {slug:'website',label:'Website / Funnel'},
  {slug:'training',label:'Compliance / Training',type:'training'},
];
export const HVAC: Section[] = [
  {slug:'leads',label:'HVAC Leads',href:'/crm/leads?business_unit=hvac'}, {slug:'customers',label:'Customers',type:'client'},
  {slug:'demo',label:'Demo / App'}, {slug:'dispatch',label:'Dispatch',type:'dispatch'},
  {slug:'jobs',label:'Jobs',type:'job'}, {slug:'scheduling',label:'Scheduling',type:'appointment'},
  {slug:'invoices',label:'Invoices',type:'invoice'}, {slug:'technicians',label:'Technician activity',type:'activity'},
  {slug:'sales',label:'Sales / Outreach',type:'opportunity'}, {slug:'documents',label:'HVAC Documents',type:'document'},
];
export const SHARED: Section[] = [
  {slug:'inbox',label:'Unified Inbox',type:'email'}, {slug:'calendar',label:'Calendar',type:'appointment'},
  {slug:'documents',label:'Documents',type:'document'}, {slug:'tasks',label:'Tasks',type:'task'},
  {slug:'contacts',label:'Contacts',type:'contact'}, {slug:'search',label:'Global Search'},
  {slug:'ai',label:'AI Assistant'}, {slug:'notifications',label:'Notifications'},
];
export const ADMIN: Section[] = ['Users','Permissions','Integrations','Systems','Deployments','Settings'].map(label=>({slug:label.toLowerCase(),label}));
export function resolveSection(area: string, parts: string[]) {
  const workspace: WorkspaceId = area === 'peter-quinn' ? 'peter_quinn' : 'full_stack';
  const hvac = area === 'full-stack' && parts[0] === 'hvac';
  const list = area === 'shared' ? SHARED : area === 'admin' ? ADMIN : hvac ? HVAC : area === 'peter-quinn' ? INSURANCE : FULL_STACK;
  const slug = parts[hvac ? 1 : 0] || (hvac ? 'leads' : area === 'shared' ? 'search' : area === 'admin' ? 'systems' : 'dashboard');
  return {workspace, unit:(hvac ? 'hvac' : workspace === 'peter_quinn' ? 'insurance' : 'full_stack_core') as BusinessUnit, section:list.find(s=>s.slug===slug), hvac};
}
export function recordInput(value: Record<string, unknown>) {
  if (!validContext(value.workspace_id,value.business_unit)) throw new Error('Choose a valid workspace and business unit');
  if (!RECORD_TYPES.includes(value.record_type as RecordType)) throw new Error('Unknown record type');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length>300) throw new Error('Title must contain 1–300 characters');
  if (typeof value.body !== 'string' || value.body.length>50000) throw new Error('Content must be at most 50,000 characters');
  const result: Record<string, unknown> = {workspace_id:value.workspace_id,business_unit:value.business_unit,record_type:value.record_type,title:value.title.trim(),body:value.body};
  for(const key of ['related_contact_id','related_company_id','related_project_id','related_record_id']) {
    if(value[key] != null && value[key] !== '') {
      if(typeof value[key] !== 'string' || (value[key] as string).length>200 || !/^[\w:.-]+$/.test(value[key] as string)) throw new Error('Invalid related record reference');
      result[key]=value[key];
    }
  }
  if(value.due_at) { if(typeof value.due_at !== 'string' || !Number.isFinite(Date.parse(value.due_at))) throw new Error('Invalid due date'); result.due_at=new Date(value.due_at).toISOString(); }
  const metadata: Record<string,string> = {};
  for(const key of ['document_kind','sender','recipient','direction','subject']) {
    const input=value[key];
    if(input != null && input !== '') {if(typeof input !== 'string' || input.length>500) throw new Error('Invalid message or document details');metadata[key]=input;}
  }
  if(metadata.direction && !['inbound','outbound','internal'].includes(metadata.direction)) throw new Error('Invalid message direction');
  result.metadata=metadata;
  return result;
}
