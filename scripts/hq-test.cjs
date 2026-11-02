const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,imports={}) {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(name==="server-only")return {};if(name in imports)return imports[name];throw Error('Unexpected import: '+name);},URL,Date,Map,Set,TextEncoder,crypto:require("node:crypto").webcrypto,atob,btoa,console,process});return exports;}
const model=load('lib/hq/model.ts');
const contexts=load('lib/hq/workspaces.ts');
for(const [ws,unit] of [['full_stack','full_stack_core'],['full_stack','hvac'],['peter_quinn','insurance']])assert.equal(contexts.validContext(ws,unit),true);
for(const [ws,unit] of [['full_stack','insurance'],['peter_quinn','hvac'],['peter_quinn','full_stack_core'],['unknown','hvac']])assert.equal(contexts.validContext(ws,unit),false);
const base={workspace_id:'full_stack',business_unit:'hvac',record_type:'document',title:'Client proposal',body:'Roof installation',owner_id:'spoofed-owner',storage_path:'stolen-file',related_contact_id:'crm:lead:123'};
const record=contexts.recordInput(base);assert.equal(record.owner_id,undefined);assert.equal(record.storage_path,undefined);assert.equal(record.related_contact_id,'crm:lead:123');
assert.throws(()=>contexts.recordInput({...base,workspace_id:'peter_quinn'}));assert.throws(()=>contexts.recordInput({...base,title:' '}));assert.throws(()=>contexts.recordInput({...base,record_type:'users'}));assert.throws(()=>contexts.recordInput({...base,due_at:'bad'}));assert.throws(()=>contexts.recordInput({...base,related_project_id:'x),id.eq.admin'}));
assert.equal(contexts.resolveSection('full-stack',['hvac','jobs']).unit,'hvac');assert.equal(contexts.resolveSection('peter-quinn',['cases']).unit,'insurance');
assert.equal(contexts.FULL_STACK.some(s=>s.label==='HVAC'),false);assert.equal(model.safeHttpsUrl('javascript:alert(1)'),null);assert.equal(model.safeHttpsUrl('https://github.com.evil.test/a','github.com'),null);assert.equal(model.safeHttpsUrl('https://user:secret@example.com'),null);
const items=[{id:'sale',urgency:50,revenueImpact:3,occurredAt:null},{id:'failure',urgency:100,revenueImpact:0,occurredAt:null},{id:'due',urgency:80,revenueImpact:1,occurredAt:null}];assert.equal(model.rankAttention(items)[0].id,'failure');assert.equal(items[0].id,'sale');assert.match(model.healthLabel({enabled:true,health_status:'healthy',health_checked_at:'2000-01-01'}),/Unknown/);
(async()=>{
 const originalEnv={APP_USERNAME:process.env.APP_USERNAME,APP_PASSWORD:process.env.APP_PASSWORD,SESSION_SECRET:process.env.SESSION_SECRET};
 process.env.APP_USERNAME='test-owner';process.env.APP_PASSWORD='test-password';process.env.SESSION_SECRET='test-session-signing-secret';
 const session=load('lib/session.ts');
 const token=await session.createSessionToken('test-owner');assert.equal(await session.verifySessionToken(token),true);assert.equal(await session.verifySessionToken(token+'tampered'),false);
 const next=()=>({status:200,cookies:{set:()=>{}}});
 const NextResponse=class{constructor(body,options){this.body=body;Object.assign(this,options);}static next(){return next();}};
 const middleware=load('middleware.ts',{'next/server':{NextResponse},'@/lib/session':session});
 const requestFor=(path,cookie,authorization)=>({nextUrl:{pathname:path,searchParams:new URLSearchParams()},cookies:{get:name=>name===session.SESSION_COOKIE&&cookie?{value:cookie}:undefined},headers:{get:name=>name==='authorization'?authorization:null}});
 for(const path of ['/hq','/api/hq/records','/crm/leads','/insurance']){
   assert.equal((await middleware.middleware(requestFor(path))).status,401,'Anonymous private access must fail');
   assert.equal((await middleware.middleware(requestFor(path,token))).status,200,'Existing signed sessions must still work');
   assert.equal((await middleware.middleware(requestFor(path,null,'Basic '+btoa('test-owner:test-password')))).status,200,'Legacy Basic auth must still work');
 }
 assert.ok(middleware.config.matcher.includes('/hq/:path*'));assert.ok(middleware.config.matcher.includes('/api/hq/:path*'));
 for(const [key,value] of Object.entries(originalEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
 let owner={username:'peter',role:'owner'},saved;
 const db={from:()=>({insert:value=>{saved=value;return {select:()=>({single:async()=>({data:{id:'new-id'},error:null})})};}})};
 const route=load('app/api/hq/records/route.ts',{'next/server':{NextResponse:{json:(body,{status=200}={})=>({body,status})}},'@/lib/hq/auth':{hqOwner:async()=>owner},'@/lib/hq/db':{hqDb:()=>db},'@/lib/hq/records':{listRecords:async()=>({data:[],error:null})},'@/lib/hq/workspaces':contexts});
 const request=(body,origin='https://hq.test')=>({nextUrl:{origin:'https://hq.test'},headers:{get:key=>key==='origin'?origin:null},json:async()=>body});
 assert.equal((await route.POST(request(base))).status,201);assert.equal(saved.owner_id,'peter');assert.equal(saved.storage_path,undefined);
 assert.equal((await route.POST(request(base,'https://attacker.test'))).status,403);
 assert.equal((await route.POST(request({...base,workspace_id:'peter_quinn'}))).status,400);
 owner=null;assert.equal((await route.POST(request(base))).status,401);
 const calls=[];
 function query(table){const state={table};const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>{calls.push(state);const data=table==='leads'&&state.field==='business_name'?[{id:'111',business_name:'Acme',email:'a@test.example',business_unit:'hvac'}]:table==='follow_up_tasks'&&state.inField==='lead_id'?[{id:'task1',task_type:'call',notes:'No company name here'}]:[];return Promise.resolve({data,error:null}).then(resolve);}:(...args)=>{if(key==='ilike'){state.field=args[0];state.pattern=args[1];}if(key==='in'){state.inField=args[0];state.ids=args[1];}return q;}});return q;}
 const reads=load('lib/hq/records.ts',{'./db':{hqDb:()=>({from:query})}});
 assert.equal(reads.searchPattern('a%_b'),'%'+'a\\%\\_b'+'%');
 const result=await reads.searchAll('Acme');assert.ok(result.hits.some(r=>r.type==='task'&&r.title==='call'),'Name search must expand to associated tasks without the name in notes');assert.ok(result.hits.some(r=>r.type==='lead'&&r.unit==='hvac'));assert.ok(calls.some(c=>c.inField==='lead_id'&&c.ids.includes('111')));
 const failureReads=load('lib/hq/records.ts',{'./db':{hqDb:()=>{throw Error('offline');}}});const failed=await failureReads.searchAll('Acme');assert.ok(failed.unavailable.length>0);assert.equal(failed.hits.length,0);
 console.log('PASS HQ workspace isolation, native record ownership, CSRF/auth, safe links, priority ranking, stale health, and cross-source association search');
})().catch(e=>{console.error(e);process.exitCode=1;});
