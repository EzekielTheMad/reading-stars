import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { readingDay } from "../shared/rewards.ts";

export function openDatabase(directory: string, timeZone="UTC") {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, "reading-stars.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,expires INTEGER NOT NULL,parent_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS children(id TEXT PRIMARY KEY,name TEXT NOT NULL,age INTEGER NOT NULL,profile TEXT NOT NULL,confidence TEXT NOT NULL,color TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,isbn TEXT NOT NULL,edition TEXT NOT NULL,format TEXT NOT NULL,pages INTEGER NOT NULL,notes TEXT NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0,draft TEXT,sources TEXT NOT NULL DEFAULT '[]',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id),kind TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,extracted TEXT NOT NULL,warnings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quizzes(id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id),body TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY,child_id TEXT NOT NULL REFERENCES children(id),book_id TEXT NOT NULL REFERENCES books(id),quiz_id TEXT NOT NULL REFERENCES quizzes(id),stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 100),effort TEXT NOT NULL,rationale TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'reading',retry_credit INTEGER NOT NULL DEFAULT 0,UNIQUE(child_id,book_id));
    CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES assignments(id),questions TEXT NOT NULL,answers TEXT NOT NULL DEFAULT '{}',score INTEGER,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,submitted TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_attempt ON attempts(assignment_id) WHERE submitted IS NULL;
    CREATE TABLE IF NOT EXISTS awards(id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),stars INTEGER NOT NULL,reason TEXT NOT NULL,recorded TEXT,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,entity TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS ai_usage(id TEXT PRIMARY KEY,operation TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    PRAGMA user_version=1;`);
  // Additive reward configuration; never rewrite an agreed assignment or award.
  db.exec(`CREATE TABLE IF NOT EXISTS reward_books(book_id TEXT PRIMARY KEY REFERENCES books(id),band INTEGER CHECK(band BETWEEN 1 AND 5),workload TEXT CHECK(workload IN ('short','compact','standard','long')),review INTEGER NOT NULL DEFAULT 1 CHECK(review IN (0,1)));
    CREATE TABLE IF NOT EXISTS reward_readers(child_id TEXT PRIMARY KEY REFERENCES children(id),band INTEGER CHECK(band BETWEEN 1 AND 5));
    CREATE TABLE IF NOT EXISTS daily_books(assignment_id TEXT PRIMARY KEY REFERENCES assignments(id),child_id TEXT NOT NULL REFERENCES children(id),day TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS daily_books_reader_day ON daily_books(child_id,day);
    CREATE TABLE IF NOT EXISTS book_word_counts(book_id TEXT PRIMARY KEY REFERENCES books(id),words INTEGER CHECK(words BETWEEN 1 AND 10000000),source TEXT NOT NULL DEFAULT '');`);
  // All legacy adventures keep five-question quizzes, including retries. New
  // adventures pin their quiz length alongside their existing immutable price.
  if(!(db.prepare('PRAGMA table_info(assignments)').all() as {name:string}[]).some(c=>c.name==='question_count'))
    db.exec('ALTER TABLE assignments ADD COLUMN question_count INTEGER NOT NULL DEFAULT 5 CHECK(question_count IN (5,10))');
  db.exec('PRAGMA user_version=3');
  // Backfill original successful-completion dates, including pending approvals.
  // Older rewards remain payable, even if a historical day exceeded two books.
  db.exec("BEGIN IMMEDIATE");
  try {
    const history=db.prepare(`SELECT s.id,s.child_id,COALESCE(
      (SELECT MIN(a.submitted) FROM attempts a WHERE a.assignment_id=s.id AND a.submitted IS NOT NULL AND a.score>=CAST((json_array_length(a.questions)*8+9)/10 AS INTEGER)),
      (SELECT w.created FROM awards w WHERE w.assignment_id=s.id)) completed
      FROM assignments s WHERE NOT EXISTS(SELECT 1 FROM daily_books d WHERE d.assignment_id=s.id)`).all() as {id:string;child_id:string;completed:string|null}[];
    const insert=db.prepare("INSERT INTO daily_books(assignment_id,child_id,day) VALUES(?,?,?)");
    for(const row of history)if(row.completed){
      const timestamp=row.completed.replace(" ","T");
      insert.run(row.id,row.child_id,readingDay(new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)?timestamp:timestamp+"Z"),timeZone));
    }
    db.exec("COMMIT");
  } catch(e){db.exec("ROLLBACK");throw e;}
  db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  // A terminated AI request never resumes spending automatically.
  db.prepare(
    "UPDATE ai_usage SET status='interrupted' WHERE status='running'",
  ).run();
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
