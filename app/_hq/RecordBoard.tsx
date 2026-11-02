'use client';
import { useState,type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { WorkspaceId,BusinessUnit,RecordType } from '@/lib/hq/workspaces';
import type { SearchHit } from '@/lib/hq/records';
const field='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export default function RecordBoard({title,type,workspace,unit,rows,error,legacy}:{title:string;type:RecordType;workspace?:WorkspaceId;unit?:BusinessUnit;rows:any[];error:string|null;legacy:{rows:SearchHit[];unavailable:string[]}}) {
  const router=useRouter();const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [chosen,setChosen]=useState<WorkspaceId>(workspace||'full_stack');
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;setBusy(true);setMessage('');
    try {const data=new FormData(form);const file=data.get('file') as File|null;const due=data.get('due_at');if(typeof due==='string'&&due)data.set('due_at',new Date(due).toISOString());let response:Response;
      if(type==='document'&&file?.size)response=await fetch('/api/hq/documents',{method:'POST',body:data});
      else response=await fetch('/api/hq/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...Object.fromEntries(data.entries()),record_type:type})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save');form.reset();setMessage('Saved.');router.refresh();
    }catch(e){setMessage(e instanceof Error?e.message:'Could not save');}finally{setBusy(false);}
  }
  return <div className="space-y-6">
    {error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
    <section className="rounded-xl border bg-white p-5"><h2 className="font-bold">Add {title.toLowerCase()} record</h2>
      <p className="mt-1 text-xs text-slate-500">Saved in HQ with explicit ownership and associations.{type==='email'?' This records correspondence; it does not send an email.':''}</p>
      <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">Workspace{workspace?<><input type="hidden" name="workspace_id" value={workspace}/><p className="mt-2">{workspace==='full_stack'?'Full Stack Services':'Peter Quinn / Insurance'}</p></>:<select name="workspace_id" value={chosen} onChange={e=>setChosen(e.target.value as WorkspaceId)} className={field}><option value="full_stack">Full Stack Services</option><option value="peter_quinn">Peter Quinn / Insurance</option></select>}</label>
        <label className="text-xs font-semibold">Business unit{unit?<><input type="hidden" name="business_unit" value={unit}/><p className="mt-2">{unit.replaceAll('_',' ')}</p></>:<select key={chosen} name="business_unit" className={field}>{chosen==='full_stack'?<><option value="full_stack_core">Full Stack core</option><option value="hvac">HVAC</option></>:<option value="insurance">Insurance</option>}</select>}</label>
        <label className="text-xs font-semibold sm:col-span-2">Title<input name="title" required maxLength={300} className={field}/></label>
        <label className="text-xs font-semibold sm:col-span-2">Content / searchable notes<textarea name="body" maxLength={50000} rows={3} className={field}/></label>
        <label className="text-xs font-semibold">Contact reference<input name="related_contact_id" placeholder="crm:lead:uuid or insurance:prospect:uuid" className={field}/></label>
        <label className="text-xs font-semibold">Company reference<input name="related_company_id" placeholder="Company record ID" className={field}/></label>
        <label className="text-xs font-semibold">Project reference<input name="related_project_id" placeholder="Project record ID" className={field}/></label>
        <label className="text-xs font-semibold">Related opportunity / proposal<input name="related_record_id" placeholder="Related record ID" className={field}/></label>
        <label className="text-xs font-semibold">Due / appointment time<input name="due_at" type="datetime-local" className={field}/></label>
        {type==='email'&&<><label className="text-xs font-semibold">Direction<select name="direction" className={field}><option value="inbound">Inbound</option><option value="outbound">Outbound</option><option value="internal">Internal</option></select></label><label className="text-xs font-semibold">Sender<input name="sender" type="email" className={field}/></label><label className="text-xs font-semibold">Recipient<input name="recipient" type="email" className={field}/></label><label className="text-xs font-semibold">Subject<input name="subject" className={field}/></label></>}
        {type==='document'&&<><label className="text-xs font-semibold">Document kind<select name="document_kind" className={field}>{['document','proposal','rfp','contract','client_file','insurance_case','marketing','operating_note','internal_plan'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><label className="text-xs font-semibold">File (optional, up to 4 MB)<input name="file" type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.docx,.xlsx" className={field}/></label></>}
        <div className="flex items-center gap-3 sm:col-span-2"><button disabled={busy||!!error} className="rounded-lg bg-teal-900 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy?'Saving…':'Save record'}</button><p role="status" className="text-sm">{message}</p></div>
      </form>
    </section>
    <section className="rounded-xl border bg-white p-5"><h2 className="font-bold">HQ records <span className="text-sm font-normal text-slate-400">Latest 100</span></h2>
      {!rows.length&&!error&&<p className="mt-4 text-sm text-slate-500">No {title.toLowerCase()} records yet. Existing archives have not been imported.</p>}
      <div className="mt-3 divide-y">{rows.map(r=><article key={r.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/hq/record/${r.id}?workspace=${r.workspace_id}`} className="font-semibold text-teal-900 hover:underline">{r.title}</Link><span className="text-xs text-slate-500">{r.workspace_id==='full_stack'?'Full Stack':'Peter Quinn'} · {r.business_unit} · {r.status}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{r.body.slice(0,600)}</p>{r.due_at&&<p className="mt-2 text-xs text-slate-500">Due: {new Date(r.due_at).toLocaleString()}</p>}{r.storage_path&&<a href={`/api/hq/documents/${r.id}`} className="mt-2 inline-block text-sm font-semibold text-teal-800 underline">Download private file</a>}</article>)}</div>
    </section>
    {(legacy.rows.length>0||legacy.unavailable.length>0)&&<section className="rounded-xl border bg-white p-5"><h2 className="font-bold">Existing operational records <span className="text-sm font-normal text-slate-400">Latest 30 per source</span></h2><p className="mt-2 text-xs text-slate-500">Read from the existing pipelines; no copies are created.</p>{legacy.unavailable.length>0&&<p className="mt-3 text-sm text-amber-800">Unavailable sources: {legacy.unavailable.join(', ')}</p>}<div className="divide-y">{legacy.rows.map(r=><Link key={r.id} href={r.href} className="block py-4"><span className="text-sm font-semibold text-teal-900">{r.title}</span><p className="mt-1 text-xs text-slate-500">{r.workspace} · {r.unit} · {r.detail}</p></Link>)}</div></section>}
  </div>;
}
