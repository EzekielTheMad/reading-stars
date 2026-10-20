import {copyFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transaction, type DB} from '../server/db.ts';
import {hashSecret} from '../server/security.ts';
import {quizSchema} from '../shared/schema.ts';
import {demoBooks,storyText,countWords} from '../demo/books.ts';

// Deliberately public credentials. These are used only by the opt-in local demo.
export const demoPassword='reading-stars-demo';
export const demoPin='246810';
export function seedDemo(db:DB,directory:string) {
  for(const table of ['settings','children','books','assignments','attempts','awards']) {
    if((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n)throw new Error('Demo seed requires an empty household; existing data is never overwritten.');
  }
  mkdirSync(join(directory,'uploads'),{recursive:true,mode:0o700});
  transaction(db,()=>{
    const settings=db.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
    settings.run('password',hashSecret(demoPassword));settings.run('pin',hashSecret(demoPin));
    for(const c of [{id:'demo-alex',name:'Alex',age:7,band:2,color:'orange'},{id:'demo-sam',name:'Sam',age:10,band:3,color:'green'}]) {
      db.prepare('INSERT INTO children(id,name,age,profile,confidence,color) VALUES(?,?,?,?,?,?)').run(c.id,c.name,c.age,'Fictional demo reader; edit for your household.','Demo placement only',c.color);
      db.prepare('INSERT INTO reward_readers(child_id,band) VALUES(?,?)').run(c.id,c.band);
    }
    for(const b of demoBooks) {
      const text=storyText(b.story),quiz=quizSchema.parse(b.quiz),cover=`demo-${b.id}.png`;
      copyFileSync(fileURLToPath(new URL(`../demo/covers/${b.id}.png`,import.meta.url)),join(directory,'uploads',cover));
      db.prepare('INSERT INTO books(id,title,author,isbn,edition,format,pages,notes,confirmed,draft) VALUES(?,?,?,?,?,?,?,?,?,?)').run(b.id,b.title,'Reading Stars contributors','','Original demo story',b.format,0,text,1,JSON.stringify(quiz));
      db.prepare('INSERT INTO uploads(id,book_id,kind,name,path,mime,extracted,warnings) VALUES(?,?,?,?,?,?,?,?)').run(`cover-${b.id}`,b.id,'cover',cover,cover,'image/png','','[]');
      db.prepare('INSERT INTO quizzes(id,book_id,body) VALUES(?,?,?)').run(`quiz-${b.id}`,b.id,JSON.stringify(quiz));
      db.prepare('INSERT INTO reward_books(book_id,band,workload,review) VALUES(?,?,?,0)').run(b.id,b.band,'short');
      db.prepare('INSERT INTO book_word_counts(book_id,words,source) VALUES(?,?,?)').run(b.id,countWords(text),`Counted from bundled original story: demo/stories/${b.story}`);
    }
    db.prepare('INSERT INTO audit(action,entity,detail) VALUES(?,?,?)').run('demo_seed','demo','Fictional readers and original stories only; no family data.');
  });
}
