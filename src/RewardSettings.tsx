import { useState } from "react";
import { api } from "./api";
import { readingBands,wordBands,wordCountBase,questionCount,type RewardBook } from "../shared/rewards";
import { Field,Notice } from "./components";
import { compareBooks,matchesBook } from "../shared/library";
import type { ParentData } from "./types";

export function RewardSettings({data,busy,save}:{data:ParentData;busy:boolean;save:(fn:()=>Promise<void>)=>void}) {
  const [query,setQuery]=useState("");
  return <section className="stack">
    <h2>Rewards for future adventures</h2>
    <Notice>Word count sets the base stars. Multiply by 0.6 / 0.8 / 1 / 1.2 / 1.4 for books two or more bands below / one below / at / one above / two or more above the reader. Round to the nearest whole star, minimum 1. Books with 50,000 words or more use 10 questions; shorter books use 5. Existing adventures keep their original quiz length. Two rewarded book finishes per reader each day in {data.timeZone}. A passed quiz reserves a finish while it waits for your discussion. Existing adventures keep their agreed reward.</Notice>
    <details className="panel"><summary>Word-count star bands</summary><ul>{wordBands.map(b=><li key={b.min}>{b.min.toLocaleString()}–{b.max===10_000_000?"and up":b.max.toLocaleString()} words: {b.stars} base stars</li>)}</ul></details>
    <h3>Reader bands</h3>
    <p>These starter bands are provisional. Check a passage and retelling before adjusting them. Format preference and age alone do not measure reading ability.</p>
    {data.children.map(c=><form key={`${c.id}-${c.readingBand}`} className="panel stack" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);save(async()=>{await api(`/parent/children/${c.id}/reward`,"PUT",{band:form.get("band")?Number(form.get("band")):null});});}}>
      <Field label={`${c.name}’s reading band`}><select name="band" defaultValue={c.readingBand || ""}><BandOptions/></select></Field><button disabled={busy}>Save {c.name}’s band</button>
    </form>)}
    <h3>Book difficulty and word count</h3>
    <p>Picture books and comics can be challenging too. Word counts must match the edition and reading scope. Missing classifications or flagged editions need a parent check. Difficulty two or more bands above is capped at ×1.4; it does not require a separate price negotiation.</p>
    <Field label="Find reward settings"><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Title, author, or series"/></Field>
    {data.books.filter(b=>matchesBook(b,query)).sort(compareBooks).map(b=><BookReward key={`${b.id}-${JSON.stringify(b.reward)}`} id={b.id} title={b.title} reward={b.reward} busy={busy} save={save}/>)}
  </section>;
}
function BandOptions(){return <><option value="">Needs a parent check</option>{readingBands.map((name,i)=><option key={name} value={i+1}>Band {i+1} · {name}</option>)}</>;}
function BookReward({id,title,reward,busy,save}:{id:string;title:string;reward:RewardBook;busy:boolean;save:(fn:()=>Promise<void>)=>void}) {
  const [value,setValue]=useState(reward);
  return <details className="panel"><summary>{title} · {wordCountBase(value.words) ? `${wordCountBase(value.words)} base stars · ${questionCount(value.words)} questions` : "Set word count"}</summary>
    <form className="stack" onSubmit={e=>{e.preventDefault();save(async()=>{await api(`/parent/books/${id}/reward`,"PUT",value);});}}>
      <Field label={`Difficulty for ${title}`}><select value={value.band || ""} onChange={e=>setValue(v=>({...v,band:e.target.value?Number(e.target.value):null}))}><BandOptions/></select></Field>
      <Field label={`Word count for ${title}`} hint="Use the actual text or a published count for this edition; leave blank if unknown."><input type="number" min="1" max="10000000" step="1" value={value.words ?? ""} onChange={e=>setValue(v=>({...v,words:e.target.value?Number(e.target.value):null}))}/></Field>
      <Field label={`Word-count source for ${title}`}><input value={value.wordCountSource ?? ""} maxLength={2000} placeholder="Published record URL or how you counted it" onChange={e=>setValue(v=>({...v,wordCountSource:e.target.value}))}/></Field>
      <label className="check"><input type="checkbox" checked={value.review} onChange={e=>setValue(v=>({...v,review:e.target.checked}))}/>Require a parent check (edition, reading section, or suitability)</label>
      <button disabled={busy}>Save reward settings</button>
    </form>
  </details>;
}
