import 'server-only';
import { hqDb } from './db';
import { rankAttention, type AttentionItem, type ManagedApp } from './model';

export interface ReadResult<T> { state: 'connected' | 'unavailable'; data: T; message: string | null }
type Row = Record<string, any>;
async function readRows(table: string, columns: string, query: (q: any) => any, source: 'crm' | 'insurance' = 'crm'): Promise<ReadResult<Row[]>> {
  try {
    const { data, error } = await query(hqDb(source).from(table).select(columns));
    if (error) throw error;
    return { state: 'connected', data: data || [], message: null };
  } catch {
    return { state: 'unavailable', data: [], message: `${source === 'crm' ? 'HQ' : 'Insurance'} ${table.replaceAll('_', ' ')} unavailable. Check the connection and migrations.` };
  }
}

export async function getSystemHealth(): Promise<ReadResult<ManagedApp[]>> {
  const result = await readRows('managed_apps', 'id,name,slug,description,application_type,production_url,github_repo,vercel_project,status,enabled,health_status,health_checked_at,last_deployment_at,metadata,updated_at', q => q.order('name').limit(100));
  return { ...result, data: result.data as ManagedApp[], message: result.state === 'unavailable' ? 'Systems registry unavailable. Configure the HQ database and apply migration 030.' : null };
}
export function getLeads() {
  return readRows('leads', 'id,business_name,status,next_follow_up_at', q => q.is('archived_at', null).eq('opt_out', false).eq('bounced', false).eq('complained', false)
    .not('next_follow_up_at', 'is', null).lte('next_follow_up_at', new Date().toISOString()).not('status', 'in', '(Won,Lost,Dead,"Do Not Contact","No Response")').order('next_follow_up_at').limit(20));
}
export function getDeals() {
  return readRows('leads', 'id,business_name,status,updated_at', q => q.is('archived_at', null).eq('opt_out', false).in('status', ['Interested', 'Booking Link Sent', 'Booked', 'Onboarding Sent', 'Onboarding Completed']).order('updated_at', { ascending: false }).limit(20));
}
export function getTasks(source: 'crm' | 'insurance' = 'crm') {
  return readRows(source === 'crm' ? 'follow_up_tasks' : 'insurance_tasks', 'id,task_type,due_at,status', q => q.eq('status', 'pending').lte('due_at', new Date().toISOString()).order('due_at').limit(20), source);
}
export function getRecentActivity() {
  // Pipeline runs, including insurance, are logged to FSS by withAutomationRun.
  return readRows('automation_runs', 'id,stage,status,started_at,finished_at', q => q.order('started_at', { ascending: false }).limit(12));
}
export function getAlerts() {
  return readRows('automation_runs', 'id,stage,status,started_at', q => q.eq('status', 'failed').gte('started_at', new Date(Date.now() - 86400000).toISOString()).order('started_at', { ascending: false }).limit(20));
}
export async function getInsurancePipeline() {
  const [activity, tasks, runs, settings, outbox] = await Promise.all([
    readRows('insurance_activities', 'id,kind,summary,created_at', q => q.order('created_at', { ascending: false }).limit(8), 'insurance'),
    getTasks('insurance'),
    readRows('automation_runs', 'id,stage,status,started_at,finished_at', q => q.eq('stage', 'insurance-pipeline').order('started_at', { ascending: false }).limit(1)),
    readRows('insurance_settings', 'enabled,sending_enabled', q => q.eq('id', 'owner').limit(1), 'insurance'),
    readRows('insurance_email_outbox', 'id,status,send_limit,created_at', q => q.order('created_at', { ascending: false }).limit(5), 'insurance'),
  ]);
  return { activity, tasks, runs, settings, outbox };
}
export function getHVACActivity() { return readRows('hq_records','id,title,record_type,status,updated_at',q=>q.eq('workspace_id','full_stack').eq('business_unit','hvac').order('updated_at',{ascending:false}).limit(10)); }
export function getProjects() { return readRows('hq_records','id,title,workspace_id,business_unit,status,updated_at',q=>q.eq('record_type','project').eq('status','open').order('updated_at',{ascending:false}).limit(20)); }
export const getRevenueOpportunities = getDeals;

export async function getCommandCenter(workspace?: 'full_stack' | 'peter_quinn') {
  const [leads, deals, tasks, activity, alerts, insurance, systems, hvac, projects] = await Promise.all([
    getLeads(), getDeals(), getTasks(), getRecentActivity(), getAlerts(), getInsurancePipeline(), getSystemHealth(), getHVACActivity(), getProjects(),
  ]);
  const nativeTasks = await readRows('hq_records','id,title,workspace_id,due_at',q=>q.eq('record_type','task').in('status',['open','in_progress']).lte('due_at',new Date().toISOString()).order('due_at').limit(20));
  const items: AttentionItem[] = [
    ...nativeTasks.data.map(r=>({id:`hq-task:${r.id}`,title:r.title,detail:`${r.workspace_id} · Task due`,href:`/hq/record/${r.id}?workspace=${r.workspace_id}`,urgency:80,revenueImpact:1,occurredAt:r.due_at})),
    ...alerts.data.map(r => ({ id: `alert:${r.id}`, title: `${r.stage} needs attention`, detail: 'Failed automation in the last 24 hours', href: '/crm/automation', urgency: 100, revenueImpact: 0, occurredAt: r.started_at })),
    ...leads.data.map(r => ({ id: `lead:${r.id}`, title: r.business_name || 'Follow up with lead', detail: `Follow-up due · ${r.status}`, href: '/crm/call-queue', urgency: 80, revenueImpact: 1, occurredAt: r.next_follow_up_at })),
    ...tasks.data.map(r => ({ id: `task:${r.id}`, title: r.task_type.replaceAll('_', ' '), detail: 'CRM task due', href: '/crm/call-queue', urgency: 70, revenueImpact: 1, occurredAt: r.due_at })),
    ...insurance.tasks.data.map(r => ({ id: `insurance:${r.id}`, title: r.task_type.replaceAll('_', ' '), detail: 'Insurance task due', href: '/insurance/tasks', urgency: 70, revenueImpact: 1, occurredAt: r.due_at })),
    ...deals.data.map(r => ({ id: `deal:${r.id}`, title: r.business_name || 'Revenue opportunity', detail: r.status, href: '/crm/bookings', urgency: 50, revenueImpact: ['Onboarding Sent', 'Onboarding Completed'].includes(r.status) ? 3 : r.status === 'Booked' ? 2 : 1, occurredAt: r.updated_at })),
  ];
  return { generatedAt: new Date().toISOString(), priorities: rankAttention(workspace ? items.filter(r=>workspace==='peter_quinn' ? r.href.includes('/insurance') || r.href.includes('workspace=peter_quinn') : !r.href.includes('/insurance') && !r.href.includes('workspace=peter_quinn')) : items).slice(0, 8), leads, deals, tasks, activity, alerts, insurance, systems, hvac, projects, nativeTasks };
}

// This catalog is read-only. It is not a model-executable action endpoint.
// Future action tools need independent permission checks, previews, approval
// records, idempotency keys and an audit trail before they can be registered.
export const HQ_READ_TOOLS = { getLeads, getDeals, getInsurancePipeline, getHVACActivity, getTasks, getProjects, getSystemHealth, getRecentActivity, getRevenueOpportunities };
