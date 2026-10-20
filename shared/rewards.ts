export const workloadStars = { short: 1, compact: 2, standard: 3, long: 4 } as const;
export type Workload = keyof typeof workloadStars;
export interface RewardBook { band: number | null; workload: Workload | null; review: boolean; words?: number | null; wordCountSource?: string; }
export const wordBands = [
  {min:1,max:1499,stars:1},{min:1500,max:7499,stars:2},
  {min:7500,max:14999,stars:3},{min:15000,max:29999,stars:4},
  {min:30000,max:49999,stars:5},{min:50000,max:74999,stars:7},
  {min:75000,max:99999,stars:9},{min:100000,max:10_000_000,stars:11},
] as const;
export function wordCountBase(words: number | null | undefined): number | null {
  if(!words || !Number.isInteger(words) || words<1 || words>10_000_000)return null;
  return wordBands.find(b=>words>=b.min && words<=b.max)?.stars ?? null;
}
export function questionCount(words: number | null | undefined): 5 | 10 {return words && words>=50_000 ? 10 : 5;}
export function passingScore(total: number) {return Math.ceil(total*0.8);}
export function passedAttempt(attempt: {score:number|null;questions:string}) {
  const total=JSON.parse(attempt.questions).length;
  return total>0 && attempt.score!==null && attempt.score>=passingScore(total);
}
export const readingBands = ["Emergent", "Simple connected text", "Developing independent reader", "Sustained / layered narrative", "Advanced / dense text"];
export function suggestReward(book: RewardBook, readerBand: number | null, effort?: "easy" | "comfortable" | "stretch") {
  const delta = book.band && readerBand ? book.band - readerBand : null;
  // Prices always use saved reader/book bands. A descriptive effort field or
  // stale client cannot silently replace the deterministic multiplier.
  const selected = delta === null || delta === 0 ? "comfortable" : delta < 0 ? "easy" : "stretch";
  const base=wordCountBase(book.words);
  const multiplierTenths=10+2*Math.max(-2,Math.min(2,delta ?? 0));
  const stars=base===null ? null : Math.max(1,Math.floor((base*multiplierTenths+5)/10));
  return {stars,base,multiplier:multiplierTenths/10,effort:selected,questionCount:questionCount(book.words),needsParent:book.review || base===null || !book.band || !readerBand};
}
export function readingDay(date: Date, timeZone="UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
