import { passingScore } from "./rewards.ts";
export type AttemptResult = "passed" | "failed" | "progress";
export interface ActivityAttempt {
  id: string;
  assignment_id: string;
  created: string;
  submitted: string | null;
  score: number | null;
  questions: {id:string}[];
  answers: Record<string,string>;
}
export function attemptResult(attempt: ActivityAttempt): AttemptResult {
  if(!attempt.submitted)return "progress";
  return (attempt.score ?? 0)>=passingScore(attempt.questions.length) ? "passed" : "failed";
}
export function activityDate(timestamp: string): Date {
  const iso=timestamp.replace(" ","T");
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso)?iso:iso+"Z");
}
export function activityTime(timestamp:string,timeZone="UTC") {
  return new Intl.DateTimeFormat("en-US",{timeZone,month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}).format(activityDate(timestamp));
}
export function activityRows<T extends ActivityAttempt>(attempts:T[]) {
  // The parent API supplies attempts in creation order, newest first. Keep
  // retry numbers tied to creation order, even when a paused quiz finishes later.
  const counts=new Map<string,number>(),numbers=new Map<string,number>();
  for(const attempt of [...attempts].reverse()){
    const n=(counts.get(attempt.assignment_id) || 0)+1;
    counts.set(attempt.assignment_id,n);numbers.set(attempt.id,n);
  }
  return attempts.map(attempt=>({...attempt,attemptNumber:numbers.get(attempt.id)!,result:attemptResult(attempt)}))
    .sort((a,b)=>activityDate(b.submitted || b.created).getTime()-activityDate(a.submitted || a.created).getTime());
}
