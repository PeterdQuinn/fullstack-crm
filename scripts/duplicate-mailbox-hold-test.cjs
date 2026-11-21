const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const ts=require('typescript');
const root='lib/';
function load(file,imports){
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(root+file+'.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,require:name=>{if(!Object.hasOwn(imports,name))throw Error(name);return imports[name]},process:{env:{RESEND_API_KEY:'fake'}},console:{log(){},error(){},warn(){}},setTimeout,clearTimeout});
  return exports;
}
const identity=load('outreach-identity',{});
const {DuplicateMailboxHoldError,DUPLICATE_MAILBOX_HOLD}=identity;
async function main(){
  let saved;
  let providerCalls=0;
  const recipient='same@example.invalid';
  const peer=[{id:'one',email:recipient,tenant_id:'tenant'},{id:'two',email:recipient.toUpperCase(),tenant_id:'tenant'}];
  const db={from(table){
    let columns='';
    const q={select(c){columns=c;return q},eq:()=>q,ilike:()=>q,in:()=>q,
      limit:async()=>({data:table==='leads'?peer:[],error:null}),
      upsert:async()=>({error:null}),update(value){saved=value;return q},
      then(resolve){resolve({error:null})},
      single:async()=>({error:null,data:table==='email_outbox'
        ? {id:'held',lead_id:'one',recipient,message_type:'email_1',status:'pending'}
        : columns==='tenant_id'?{tenant_id:'tenant'}:{email:recipient,status:'Ready for Outreach'}}),
    };return q;
  },rpc(){providerCalls++;throw Error('Unexpected provider claim');}};
  const {sendSavedEmail}=load('email-outbox',{
    '@supabase/supabase-js':{createClient:()=>db},resend:{Resend:class{constructor(){providerCalls++;}}},
    'node:crypto':{randomUUID:()=> 'mock-id'},'@/lib/outreach-identity':identity,
    '@/lib/email-templates':{sendBlockedReason:()=>null},
  });
  await assert.rejects(()=>sendSavedEmail(recipient,'subject','body'),DuplicateMailboxHoldError);
  assert.equal(saved.status,'needs_review');
  assert.equal(saved.error_message,DUPLICATE_MAILBOX_HOLD);
  assert.equal(providerCalls,0);

  const list=['held','eligible'].map(id=>({id,business_name:id,email:id+'@example.invalid',industry:'roofing',lead_ai_summaries:[{lead_score:75}]}));
  const pipelineDb={from(table){
    const q={select:()=>q,eq:()=>q,gte:()=>q,not:()=>q,neq:()=>q,lt:()=>q,in:()=>q,is:()=>q,
      then(resolve){resolve({count:0,error:null});},limit:async()=>({data:list,error:null}),
      single:async()=>({data:{niches:['roofing']},error:null})};
    return q;
  }};
  const getPipeline=sendEmail=>load('automation',{
    '@supabase/supabase-js':{createClient:()=>pipelineDb},'@/lib/ai-scoring':{},'@/lib/resend':{sendEmail},'@/lib/outreach-identity':identity,
    '@/lib/email-templates':{sendBlockedReason:()=>null,renderOutreachEmail:()=>({subject:'subject',html:'body',bodyText:'body'})},
    '@/lib/outreach-markets':{marketApproved:()=>true},'@/lib/email-sequence':{},'@/lib/audit':{},
    '@/lib/lead-stats':{phoenixDayStartIso:()=>''},'@/lib/email-validation':{checkMailability:async email=>({ok:true,email})},
    '@/lib/internet-intelligence':{verifiedOutreachDetail:()=>null},'@/lib/score-thresholds':{scoreAllowsSend:()=>true,FALLBACK_SCORE:50,SCORE_SEND_THRESHOLD:60},
  });
  const attempted=[];
  const outcome=await getPipeline(async email=>{attempted.push(email);if(email.startsWith('held'))throw new DuplicateMailboxHoldError();}).runAutomationPhase('send');
  assert.equal(outcome.heldForReview,1);
  assert.equal(outcome.sent,1);
  assert.deepEqual(attempted,['held@example.invalid','eligible@example.invalid']);
  let attempts=0;
  await assert.rejects(()=>getPipeline(async()=>{attempts++;throw new Error('Unknown delivery state')}).runAutomationPhase('send'),/Unknown delivery state/);
  assert.equal(attempts,1);
  console.log('Passed: duplicate hold persisted, no provider claim for held address, next eligible record proceeds, unknown delivery error stops the batch.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
