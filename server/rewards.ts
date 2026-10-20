import type { DB } from "./db.ts";
import { readingDay, suggestReward, type RewardBook } from "../shared/rewards.ts";
import { rewardCatalog } from "../shared/reward-catalog.ts";
import { wordCountCatalog } from "../shared/word-count-catalog.ts";

type Row = Record<string, any>;
const canonical = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
export function rewardStore(db: DB, now: () => Date, timeZone="UTC") {
  const book = (b: Row): RewardBook => {
    const saved = db.prepare("SELECT band,workload,review FROM reward_books WHERE book_id=?").get(b.id) as Row | undefined;
    const seed = rewardCatalog.find(s=>canonical(s.title)===canonical(b.title) && canonical(s.author)===canonical(b.author) && s.format===b.format);
    const wordOverride=db.prepare('SELECT words,source FROM book_word_counts WHERE book_id=?').get(b.id) as Row|undefined;
    const counted=wordCountCatalog.find(s=>canonical(s.title)===canonical(b.title) && canonical(s.author)===canonical(b.author) && s.format===b.format);
    return {...(saved ? {band:saved.band,workload:saved.workload,review:!!saved.review} : seed ? {band:seed.band,workload:seed.workload,review:seed.review} : {band:null,workload:null,review:true}),words:wordOverride ? wordOverride.words : counted?.words ?? null,wordCountSource:wordOverride ? wordOverride.source : counted?.source ?? ''};
  };
  const reader = (c: Row): number | null => {
    const saved=db.prepare("SELECT band FROM reward_readers WHERE child_id=?").get(c.id) as Row | undefined;
    if(saved)return saved.band;
    return null;
  };
  const daily = (childId: string) => {
    const day=readingDay(now(),timeZone);
    const used=(db.prepare("SELECT COUNT(*) n FROM daily_books WHERE child_id=? AND day=?").get(childId,day) as Row).n as number;
    return {day,used,remaining:Math.max(0,2-used),limit:2,timeZone};
  };
  const hasSlot = (assignmentId: string) => !!db.prepare("SELECT 1 FROM daily_books WHERE assignment_id=?").get(assignmentId);
  const canComplete = (a: Row) => hasSlot(a.id) || daily(a.child_id).remaining>0;
  // Call inside the same transaction as the successful submit or parent override.
  const reserve = (a: Row) => {
    if(hasSlot(a.id))return true;
    const state=daily(a.child_id);
    if(!state.remaining)return false;
    db.prepare("INSERT INTO daily_books(assignment_id,child_id,day) VALUES(?,?,?)").run(a.id,a.child_id,state.day);
    return true;
  };
  return {book,reader,daily,canComplete,reserve,suggest:(b:Row,c:Row,effort?:"easy"|"comfortable"|"stretch")=>suggestReward(book(b),reader(c),effort)};
}
