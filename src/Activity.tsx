import {useState} from "react";
import {activityRows,activityTime,activityDate,type AttemptResult} from "../shared/activity";
import {Empty,Field} from "./components";
import type {ParentData} from "./types";

const labels={passed:"Passed",failed:"Didn’t pass",progress:"In progress"};
export function Activity({data,busy,onRefresh}:{data:ParentData;busy:boolean;onRefresh:()=>void}) {
  const [reader,setReader]=useState("all"),[result,setResult]=useState<AttemptResult|"all">("all"),[limit,setLimit]=useState(25);
  const assignments=new Map(data.assignments.map(a=>[a.id,a]));
  const books=new Map(data.books.map(b=>[b.id,b]));
  const children=new Map(data.children.map(c=>[c.id,c]));
  const history=activityRows(data.attempts).filter(a=>reader==="all" || assignments.get(a.assignment_id)?.child_id===reader);
  const filtered=history.filter(a=>result==="all" || a.result===result);
  return <section className="stack" aria-labelledby="activity-title">
    <div className="section-heading"><div><h2 id="activity-title">Reading activity</h2><p>Quiz starts, results, and retries. Times shown in {data.timeZone}.</p></div><button className="secondary" disabled={busy} onClick={onRefresh}>Refresh activity</button></div>
    <p className="small-note">Passing a quiz and approving its stars are separate steps. Rewards are reviewed in Review & stars.</p>
    <div className="form-grid">
      <Field label="Activity reader"><select value={reader} onChange={e=>{setReader(e.target.value);setLimit(25);}}><option value="all">All readers</option>{data.children.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Quiz result"><select value={result} onChange={e=>{setResult(e.target.value as AttemptResult|"all");setLimit(25);}}><option value="all">All results</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
    </div>
    <p role="status">{history.filter(a=>a.result==="passed").length} passed · {history.filter(a=>a.result==="failed").length} didn’t pass · {history.filter(a=>a.result==="progress").length} in progress</p>
    {!filtered.length?<Empty title={history.length?"No matching attempts":"No quiz activity yet"}>{history.length?"Choose another result to see more activity.":"Quiz attempts will appear here when a reader starts a test."}</Empty>:<>
      <ol className="activity-list" aria-label="Quiz activity, newest first">{filtered.slice(0,limit).map(a=>{
        const assignment=assignments.get(a.assignment_id),child=children.get(assignment?.child_id || ""),book=books.get(assignment?.book_id || "");
        return <li className="panel activity-entry" key={a.id}>
          <div className="section-heading"><div><div className="eyebrow">{child?.name || "Reader"} · Attempt {a.attemptNumber}</div><h3>{book?.title || "Book unavailable"}</h3></div><span className={`status activity-${a.result}`}>{labels[a.result]}</span></div>
          <p className="activity-score">{a.submitted?`${a.score ?? 0}/${a.questions.length} correct · ${Math.round((a.score ?? 0)/a.questions.length*100)}%`:`${Object.keys(a.answers).length}/${a.questions.length} answered`}</p>
          <p className="small-note">Started <time dateTime={activityDate(a.created).toISOString()}>{activityTime(a.created,data.timeZone)}</time>{a.submitted?<><br/>Finished <time dateTime={activityDate(a.submitted).toISOString()}>{activityTime(a.submitted,data.timeZone)}</time></>:null}</p>
        </li>;
      })}</ol>
      <p className="small-note">Showing {Math.min(limit,filtered.length)} of {filtered.length} attempts</p>
      {limit<filtered.length?<button className="secondary" onClick={()=>setLimit(n=>n+25)}>Show more activity</button>:null}
    </>}
  </section>;
}
