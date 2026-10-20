import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.ts';
import {seedDemo,demoPassword,demoPin} from './demo-seed.ts';
import {demoBooks} from '../demo/books.ts';

const directory=mkdtempSync(join(tmpdir(),'reading-stars-smoke-'));
const {app,db}=createApp({dataDir:directory,origin:'http://127.0.0.1',ai:null,timeZone:'UTC'});
seedDemo(db,directory);
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(r=>server.once('listening',r));
const port=(server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
console.log(JSON.stringify({task:'disposable-smoke',pid:process.pid,parent:process.ppid,cwd:process.cwd(),listen:base,started:new Date().toISOString()}));
let cookie='';
async function call(path:string,method='GET',body?:unknown,expected=200) {
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(r.status,expected,`${method} ${path}`);
  const set=r.headers.getSetCookie();if(set.length)cookie=set[0].split(';')[0];
  if(r.headers.get('content-type')?.includes('application/json'))return await r.json() as any;
  return r;
}
try {
  assert.equal((await fetch(base)).status,200);
  await call('/health');await call('/shelf','GET',undefined,401);
  await call('/login','POST',{password:demoPassword});
  await call('/parent','GET',undefined,403);
  const shelf=await call('/shelf');assert.equal(shelf.books.length,3);
  for(const b of shelf.books)await call('/covers/'+b.coverId);
  const assignment=await call('/library/lantern/choose','POST',{childId:'demo-alex'},201);
  const attempt=await call(`/assignments/${assignment.id}/start`,'POST',{});
  assert.equal(attempt.questions.length,5);
  const original=demoBooks[0].quiz;
  const answers=Object.fromEntries(attempt.questions.map((q:any)=>[q.id,q.options.find((o:any)=>o.text===original.questions.find(p=>p.id===q.id)!.options[0]).id]));
  assert.ok(attempt.questions.every((q:any)=>!('correct' in q)));
  const first=attempt.questions[0].id;
  await call(`/attempts/${attempt.id}/answers`,'PUT',{answers:{[first]:answers[first]}});
  const resumed=await call(`/assignments/${assignment.id}/start`,'POST',{});
  assert.equal(resumed.id,attempt.id);assert.equal(resumed.answers[first],answers[first]);
  const result=await call(`/attempts/${attempt.id}/submit`,'POST',{answers});assert.equal(result.passed,true);
  await call(`/parent/assignments/${assignment.id}/approve`,'POST',{discussionChecked:true},403);
  await call('/parent/unlock','POST',{pin:demoPin});
  const award=await call(`/parent/assignments/${assignment.id}/approve`,'POST',{discussionChecked:true});
  const repeated=await call(`/parent/assignments/${assignment.id}/approve`,'POST',{discussionChecked:true});assert.equal(award.id,repeated.id);
  await call(`/parent/awards/${award.id}/record`,'POST');
  const parent=await call('/parent');assert.equal(parent.attempts[0].score,5);assert.ok(parent.awards[0].recorded);
  const after=await call('/shelf');assert.equal(after.daily['demo-alex'].used,1);assert.equal(after.daily['demo-sam'].used,0);
  console.log(JSON.stringify({passed:true,realCoverRoutes:3,savedAnswersResumed:true,parentOnlyAward:true,idempotentAward:true,recording:true,perReaderDailyLedger:true,aiDisabled:true}));
} finally {
  await new Promise<void>((r,e)=>{server.close(error=>error?e(error):r());server.closeAllConnections();});
  db.close();rmSync(directory,{recursive:true,force:true});
  console.log('Disposable server stopped and temporary data removed.');
}
