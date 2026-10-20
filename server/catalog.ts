import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { bookSchema, quizSchema } from "../shared/schema.ts";
import { extractUpload } from "./uploads.ts";
import { transaction } from "./db.ts";

const sourceSchema = z.object({url:z.string().url().refine(s => /^https?:\/\//.test(s)), title:z.string().min(1).max(500)});
const entrySchema = z.object({
  key:z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  book:bookSchema.omit({confirmed:true}),
  preparationNote:z.string().min(1).max(12000),
  sources:z.array(sourceSchema).max(20),
  quiz:quizSchema.nullable().default(null),
  cover:z.object({file:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),sourceUrl:z.string().url().refine(s => /^https?:\/\//.test(s)),verified:z.literal(true)}).nullable().default(null),
});
const catalogSchema = z.object({version:z.literal(1),books:z.array(entrySchema).min(1).max(100)}).superRefine((catalog,ctx) => {
  if(new Set(catalog.books.map(b=>b.key)).size!==catalog.books.length)ctx.addIssue({code:"custom",message:"Catalog keys must be unique."});
});
const digest = (value:Buffer) => createHash("sha256").update(value).digest("hex");
const normalized = (value:string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

// Operator-only local import: never publishes quizzes, creates assignments,
// confirms an edition, or changes an existing book. No remote URLs are fetched.
export async function importCatalog(bundlePath:string, dataDir:string, applyHash?:string) {
  const bundle = resolve(bundlePath), root=realpathSync(dirname(bundle));
  const bytes=readFileSync(bundle), sha256=digest(bytes);
  if(applyHash && applyHash !== sha256)throw new Error("Catalog hash changed. Review a new dry run before applying.");
  const catalog=catalogSchema.parse(JSON.parse(bytes.toString("utf8")));
  const staged=await Promise.all(catalog.books.map(async(entry) => {
    if(!entry.cover)return {entry,cover:null};
    const path=realpathSync(resolve(root,entry.cover.file)), rel=relative(root,path);
    if(!rel || rel.startsWith("..") || isAbsolute(rel))throw new Error("Cover must be inside the catalog directory.");
    const image=readFileSync(path);
    if(image.length>5*1024*1024 || digest(image)!==entry.cover.sha256)throw new Error("Cover checksum or size did not match for "+entry.book.title);
    const extracted=await extractUpload(image,entry.cover.file);
    if(extracted.kind!=="cover")throw new Error("Catalog covers must be image files.");
    return {entry,cover:{image,extracted}};
  }));
  const dbPath=join(resolve(dataDir),"reading-stars.sqlite");
  if(!existsSync(dbPath))throw new Error("Use an existing household database; the importer does not create one.");
  const db=new DatabaseSync(dbPath,{readOnly:!applyHash});
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const created:string[]=[];
  try {
    const makePlan=() => {
      const existing=db.prepare("SELECT id,title,author,isbn,edition FROM books").all() as Record<string,any>[];
      const identities=[...existing];
      return staged.map(item => {
        const {entry}=item, b=entry.book;
        const isbn=normalized(b.isbn);
        const duplicate=identities.find(old=> old.id === "catalog-"+entry.key || (isbn && normalized(old.isbn)===isbn) ||
          (normalized(old.title)===normalized(b.title) && normalized(old.author)===normalized(b.author) && normalized(old.edition)===normalized(b.edition)));
        const action=duplicate ? "skip-existing" : "add-parent-draft";
        if(!duplicate)identities.push({...b,id:"catalog-"+entry.key});
        return {...item,action,id:duplicate?.id || "catalog-"+entry.key};
      });
    };
    let plan=makePlan();
    if(applyHash) {
      const uploads=join(resolve(dataDir),"uploads");
      mkdirSync(uploads,{recursive:true,mode:0o700});
      transaction(db,()=> {
        // Re-evaluate duplicates after obtaining the database write lock.
        plan=makePlan();
        for(const item of plan) {
          if(item.action!=="add-parent-draft")continue;
          const {entry,id,cover}=item,b=entry.book;
          const notes=[entry.preparationNote,b.notes,entry.cover?`Cover source: ${entry.cover.sourceUrl}`:"Cover pending."].filter(Boolean).join("\n\n");
          if(notes.length>100000)throw new Error("Preparation notes exceed the book limit.");
          db.prepare("INSERT INTO books(id,title,author,isbn,edition,format,pages,notes,confirmed,draft,sources) VALUES(?,?,?,?,?,?,?,?,0,?,?)")
            .run(id,b.title,b.author,b.isbn,b.edition,b.format,b.pages,notes,entry.quiz?JSON.stringify(entry.quiz):null,JSON.stringify(entry.sources));
          if(cover) {
            const uploadId=randomUUID(), filename=uploadId+cover.extracted.extension, path=join(uploads,filename);
            writeFileSync(path,cover.image,{flag:"wx",mode:0o600});created.push(path);
            db.prepare("INSERT INTO uploads(id,book_id,kind,name,path,mime,extracted,warnings) VALUES(?,?,'cover',?,?,?,'','[]')")
              .run(uploadId,id,b.title.slice(0,180)+cover.extracted.extension,filename,cover.extracted.mime);
          }
          db.prepare("INSERT INTO audit(action,entity,detail) VALUES('catalog_staged',?,?)")
            .run(id,"Photo inventory preparation; unpublished; catalog SHA-256 "+sha256);
        }
      });
    }
    return {mode:applyHash?"applied":"dry-run",sha256,books:plan.map(({entry,action,cover})=>({key:entry.key,title:entry.book.title,action,cover:!!cover,draftQuestions:entry.quiz?.questions.length || 0,childVisible:false})),
      added:plan.filter(p=>p.action==="add-parent-draft").length,skipped:plan.filter(p=>p.action==="skip-existing").length,
      approvedQuizzesCreated:0,assignmentsCreated:0};
  } catch(error) {
    // Only paths created exclusively by this invocation are removed on rollback.
    for(const path of created)if(dirname(path)===join(resolve(dataDir),"uploads"))unlinkSync(path);
    throw error;
  } finally {db.close();}
}
