import type { Child } from "./types";
import { Star } from "./components";

export function ReaderPicker({readers,child,stars,busy,quizOpen,parentMode,onChoose,onSignOut}:{
  readers:Child[];child?:Child;stars:number;busy:boolean;quizOpen:boolean;parentMode:boolean;
  onChoose:(child:Child)=>void;
  onSignOut:()=>void;
}) {
  return <section className={`reader-picker ${child || parentMode ? "has-reader" : "needs-reader"}`} aria-label="Current reader">
    <div className="reader-picker-control">
      <label htmlFor="current-reader">
        <span>{parentMode ? "Parent corner" : child ? "You’re reading as" : "Who’s reading?"}</span>
        <select id="current-reader" value={parentMode ? "__parent" : child?.id || ""} disabled={busy || quizOpen} onChange={event=>{
          if(event.target.value==="__signout") { onSignOut(); return; }
          const next=readers.find(reader=>reader.id===event.target.value);
          if(next)onChoose(next);
        }} aria-describedby="reader-picker-hint">
          <option value="" disabled>Your name…</option>
          {parentMode ? <option value="__parent" disabled>Parent corner</option> : null}
          {readers.map(reader=><option key={reader.id} value={reader.id}>{reader.name}</option>)}
          <option value="__signout">Sign out</option>
        </select>
      </label>
    </div>
    {child && !parentMode ? <div className="reader-picker-stars" aria-label={`${child.name}: ${stars} reading stars earned`}><Star/><strong>{stars}</strong></div> : null}
    <p id="reader-picker-hint">{quizOpen ? "Save and return before switching readers or signing out." : parentMode ? "Choose a reader to leave parent mode, or sign out." : "Choose your name or sign out."}</p>
  </section>;
}
