import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
import {createApp} from '../server/app.ts';
import {seedDemo,demoPassword,demoPin} from '../scripts/demo-seed.ts';
import {demoBooks,storyText,countWords} from '../demo/books.ts';
import {readingDay} from '../shared/rewards.ts';

test('opt-in original demo uses normal auth, real covers, accurate counts and refuses household overwrite',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reading-stars-demo-test-'));
  const {app,db}=createApp({dataDir:directory,origin:'http://127.0.0.1:8787',ai:null,timeZone:'Europe/London'});
  try {
    seedDemo(db,directory);
    await request(app).get('/api/shelf').expect(401);
    const child=request.agent(app);
    await child.post('/api/login').send({password:demoPassword}).expect(200);
    await child.get('/api/parent').expect(403);
    const shelf=(await child.get('/api/shelf').expect(200)).body;
    assert.equal(shelf.children.length,2);assert.equal(shelf.books.length,3);
    for(const b of shelf.books) {
      await child.get('/api/covers/'+b.coverId).expect(200).expect('Content-Type',/image\/png/);
      assert.equal(Object.values(b.offers).length,2);
      assert.ok(Object.values(b.offers).every((o:any)=>o.quizReady&&!o.needsParent));
    }
    await child.post('/api/parent/unlock').send({pin:demoPin}).expect(200);
    const parent=(await child.get('/api/parent').expect(200)).body;
    assert.equal(parent.aiAvailable,false);assert.equal(parent.timeZone,'Europe/London');
    for(const b of demoBooks) {
      const saved=parent.books.find((x:any)=>x.id===b.id);
      assert.equal(saved.reward.words,countWords(storyText(b.story)));
      assert.equal(saved.requiredQuestions,5);
    }
    assert.throws(()=>seedDemo(db,directory),/empty household/);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM books').get() as any).n,3);
    await child.post('/api/setup').send({password:demoPassword,pin:demoPin}).expect(409);
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('normal first-run setup has no demo users or books and timezone defaults to UTC',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reading-stars-empty-test-'));
  const {app,db}=createApp({dataDir:directory,origin:'http://127.0.0.1:8787',ai:null});
  try {
    await request(app).post('/api/login').send({password:demoPassword}).expect(401);
    const parent=request.agent(app);
    await parent.post('/api/setup').send({password:'unique-test-password',pin:'987654'}).expect(201);
    const data=(await parent.get('/api/parent').expect(200)).body;
    assert.deepEqual(data.children,[]);assert.deepEqual(data.books,[]);assert.equal(data.timeZone,'UTC');
    assert.equal(readingDay(new Date('2026-10-21T00:30:00Z')),'2026-10-21');
    assert.equal(readingDay(new Date('2026-10-21T00:30:00Z'),'America/Los_Angeles'),'2026-10-20');
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
