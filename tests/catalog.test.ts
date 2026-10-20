import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { importCatalog } from "../server/catalog.ts";
import { coverFixture, quiz } from "./fixtures.ts";

test("catalog import is reviewed, unpublished, idempotent and preserves existing books", async () => {
  const root=mkdtempSync(join(tmpdir(),"reading-stars-catalog-")), data=join(root,"data"), files=join(root,"bundle");
  const {db}=createApp({dataDir:data,origin:"http://127.0.0.1:8787"});
  try {
    mkdirSync(files);
    const cover=coverFixture(), sha256=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
    writeFileSync(join(files,"cover.png"),cover);
    const entry={key:"mara-original",book:{title:"Mara's Lantern",author:"Original fixture",format:"early"},preparationNote:"Parent must review the whole story and edition.",sources:[{url:"https://example.org/story",title:"Original source"}],quiz,cover:{file:"cover.png",sha256:sha256(cover),sourceUrl:"https://example.org/cover.png",verified:true}};
    const path=join(files,"catalog.json");
    writeFileSync(path,JSON.stringify({version:1,books:[entry]}));
    const dry=await importCatalog(path,data);
    assert.equal(dry.added,1);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM books").get() as any).n,0);
    await assert.rejects(()=>importCatalog(path,data,"0".repeat(64)),/hash changed/);
    const applied=await importCatalog(path,data,dry.sha256);
    assert.equal(applied.added,1);
    const b=db.prepare("SELECT * FROM books").get() as any;
    assert.equal(b.confirmed,0);
    assert.equal(JSON.parse(b.draft).questions.length,5);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM quizzes").get() as any).n,0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM assignments").get() as any).n,0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM uploads").get() as any).n,1);
    db.prepare("UPDATE books SET notes='Parent edits must survive'").run();
    const again=await importCatalog(path,data,dry.sha256);
    assert.equal(again.added,0);assert.equal(again.skipped,1);
    assert.equal((db.prepare("SELECT notes FROM books").get() as any).notes,"Parent edits must survive");
    entry.cover.sha256="f".repeat(64);
    writeFileSync(path,JSON.stringify({version:1,books:[entry]}));
    await assert.rejects(()=>importCatalog(path,data),/checksum/);
    entry.cover.file="../outside.png";writeFileSync(join(root,"outside.png"),cover);
    writeFileSync(path,JSON.stringify({version:1,books:[entry]}));
    await assert.rejects(()=>importCatalog(path,data),/inside the catalog/);
  } finally {db.close();rmSync(root,{recursive:true,force:true});}
});
