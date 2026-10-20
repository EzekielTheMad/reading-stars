import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/db.ts";
import type { AIProvider } from "../server/ai.ts";
import { backupData } from "../scripts/backup.ts";
import { extractUpload } from "../server/uploads.ts";
import { quiz, story, epubFixture, pdfFixture, coverFixture } from "./fixtures.ts";

test('long adventures require ten approved questions, preserve legacy agreements and use eight-of-ten everywhere',async()=>{
  const f=await fixture();
  try{
    const kids=(await f.parent.get('/api/parent')).body.children;
    const book=await f.book('Long narrative'),legacy=await f.assign(book,kids[0].id);
    const old=f.db.prepare('SELECT * FROM assignments WHERE id=?').get(legacy);
    const open=(await f.child.post(`/api/assignments/${legacy}/start`).send({}).expect(200)).body;
    assert.equal(open.questions.length,5);
    const saved={[open.questions[0].id]:'0'};
    await f.child.put(`/api/attempts/${open.id}/answers`).send({answers:saved}).expect(200);
    await f.parent.put(`/api/parent/books/${book}/reward`).send({band:4,workload:'long',words:87223,wordCountSource:'Test count',review:false}).expect(200);
    await f.parent.post(`/api/parent/books/${book}/publish`).send({reviewed:true}).expect(400);
    await f.child.post(`/api/library/${book}/choose`).send({childId:kids[1].id}).expect(409);
    const bank={...quiz,questions:[...quiz.questions,...quiz.questions.map(q=>({...q,id:q.id+'-extra',prompt:q.prompt+' (another scene)'}))]};
    await f.parent.put(`/api/parent/books/${book}/draft`).send(bank).expect(200);
    await f.parent.post(`/api/parent/books/${book}/publish`).send({reviewed:true}).expect(201);
    const shelf=(await f.child.get('/api/shelf')).body;
    const offers=shelf.books.find((b:any)=>b.id===book).offers;
    assert.equal(offers[kids[0].id].stars,13);assert.equal(offers[kids[1].id].stars,11);
    assert.equal(offers[kids[1].id].questionCount,10);assert.equal(offers[kids[1].id].quizReady,true);
    assert.deepEqual(f.db.prepare('SELECT * FROM assignments WHERE id=?').get(legacy),old);
    const resumed=(await f.child.post(`/api/assignments/${legacy}/start`).send({})).body;
    assert.equal(resumed.id,open.id);assert.deepEqual(resumed.answers,saved);assert.deepEqual(resumed.questions,open.questions);
    const chosen=(await f.child.post(`/api/library/${book}/choose`).send({childId:kids[1].id}).expect(201)).body.id;
    const pinned=f.db.prepare('SELECT * FROM assignments WHERE id=?').get(chosen) as any;
    assert.equal(pinned.stars,11);assert.equal(pinned.question_count,10);
    await f.parent.put(`/api/parent/books/${book}/reward`).send({band:1,workload:'short',words:500,review:false}).expect(200);
    const a=(await f.child.post(`/api/assignments/${chosen}/start`).send({}).expect(200)).body;
    assert.equal(a.questions.length,10,'Length remains pinned despite later metadata edits');
    assert.ok(a.questions.every((q:any)=>!('correct' in q)&&!('explanation' in q)));
    const answer=(attempt:any,n:number)=>Object.fromEntries(attempt.questions.map((q:any,i:number)=>{
      const original=bank.questions.find(p=>p.id===q.id)!;
      return [q.id,q.options.find((o:any)=>i<n ? o.text===original.options[original.correct] : o.text!==original.options[original.correct]).id];
    }));
    const incomplete=answer(a,10);delete incomplete[a.questions[9].id];
    await f.child.post(`/api/attempts/${a.id}/submit`).send({answers:incomplete}).expect(400);
    const fail=(await f.child.post(`/api/attempts/${a.id}/submit`).send({answers:answer(a,7)}).expect(200)).body;
    assert.deepEqual(fail,{score:7,passed:false});
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM daily_books WHERE child_id=?').get(kids[1].id) as any).n,0);
    await f.parent.post(`/api/parent/assignments/${chosen}/approve`).send({discussionChecked:true}).expect(400);
    await f.parent.post(`/api/parent/assignments/${chosen}/retry`).send({pin:f.pin}).expect(200);
    const retry=(await f.child.post(`/api/assignments/${chosen}/start`).send({})).body;
    assert.equal(retry.questions.length,10);
    const pass=(await f.child.post(`/api/attempts/${retry.id}/submit`).send({answers:answer(retry,8)}).expect(200)).body;
    assert.deepEqual(pass,{score:8,passed:true});
    await f.child.post(`/api/attempts/${retry.id}/submit`).send({answers:{}}).expect(200);
    const award=(await f.parent.post(`/api/parent/assignments/${chosen}/approve`).send({discussionChecked:true}).expect(200)).body;
    assert.equal(award.stars,11);
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM daily_books WHERE child_id=?').get(kids[1].id) as any).n,1);
    await f.child.post(`/api/attempts/${open.id}/submit`).send({answers:await f.answers(open,true)}).expect(200);
    const oldAward=(await f.parent.post(`/api/parent/assignments/${legacy}/approve`).send({discussionChecked:true}).expect(200)).body;
    assert.equal(oldAward.stars,8);
    const activity=(await f.parent.get('/api/parent')).body.attempts;
    assert.equal(activity.find((x:any)=>x.id===a.id).score,7);
    assert.equal(activity.find((x:any)=>x.id===retry.id).questions.length,10);
  }finally{f.close();}
});

test('version-two migration pins old quiz lengths and preserves open answers, rewards and later ten-question failures',async()=>{
  const f=await fixture();let closed=false;
  try{
    const id=await f.assign(await f.book());
    const a=(await f.child.post(`/api/assignments/${id}/start`).send({})).body;
    await f.child.put(`/api/attempts/${a.id}/answers`).send({answers:{[a.questions[0].id]:'0'}}).expect(200);
    const before=f.db.prepare('SELECT * FROM attempts WHERE id=?').get(a.id);
    f.db.exec('ALTER TABLE assignments DROP COLUMN question_count; DROP TABLE book_word_counts; PRAGMA user_version=2');
    const old=f.db.prepare('SELECT * FROM assignments WHERE id=?').get(id) as any;
    f.db.close();closed=true;
    const db=openDatabase(f.directory,"America/Phoenix");
    try {
    const after=db.prepare('SELECT * FROM assignments WHERE id=?').get(id) as any;
    assert.equal(after.question_count,5);
    const {question_count,...legacy}=after;assert.deepEqual(legacy,{...old});
    assert.deepEqual(db.prepare('SELECT * FROM attempts WHERE id=?').get(a.id),before);
    assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version,3);
    db.prepare('UPDATE attempts SET questions=?,score=7,submitted=? WHERE id=?').run(JSON.stringify(Array.from({length:10},(_,i)=>({id:String(i),order:[0,1,2,3]}))),'2026-10-20 21:00:00',a.id);
    }finally{db.close();}
    const again=openDatabase(f.directory,"America/Phoenix");
    try {assert.equal((again.prepare('SELECT COUNT(*) n FROM daily_books').get() as any).n,0,'Seven out of ten must not be backfilled as a passed book');
    }finally{again.close();}
  }finally{if(!closed)f.db.close();rmSync(f.directory,{recursive:true,force:true});}
});

async function fixture(ai?: AIProvider, now?: () => Date) {
  const directory = mkdtempSync(join(tmpdir(), "reading-stars-test-"));
  const env = createApp({
    dataDir: directory,
    origin: "http://127.0.0.1:8787",
    ai,
    now,
    timeZone: "America/Phoenix",
  });
  const parent = request.agent(env.app),
    password = randomBytes(20).toString("hex"),
    pin = String(randomInt(100000, 999999));
  await parent.post("/api/setup").send({ password, pin }).expect(201);
  for(const [name,age,band] of [["Demo Reader One",7,2],["Demo Reader Two",10,3]] as const){
    const child=(await parent.post('/api/parent/children').send({name,age,profile:'Fictional test reader',confidence:'',color:'green'}).expect(201)).body;
    await parent.put(`/api/parent/children/${child.id}/reward`).send({band}).expect(200);
  }
  const child = request.agent(env.app);
  await child.post("/api/login").send({ password }).expect(200);
  async function book(title = "Mara and the Lost Lantern") {
    const r = await parent
      .post("/api/parent/books")
      .send({
        title,
        author: "Reading Stars test fixture",
        format: "early",
        notes: story,
        confirmed: true,
      })
      .expect(201);
    await parent.put(`/api/parent/books/${r.body.id}/reward`).send({band:3,workload:"compact",words:6000,review:false}).expect(200);
    return r.body.id as string;
  }
  async function assign(bookId: string, childId?: string) {
    await parent.post(`/api/parent/books/${bookId}/upload`)
      .attach("file", coverFixture(), "original-test-cover.png").expect(201);
    await parent
      .put(`/api/parent/books/${bookId}/draft`)
      .send(quiz)
      .expect(200);
    await parent
      .post(`/api/parent/books/${bookId}/publish`)
      .send({ reviewed: true })
      .expect(201);
    const children = (await parent.get("/api/parent").expect(200)).body
      .children;
    return (
      await parent
        .post("/api/parent/assignments")
        .send({
          childId: childId || children[0].id,
          bookId,
          stars: 8,
          effort: "stretch",
          rationale: "Agreed before reading for an individual challenge.",
        })
        .expect(201)
    ).body.id as string;
  }
  async function answers(attempt: any, correct: boolean) {
    // Tests know the original fixture's key. Child API responses must never include it.
    return Object.fromEntries(
      attempt.questions.map((q: any) => [
        q.id,
        q.options.find((o: any) =>
          correct
            ? o.text === quiz.questions.find((p) => p.id === q.id)!.options[0]
            : o.text !== quiz.questions.find((p) => p.id === q.id)!.options[0],
        ).id,
      ]),
    );
  }
  return {
    ...env,
    directory,
    parent,
    child,
    password,
    pin,
    book,
    assign,
    answers,
    close() {
      env.db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("private household data and parent answer keys require authorization", async () => {
  const f = await fixture();
  try {
    await request(f.app).get("/api/shelf").expect(401);
    await request(f.app).get("/api/parent").expect(401);
    await f.child.get("/api/parent").expect(403);
    await f.child
      .post("/api/parent/books")
      .send({ title: "No access" })
      .expect(403);
    const bookId = await f.book(),
      assignmentId = await f.assign(bookId);
    const attempt = (
      await f.child
        .post(`/api/assignments/${assignmentId}/start`)
        .send({})
        .expect(200)
    ).body;
    const json = JSON.stringify(attempt);
    for (const forbidden of [
      "correct",
      "explanation",
      "reference",
      "discussion",
    ])
      assert.equal(json.includes(`"${forbidden}"`), false);
    await f.child
      .put(`/api/parent/books/${bookId}/draft`)
      .send(quiz)
      .expect(403);
    await f.child
      .post(`/api/parent/assignments/${assignmentId}/approve`)
      .send({ discussionChecked: true })
      .expect(403);
  } finally {
    f.close();
  }
});
test("the shared library requires an approved quiz and existing cover; edition review is informational", async () => {
  const f = await fixture();
  try {
    const id = await f.book();
    const childId = (await f.parent.get("/api/parent")).body.children[0].id;
    const assignmentBody = {childId, bookId:id, effort:"comfortable", stars:4, rationale:"Agreed before reading"};
    await f.parent.put(`/api/parent/books/${id}/draft`).send(quiz).expect(200);
    assert.equal((await f.child.get("/api/shelf")).body.books.length, 0);
    await f.parent.post(`/api/parent/books/${id}/publish`).send({reviewed:true}).expect(201);
    await f.parent.post("/api/parent/assignments").send(assignmentBody).expect(400);
    assert.equal((await f.child.get("/api/shelf")).body.books.length, 0);
    const cover = (await f.parent.post(`/api/parent/books/${id}/upload`)
      .attach("file", coverFixture(), "original-test-cover.png").expect(201)).body;
    const assignment = (await f.parent.post("/api/parent/assignments").send(assignmentBody).expect(201)).body.id;
    assert.equal((await f.child.get("/api/shelf")).body.books[0].coverId, cover.id);
    const before = (await f.child.post(`/api/assignments/${assignment}/start`).send({}).expect(200)).body;
    f.db.prepare("UPDATE books SET confirmed=0 WHERE id=?").run(id);
    const visible = (await f.child.get("/api/shelf").expect(200)).body;
    assert.equal(visible.books.length, 1);
    assert.equal(visible.assignments.length, 1);
    await f.child.get(`/api/covers/${cover.id}`).expect(200);
    const parentBook = (await f.parent.get("/api/parent").expect(200)).body.books[0];
    assert.deepEqual(parentBook.preparationNeeds, ["Confirm edition"]);
    assert.equal(parentBook.readyForChildren, true);
    await f.parent.get(`/api/covers/${cover.id}`).expect(200);
    f.db.prepare("UPDATE books SET confirmed=1 WHERE id=?").run(id);
    const saved = (await f.child.post(`/api/assignments/${assignment}/start`).send({}).expect(200)).body;
    assert.equal(saved.id, before.id, "Preparation changes must preserve the child's progress");
    const coverPath = (f.db.prepare("SELECT path FROM uploads WHERE id=?").get(cover.id) as any).path;
    rmSync(join(f.directory, "uploads", coverPath));
    assert.equal((await f.child.get("/api/shelf")).body.books.length, 0, "Missing files must hide the book");
    assert.ok((await f.parent.get("/api/parent")).body.books[0].preparationNeeds.includes("Needs cover"));
    await f.child.get(`/api/covers/${cover.id}`).expect(404);
    await f.child.post(`/api/assignments/${assignment}/start`).send({}).expect(409);
  } finally { f.close(); }
});

test("all readers can discover and choose a book without assignments; choices preserve individual progress and rewards", async () => {
  const f=await fixture();
  try {
    const bookId=await f.book();
    await f.parent.post(`/api/parent/books/${bookId}/upload`).attach("file",coverFixture(),"cover.png").expect(201);
    await f.parent.put(`/api/parent/books/${bookId}/draft`).send(quiz).expect(200);
    await f.parent.post(`/api/parent/books/${bookId}/publish`).send({reviewed:true}).expect(201);
    f.db.prepare('UPDATE books SET confirmed=0 WHERE id=?').run(bookId);
    const children=(await f.parent.get('/api/parent')).body.children;
    const shelf=(await f.child.get('/api/shelf').expect(200)).body;
    assert.equal(shelf.books.length,1);assert.equal(shelf.assignments.length,0);
    for(const field of ['correct','discussion','explanation','reference','notes','sources','confirmed'])assert.equal(JSON.stringify(shelf.books).includes(`"${field}"`),false);
    await request(f.app).post(`/api/library/${bookId}/choose`).send({childId:children[0].id}).expect(401);
    await f.child.post(`/api/library/${bookId}/choose`).send({childId:children[0].id,stars:100}).expect(400);
    await f.child.post(`/api/library/${bookId}/choose`).send({childId:'unknown'}).expect(404);
    const choices=await Promise.all(Array.from({length:3},()=>f.child.post(`/api/library/${bookId}/choose`).send({childId:children[0].id})));
    assert.equal(new Set(choices.map(r=>r.body.id)).size,1);
    assert.deepEqual(choices.map(r=>r.status).sort(),[200,200,201]);
    const first=choices[0].body.id;
    const second=(await f.child.post(`/api/library/${bookId}/choose`).send({childId:children[1].id}).expect(201)).body.id;
    assert.notEqual(first,second);
    const assignments=(await f.child.get('/api/shelf')).body.assignments;
    assert.equal(assignments.length,2);assert.deepEqual(assignments.map((a:any)=>a.stars).sort(),[2,2]);
    const attempt=(await f.child.post(`/api/assignments/${first}/start`).send({}).expect(200)).body;
    const wrong=await f.answers(attempt,false);
    await f.child.post(`/api/attempts/${attempt.id}/submit`).send({answers:wrong}).expect(200);
    await f.child.post(`/api/library/${bookId}/choose`).send({childId:children[0].id}).expect(200);
    await f.child.post(`/api/assignments/${first}/start`).send({}).expect(403);
    const otherAttempt=(await f.child.post(`/api/assignments/${second}/start`).send({}).expect(200)).body;
    assert.notEqual(otherAttempt.id,attempt.id);
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM awards').get() as any).n,0);
    const unready=await f.book('No prepared questions');
    await f.child.post(`/api/library/${unready}/choose`).send({childId:children[0].id}).expect(409);
    f.db.prepare('UPDATE quizzes SET body=? WHERE book_id=?').run('{broken',bookId);
    await f.child.post(`/api/library/${bookId}/choose`).send({childId:children[0].id}).expect(409);
    assert.equal((await f.child.get('/api/shelf')).body.books.length,0);
  } finally {f.close();}
});

test("choosing a parent-assigned book keeps the agreed reward and pinned quiz version",async()=>{
  const f=await fixture();
  try {
    const bookId=await f.book(),id=await f.assign(bookId);
    const before=f.db.prepare('SELECT * FROM assignments WHERE id=?').get(id) as any;
    const result=await f.child.post(`/api/library/${bookId}/choose`).send({childId:before.child_id}).expect(200);
    assert.equal(result.body.id,id);
    assert.deepEqual(f.db.prepare('SELECT * FROM assignments WHERE id=?').get(id),before);
    assert.equal(before.stars,8);
  } finally {f.close();}
});
test("parent cover previews work when household data is in a hidden directory", async () => {
  const root=mkdtempSync(join(tmpdir(),"reading-stars-hidden-cover-"));
  const {app,db}=createApp({dataDir:join(root,".private"),origin:"http://127.0.0.1:8787"});
  try {
    const agent=request.agent(app);
    await agent.post("/api/setup").send({password:randomBytes(24).toString("hex"),pin:String(randomInt(100000,999999))}).expect(201);
    const id=(await agent.post("/api/parent/books").send({title:"Original cover fixture",author:"Verification",format:"early"}).expect(201)).body.id;
    const upload=(await agent.post(`/api/parent/books/${id}/upload`).attach("file",coverFixture(),"cover.png").expect(201)).body;
    const image=await agent.get(`/api/covers/${upload.id}`).expect(200).expect("Content-Type",/image\/png/);
    assert.ok(image.body.equals(coverFixture()));
  } finally {db.close();rmSync(root,{recursive:true,force:true});}
});
test("failed attempts require a fresh PIN; credit is single use and unfinished work resumes", async () => {
  const f = await fixture();
  try {
    const id = await f.assign(await f.book());
    const attempt = (
      await f.child.post(`/api/assignments/${id}/start`).send({}).expect(200)
    ).body;
    const wrong = await f.answers(attempt, false);
    const first = Object.fromEntries(Object.entries(wrong).slice(0, 1));
    await f.child
      .put(`/api/attempts/${attempt.id}/answers`)
      .send({ answers: first })
      .expect(200);
    const resumed = (
      await f.child.post(`/api/assignments/${id}/start`).send({}).expect(200)
    ).body;
    assert.equal(resumed.id, attempt.id);
    assert.deepEqual(resumed.answers, first);
    await f.child
      .post(`/api/attempts/${attempt.id}/submit`)
      .send({ answers: first })
      .expect(400);
    const result = (
      await f.child
        .post(`/api/attempts/${attempt.id}/submit`)
        .send({ answers: wrong })
        .expect(200)
    ).body;
    assert.equal(result.score, 0);
    assert.equal(result.passed, false);
    await f.child.post(`/api/assignments/${id}/start`).send({}).expect(403);
    await f.parent
      .post(`/api/parent/assignments/${id}/retry`)
      .send({})
      .expect(400);
    await f.parent
      .post(`/api/parent/assignments/${id}/retry`)
      .send({ pin: "000000" })
      .expect(403);
    await f.child
      .post(`/api/parent/assignments/${id}/retry`)
      .send({ pin: f.pin })
      .expect(200);
    const next = (
      await f.child.post(`/api/assignments/${id}/start`).send({}).expect(200)
    ).body;
    assert.notEqual(next.id, attempt.id);
    await f.child
      .post(`/api/attempts/${next.id}/submit`)
      .send({ answers: await f.answers(next, false) })
      .expect(200);
    await f.child.post(`/api/assignments/${id}/start`).send({}).expect(403);
  } finally {
    f.close();
  }
});
test("pass, discussion, award and manual reward recording are idempotent", async () => {
  const f = await fixture();
  try {
    const id = await f.assign(await f.book());
    const attempt = (
      await f.child.post(`/api/assignments/${id}/start`).send({})
    ).body;
    const correct = await f.answers(attempt, true);
    await f.child
      .post(`/api/attempts/${attempt.id}/submit`)
      .send({ answers: correct })
      .expect(200)
      .expect((r) => assert.equal(r.body.score, 5));
    await f.child
      .post(`/api/attempts/${attempt.id}/submit`)
      .send({ answers: {} })
      .expect(200)
      .expect((r) => assert.equal(r.body.score, 5));
    await f.child
      .put(`/api/attempts/${attempt.id}/answers`)
      .send({ answers: correct })
      .expect(409);
    await f.child.post(`/api/assignments/${id}/start`).send({}).expect(409);
    await f.parent
      .post(`/api/parent/assignments/${id}/approve`)
      .send({ discussionChecked: false })
      .expect(400);
    const awards = await Promise.all(
      [1, 2].map(() =>
        f.parent
          .post(`/api/parent/assignments/${id}/approve`)
          .send({ discussionChecked: true })
          .expect(200),
      ),
    );
    assert.equal(awards[0].body.id, awards[1].body.id);
    const parent = (await f.parent.get("/api/parent")).body;
    assert.equal(parent.awards.length, 1);
    assert.equal(parent.awards[0].stars, 8);
    assert.equal(parent.awards[0].recorded, null);
    await f.parent
      .post(`/api/parent/awards/${awards[0].body.id}/record`)
      .send({})
      .expect(200);
    await f.parent
      .post(`/api/parent/awards/${awards[0].body.id}/record`)
      .send({})
      .expect(200);
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) n FROM audit WHERE action='reward_recorded'",
          )
          .get() as any
      ).n,
      1,
    );
    await f.parent
      .post(`/api/parent/assignments/${id}/retry`)
      .send({ pin: f.pin })
      .expect(409);
  } finally {
    f.close();
  }
});
test("a below-threshold override needs discussion approval and an explanation", async () => {
  const f = await fixture();
  try {
    const id = await f.assign(await f.book());
    const a = (await f.child.post(`/api/assignments/${id}/start`).send({}))
      .body;
    await f.child
      .post(`/api/attempts/${a.id}/submit`)
      .send({ answers: await f.answers(a, false) })
      .expect(200);
    await f.parent
      .post(`/api/parent/assignments/${id}/approve`)
      .send({ discussionChecked: true })
      .expect(400);
    await f.parent
      .post(`/api/parent/assignments/${id}/approve`)
      .send({ discussionChecked: true, override: true, reason: "bad" })
      .expect(400);
    await f.parent
      .post(`/api/parent/assignments/${id}/approve`)
      .send({
        discussionChecked: true,
        override: true,
        reason:
          "The child explained the sequence and cause orally; the question wording was confusing.",
      })
      .expect(200);
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) n FROM audit WHERE action='reward_override'",
          )
          .get() as any
      ).n,
      1,
    );
  } finally {
    f.close();
  }
});
test("rewards calibrate independently and duplicate assignments are rejected", async () => {
  const f = await fixture();
  try {
    const book = await f.book("Dog Man"),
      children = (await f.parent.get("/api/parent")).body.children;
    const younger = (
      await f.parent
        .post("/api/parent/suggest")
        .send({ bookId: book, childId: children[0].id })
        .expect(200)
    ).body;
    const older = (
      await f.parent
        .post("/api/parent/suggest")
        .send({ bookId: book, childId: children[1].id })
        .expect(200)
    ).body;
    assert.equal(younger.stars, 2);
    assert.equal(older.stars, 2);
    await f.assign(book, children[0].id);
    await f.parent
      .post("/api/parent/assignments")
      .send({
        bookId: book,
        childId: children[0].id,
        stars: 8,
        effort: "stretch",
        rationale: "A duplicate must not earn more.",
      })
      .expect(409);
  } finally {
    f.close();
  }
});
test("published quiz versions and agreed rewards stay fixed for an adventure", async () => {
  const f = await fixture();
  try {
    const b = await f.book(),
      id = await f.assign(b);
    const updated = structuredClone(quiz);
    updated.questions[0].prompt = "A new question for future assignments only?";
    await f.parent
      .put(`/api/parent/books/${b}/draft`)
      .send(updated)
      .expect(200);
    await f.parent
      .post(`/api/parent/books/${b}/publish`)
      .send({ reviewed: true })
      .expect(201);
    const a = (await f.child.post(`/api/assignments/${id}/start`).send({}))
      .body;
    assert.ok(
      a.questions.some((q: any) => q.prompt === quiz.questions[0].prompt),
    );
    await f.parent
      .put(`/api/parent/books/${b}`)
      .send({ title: "Different title", author: "Other", confirmed: true })
      .expect(409);
  } finally {
    f.close();
  }
});
test("server rejects cross-site mutations and expires parent mode independently", async () => {
  const f = await fixture();
  try {
    await f.parent
      .post("/api/parent/books")
      .set("Origin", "https://unrelated.example")
      .send({ title: "No" })
      .expect(403);
    f.db.prepare("UPDATE sessions SET parent_until=0").run();
    await f.parent.get("/api/parent").expect(403);
    await f.parent.get("/api/shelf").expect(200);
    await f.parent.post("/api/parent/unlock").send({ pin: f.pin }).expect(200);
    await f.parent.get("/api/parent").expect(200);
    await f.parent.post("/api/parent/lock").send({}).expect(200);
    await f.parent.get("/api/parent").expect(403);
  } finally {
    f.close();
  }
});
test("PDF/EPUB extraction preserves readable references; sparse PDFs raise warnings", async () => {
  const epub = await extractUpload(epubFixture(), "story.epub");
  assert.ok(epub.text.includes(story));
  assert.ok(epub.text.indexOf(story) < epub.text.indexOf("This final section"));
  assert.ok(epub.text.includes("[Section 2]"));
  const pdf = await extractUpload(pdfFixture(), "story.pdf");
  assert.ok(pdf.text.includes("Mara"));
  assert.ok(pdf.text.includes("[Page 1]"));
  const sparse = await extractUpload(pdfFixture(""), "scanned.pdf");
  assert.ok(sparse.warnings.some((w) => w.includes("picture-heavy")));
  await assert.rejects(
    () => extractUpload(Buffer.from("<script>not a PDF</script>"), "fake.pdf"),
    /Use a PDF/,
  );
});
test("uploaded source text stays parent-only and survives backup/restore", async () => {
  const f = await fixture();
  const backup = join(
    tmpdir(),
    `reading-stars-backup-${randomBytes(8).toString("hex")}`,
  );
  try {
    const id = await f.book();
    const upload = (
      await f.parent
        .post(`/api/parent/books/${id}/upload`)
        .attach("file", epubFixture(), "story.epub")
        .expect(201)
    ).body;
    await f.child.get(`/api/parent/uploads/${upload.id}`).expect(403);
    await f.child.get(`/api/covers/${upload.id}`).expect(404);
    const assignment = await f.assign(id);
    await backupData(f.directory, backup);
    const restored = createApp({
      dataDir: backup,
      origin: "http://127.0.0.1:8787",
    });
    try {
      assert.equal(
        (
          restored.db
            .prepare("SELECT COUNT(*) n FROM assignments WHERE id=?")
            .get(assignment) as any
        ).n,
        1,
      );
      assert.ok(
        (
          restored.db
            .prepare("SELECT extracted FROM uploads WHERE id=?")
            .get(upload.id) as any
        ).extracted.includes(story),
      );
      const agent = request.agent(restored.app);
      await agent.post("/api/login").send({ password: f.password }).expect(200);
      await agent
        .post(`/api/assignments/${assignment}/start`)
        .send({})
        .expect(200);
    } finally {
      restored.db.close();
    }
  } finally {
    f.close();
    rmSync(backup, { recursive: true, force: true });
  }
});
test("provider failure preserves published quizzes and does not auto-retry paid requests", async () => {
  let calls = 0;
  const f = await fixture({
    discover: async () => {
      calls++;
      throw new Error("Secret provider response must not leak");
    },
    draft: async () => quiz,
    identify: async () => ({ title: "Test", author: "Test", isbn: "" }),
  });
  try {
    const book = await f.book(),
      assignment = await f.assign(book);
    const result = await f.parent
      .post(`/api/parent/books/${book}/discover`)
      .send({})
      .expect(502);
    assert.equal(result.text.includes("Secret provider"), false);
    assert.equal(calls, 1);
    await f.child
      .post(`/api/assignments/${assignment}/start`)
      .send({})
      .expect(200);
    assert.equal(
      (f.db.prepare("SELECT status FROM ai_usage").get() as any).status,
      "failed",
    );
  } finally {
    f.close();
  }
});
test("AI drafts remain unapproved until a parent reviews; malformed drafts cannot publish", async () => {
  const f = await fixture({
    discover: async () => ({
      text: story,
      sources: [{ url: "https://example.org/guide", title: "Test guide" }],
    }),
    draft: async () => quiz,
    identify: async () => ({ title: "Test", author: "Test", isbn: "" }),
  });
  try {
    const id = await f.book();
    await f.parent.post(`/api/parent/books/${id}/draft`).send({}).expect(200);
    assert.equal(
      (f.db.prepare("SELECT COUNT(*) n FROM quizzes").get() as any).n,
      0,
    );
    await f.parent
      .post(`/api/parent/books/${id}/publish`)
      .send({ reviewed: false })
      .expect(400);
    const invalid = structuredClone(quiz);
    invalid.questions[0].options = ["same", "same", "same", "same"];
    await f.parent
      .put(`/api/parent/books/${id}/draft`)
      .send(invalid)
      .expect(400);
    await f.parent
      .post(`/api/parent/books/${id}/publish`)
      .send({ reviewed: true })
      .expect(201);
  } finally {
    f.close();
  }
});
test("unknown first-run internet hosts cannot claim an unconfigured bookshelf", async () => {
  const directory = mkdtempSync(join(tmpdir(), "reading-stars-setup-"));
  const env = createApp({
    dataDir: directory,
    origin: "https://reading.example.test",
  });
  try {
    await request(env.app)
      .post("/api/setup")
      .set("Host", "reading.example.test")
      .send({
        password: randomBytes(20).toString("hex"),
        pin: String(randomInt(100000, 999999)),
      })
      .expect(403);
  } finally {
    env.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("passing boundary is four out of five for each child independently", async () => {
  const f = await fixture();
  try {
    const book = await f.book(),
      children = (await f.parent.get("/api/parent")).body.children;
    for (const [index, target] of [3, 4].entries()) {
      const id = await f.assign(book, children[index].id),
        a = (await f.child.post(`/api/assignments/${id}/start`).send({})).body;
      const answers = await f.answers(a, true);
      for (const question of a.questions.slice(target))
        answers[question.id] = question.options.find(
          (o: any) => o.id !== answers[question.id],
        ).id;
      const response = await f.child
        .post(`/api/attempts/${a.id}/submit`)
        .send({ answers })
        .expect(200);
      assert.equal(response.body.score, target);
      assert.equal(response.body.passed, target >= 4);
    }
  } finally {
    f.close();
  }
});

test("duplicate title/author/edition records cannot create another reward route", async () => {
  const f = await fixture();
  try {
    await f.book();
    await f.parent
      .post("/api/parent/books")
      .send({
        title: " MARA AND THE LOST LANTERN ",
        author: "reading stars test fixture",
        confirmed: true,
      })
      .expect(409);
    assert.equal(
      (f.db.prepare("SELECT COUNT(*) n FROM books").get() as any).n,
      1,
    );
  } finally {
    f.close();
  }
});

test('two daily book finishes are atomic, per child, full-value and reset at Arizona midnight',async()=>{
  let time=new Date('2026-10-21T06:59:00Z');
  const f=await fixture(undefined,()=>time);
  try{
    const kids=(await f.parent.get('/api/parent')).body.children;
    const ids=[] as string[], attempts=[] as any[];
    for(let i=0;i<4;i++){
      const id=await f.assign(await f.book(`Daily story ${i}`),kids[0].id);ids.push(id);
      attempts.push((await f.child.post(`/api/assignments/${id}/start`).send({}).expect(200)).body);
    }
    const answers=await Promise.all(attempts.map(a=>f.answers(a,true)));
    await f.child.put(`/api/attempts/${attempts[2].id}/answers`).send({answers:answers[2]}).expect(200);
    // Model three tabs trying to finish their books before approvals happen.
    const results=await Promise.all(attempts.slice(0,3).map((a,i)=>f.child.post(`/api/attempts/${a.id}/submit`).send({answers:answers[i]})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,200,409]);
    const rejected=results.findIndex(r=>r.status===409);
    const state=(await f.child.get('/api/shelf')).body;
    assert.equal(state.daily[kids[0].id].used,2);assert.equal(state.daily[kids[1].id].remaining,2);
    assert.ok(state.assignments.every((a:any)=>a.stars===8),'Old agreed rewards remain full-value');
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM awards').get() as any).n,0,'Passing reserves slots before parent approval');
    await f.child.post(`/api/assignments/${ids[3]}/start`).send({}).expect(200); // existing attempt resumes
    const fifth=await f.assign(await f.book('No third finish'),kids[0].id);
    await f.child.post(`/api/assignments/${fifth}/start`).send({}).expect(409);
    const other=await f.assign(await f.book('Other reader story'),kids[1].id);
    const otherTry=(await f.child.post(`/api/assignments/${other}/start`).send({}).expect(200)).body;
    await f.child.post(`/api/attempts/${otherTry.id}/submit`).send({answers:await f.answers(otherTry,true)}).expect(200);
    const accepted=results.findIndex(r=>r.status===200);
    await f.child.post(`/api/attempts/${attempts[accepted].id}/submit`).send({answers:answers[accepted]}).expect(200);
    assert.equal((await f.child.get('/api/shelf')).body.daily[kids[0].id].used,2,'Repeat submit never consumes another slot');
    time=new Date('2026-10-21T07:00:00Z');
    assert.equal((await f.child.get('/api/shelf')).body.daily[kids[0].id].remaining,2);
    const award=(await f.parent.post(`/api/parent/assignments/${ids[accepted]}/approve`).send({discussionChecked:true}).expect(200)).body;
    assert.equal(award.stars,8);
    await f.parent.post(`/api/parent/assignments/${ids[accepted]}/approve`).send({discussionChecked:true}).expect(200);
    assert.equal((await f.child.get('/api/shelf')).body.daily[kids[0].id].used,0,'Delayed approval keeps its original completion day');
    await f.child.post(`/api/attempts/${attempts[rejected].id}/submit`).send({answers:answers[rejected]}).expect(200);
    assert.equal((await f.child.get('/api/shelf')).body.daily[kids[0].id].used,1);
  }finally{f.close();}
});

test('failed attempts do not use a finish; parent exceptions cannot bypass the daily limit',async()=>{
  const f=await fixture();
  try{
    const kid=(await f.parent.get('/api/parent')).body.children[0];
    const failed=await f.assign(await f.book('Revisit this story'),kid.id);
    const a=(await f.child.post(`/api/assignments/${failed}/start`).send({})).body;
    await f.child.post(`/api/attempts/${a.id}/submit`).send({answers:await f.answers(a,false)}).expect(200);
    assert.equal((await f.child.get('/api/shelf')).body.daily[kid.id].used,0);
    for(let i=0;i<2;i++){
      const id=await f.assign(await f.book(`Completed story ${i}`),kid.id);
      const attempt=(await f.child.post(`/api/assignments/${id}/start`).send({})).body;
      await f.child.post(`/api/attempts/${attempt.id}/submit`).send({answers:await f.answers(attempt,true)}).expect(200);
    }
    await f.parent.post(`/api/parent/assignments/${failed}/approve`).send({discussionChecked:true,override:true,reason:'Demonstrated understanding in a retelling.'}).expect(409);
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM awards').get() as any).n,0);
    await f.parent.post(`/api/parent/assignments/${failed}/retry`).send({pin:f.pin}).expect(200);
    await f.child.post(`/api/assignments/${failed}/start`).send({}).expect(409);
  }finally{f.close();}
});

test('parent reward settings affect future choices only and remain parent protected',async()=>{
  const f=await fixture();
  try{
    const kids=(await f.parent.get('/api/parent')).body.children;
    const book=await f.book('Adjustable story'),old=await f.assign(book,kids[0].id);
    const original=f.db.prepare('SELECT * FROM assignments WHERE id=?').get(old);
    await f.child.put(`/api/parent/books/${book}/reward`).send({band:1,workload:'short',review:false}).expect(403);
    await f.child.put(`/api/parent/children/${kids[0].id}/reward`).send({band:5}).expect(403);
    await f.parent.put(`/api/parent/books/${book}/reward`).send({band:2,workload:'short',words:500,review:false}).expect(200);
    await f.parent.put(`/api/parent/children/${kids[0].id}/reward`).send({band:5}).expect(200);
    assert.deepEqual(f.db.prepare('SELECT * FROM assignments WHERE id=?').get(old),original);
    const fresh=(await f.child.post(`/api/library/${book}/choose`).send({childId:kids[1].id}).expect(201)).body;
    assert.equal((f.db.prepare('SELECT stars FROM assignments WHERE id=?').get(fresh.id) as any).stars,1);
    await f.parent.put(`/api/parent/books/${book}/reward`).send({band:5,workload:'long',review:false}).expect(200);
    assert.deepEqual(f.db.prepare('SELECT * FROM assignments WHERE id=?').get(old),original);
    const gated=await f.book('Parent agreement needed');
    await f.parent.put(`/api/parent/books/${gated}/reward`).send({band:4,workload:'long',review:true}).expect(200);
    await f.parent.post(`/api/parent/books/${gated}/upload`).attach('file',coverFixture(),'cover.png').expect(201);
    await f.parent.put(`/api/parent/books/${gated}/draft`).send(quiz).expect(200);
    await f.parent.post(`/api/parent/books/${gated}/publish`).send({reviewed:true}).expect(201);
    // Restore the younger provisional placement; the distant book stays browsable.
    await f.parent.put(`/api/parent/children/${kids[0].id}/reward`).send({band:2}).expect(200);
    const shelf=(await f.child.get('/api/shelf')).body;
    assert.ok(shelf.books.some((b:any)=>b.id===gated));
    assert.equal(shelf.books.find((b:any)=>b.id===gated).offers[kids[0].id].stars,null);
    await f.child.post(`/api/library/${gated}/choose`).send({childId:kids[0].id}).expect(409);
    await f.parent.put(`/api/parent/books/${gated}/reward`).send({band:4,workload:'long',review:false}).expect(200);
    await f.child.post(`/api/library/${gated}/choose`).send({childId:kids[1].id}).expect(201);
  }finally{f.close();}
});

test('upgrading an existing database backfills original completion dates without repricing history',async()=>{
  const f=await fixture();let closed=false;
  try{
    const id=await f.assign(await f.book());
    const a=(await f.child.post(`/api/assignments/${id}/start`).send({})).body;
    await f.child.post(`/api/attempts/${a.id}/submit`).send({answers:await f.answers(a,true)}).expect(200);
    await f.parent.post(`/api/parent/assignments/${id}/approve`).send({discussionChecked:true}).expect(200);
    f.db.prepare("UPDATE attempts SET submitted='2026-10-21 06:59:59' WHERE id=?").run(a.id);
    const tables=['books','assignments','attempts','awards'];
    const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
    f.db.exec('DROP TABLE daily_books; DROP TABLE reward_books; DROP TABLE reward_readers; PRAGMA user_version=1');
    f.db.close();closed=true;
    const upgraded=openDatabase(f.directory,"America/Phoenix");
    try{
      for(const table of tables)assert.deepEqual(upgraded.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),before[table]);
      assert.equal((upgraded.prepare('PRAGMA user_version').get() as any).user_version,3);
      assert.equal((upgraded.prepare('SELECT day FROM daily_books WHERE assignment_id=?').get(id) as any).day,'2026-10-20');
      assert.equal((upgraded.prepare('SELECT stars FROM awards WHERE assignment_id=?').get(id) as any).stars,8);
    }finally{upgraded.close();}
    const again=openDatabase(f.directory,"America/Phoenix");
    try{assert.equal((again.prepare('SELECT COUNT(*) n FROM daily_books').get() as any).n,1);}finally{again.close();}
  }finally{if(!closed)f.db.close();rmSync(f.directory,{recursive:true,force:true});}
});
