import { useState } from "react";
import { bookSeries, compareBooks, matchesBook } from "../shared/library";
import { BookCover, Empty, Star } from "./components";
import type { Assignment, Child, LibraryBook, Shelf } from "./types";

type View = "explore" | "reading" | "completed";
const formats = [["all","Every kind"],["early","Picture books"],["chapter","Chapter books"],["graphic","Comics"],["nonfiction","Fact books"]];
const seriesIcons: Record<string,string> = {"Percy Jackson":"⚡","Narnia":"🦁","Magic Tree House":"🌳","Junie B. Jones":"🎒","Judy Moody":"🌈","Olivia":"🎨"};

export function ShelfView({shelf,child,busy,onChoose,onStart,onRetry}:{
  shelf:Shelf;child:Child;busy:boolean;
  onChoose:(book:LibraryBook)=>Promise<boolean>;
  onStart:(assignment:Assignment)=>void;
  onRetry:(assignment:Assignment)=>void;
}) {
  const [view,setView]=useState<View>("explore"),[query,setQuery]=useState(""),[series,setSeries]=useState("all"),[format,setFormat]=useState("all"),[message,setMessage]=useState("");
  const books=shelf.books.filter(b=>b.coverId);
  const mine=new Map(shelf.assignments.filter(a=>a.child_id===child.id).map(a=>[a.book_id,a]));
  const completed=books.filter(b=>mine.get(b.id)?.status==="completed");
  const reading=books.filter(b=>{const a=mine.get(b.id);return a && a.status!=="completed";});
  const seriesNames=[...new Set(books.map(b=>bookSeries(b)?.name).filter((s):s is string=>!!s))].sort();
  const matches=books.filter(b=>{
    const a=mine.get(b.id);
    return (view==="explore" || (view==="completed" ? a?.status==="completed" : a && a.status!=="completed")) &&
      matchesBook(b,query) && (series==="all" || (series==="other" ? !bookSeries(b) : bookSeries(b)?.name===series)) && (format==="all" || b.format===format);
  }).sort(compareBooks);
  const groups=new Map<string,LibraryBook[]>();
  for(const book of matches){const name=bookSeries(book)?.name || "More adventures";groups.set(name,[...(groups.get(name)||[]),book]);}
  const orderedGroups=[...groups].sort(([a],[b])=>a==="More adventures"?1:b==="More adventures"?-1:a.localeCompare(b));
  function changeView(next:View){setView(next);setMessage("");}
  function clear(){setQuery("");setSeries("all");setFormat("all");}
  async function choose(book:LibraryBook){
    if(await onChoose(book))setMessage(`${book.title} is in My books! Find your copy, enjoy the story, then come back for your quiz.`);
  }
  return <section className="shelf-section shared-library" aria-labelledby="bookshelf-title">
    <div className="section-heading">
      <div><div className="eyebrow">SO MANY STORIES TO DISCOVER</div><h2 id="bookshelf-title">Pick your next adventure <span className="heading-dot" aria-hidden="true">✦</span></h2><p>Every book is here for you, {child.name}. What looks fun today?</p></div>
      <div className="reader-achievement"><Star/><span><strong>{completed.length}</strong> adventures finished</span></div>
    </div>
    <p className="choice-message" role="status">{shelf.daily[child.id]?.remaining ? `🌟 ${shelf.daily[child.id].remaining} book ${shelf.daily[child.id].remaining===1?"finish":"finishes"} left today. Each book earns its full stars!` : "🎉 Two book quizzes passed today! Keep exploring and reading. New book quizzes return tomorrow."}</p>
    <div className="shelf-tabs discover-tabs" role="group" aria-label="Bookshelf filter">
      {([["explore","🧭","Explore",books.length],["reading","📖","My books",reading.length],["completed","🏆","Finished",completed.length]] as const).map(([id,icon,label,count])=><button key={id} className={view===id?"selected":""} aria-pressed={view===id} onClick={()=>changeView(id)}><span aria-hidden="true" className="tab-icon">{icon}</span>{label}<span>{count}</span></button>)}
    </div>
    <div className="discovery-tools">
      <label className="book-search"><span>Find a book</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Book, author, or series…" maxLength={200}/></label>
      <label className="book-kind"><span>What kind?</span><select value={format} onChange={e=>setFormat(e.target.value)}>{formats.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
    </div>
    <div className="series-picker" role="group" aria-label="Choose a series">
      <button className={series==="all"?"selected":""} aria-pressed={series==="all"} onClick={()=>setSeries("all")}><span aria-hidden="true">✨</span> All shelves</button>
      {seriesNames.map(name=><button key={name} className={series===name?"selected":""} aria-pressed={series===name} onClick={()=>setSeries(name)}><span aria-hidden="true">{seriesIcons[name]||"📚"}</span>{name}</button>)}
      {books.some(b=>!bookSeries(b))?<button className={series==="other"?"selected":""} aria-pressed={series==="other"} onClick={()=>setSeries("other")}><span aria-hidden="true">🚀</span> More adventures</button>:null}
    </div>
    <p className="discovery-summary" role="status">{matches.length} {matches.length===1?"book":"books"} to {view==="completed"?"celebrate":view==="reading"?"keep exploring":"discover"}{query||series!=="all"||format!=="all"?<button className="text-button" onClick={clear}>Clear filters</button>:null}</p>
    {message?<div className="choice-message" role="status"><span aria-hidden="true">🌟</span><p>{message}</p><button className="secondary" onClick={()=>{clear();changeView("reading");}}>Go to My books</button></div>:null}
    {!books.length?<Empty title="New adventures are on their way!">A grown-up is getting your books and questions ready.</Empty>:!matches.length?<div className="discovery-empty"><Empty title={view==="completed"?"Your first finish is waiting!":view==="reading"&&!query&&series==="all"&&format==="all"?"Which story will you choose?":"Let’s try another shelf"}>{view==="completed"?"Read a book, take its quiz, and share the story with a grown-up.":view==="reading"?"Tap Explore to find a book you’d love to read.":"Try a different word, or clear your filters to see more adventures."}</Empty><button className="secondary" onClick={()=>{clear();changeView("explore");}}>Explore all books <span aria-hidden="true">→</span></button></div>:orderedGroups.map(([name,group])=><section className="series-shelf" key={name} aria-label={name}>
      <div className="series-heading"><span className="series-icon" aria-hidden="true">{seriesIcons[name]||"📚"}</span><div><h3>{name}</h3><p>{name==="Narnia"?"Adventures in publication order":group.some(b=>bookSeries(b)?.order)?"Follow the adventure, one book at a time":"Find a story that makes you curious"}</p></div><span className="series-count">{group.length} {group.length===1?"book":"books"}</span></div>
      <div className="book-grid">{group.map((book,index)=><LibraryCard key={book.id} book={book} childId={child.id} assignment={mine.get(book.id)} busy={busy} index={index} onChoose={()=>choose(book)} onStart={onStart} onRetry={onRetry}/>)}</div>
    </section>)}
  </section>;
}

function LibraryCard({book,childId,assignment:a,busy,index,onChoose,onStart,onRetry}:{book:LibraryBook;childId:string;assignment?:Assignment;busy:boolean;index:number;onChoose:()=>void;onStart:(a:Assignment)=>void;onRetry:(a:Assignment)=>void}) {
  const series=bookSeries(book),offer=book.offers[childId],stars=a?.stars??offer?.stars;
  return <article className="book-card">
    <div className="cover-wrap"><BookCover book={book} index={index}/><div className="star-badge"><Star/>{stars==null?"Parent reward":`${stars} ${stars===1?"star":"stars"}`}</div>{series?.order?<span className="volume-badge">Book {series.order}</span>:null}</div>
    <div className="book-card-body">
      <span className={`status ${a?.status||"new"}`}>{!a?"A new adventure":a.status==="reading"?"Your story is waiting":a.status==="retry_locked"?"Let’s look again":a.status==="review"?"Time to share!":"Adventure complete"}</span>
      <h4>{book.title}</h4><p>{book.author}</p>
      {!a?<><p className="book-hint">{offer?.quizReady===false?"A grown-up is preparing more questions for this adventure.":offer?.needsParent?"Ask a grown-up to check this adventure first.":`Read the book, then come back for ${offer?.questionCount ?? 5} questions.`}</p><button disabled={busy || offer?.quizReady===false} onClick={onChoose} aria-label={`Read ${book.title} next`}>{offer?.quizReady===false?"Questions coming soon":offer?.needsParent?"Ask a grown-up":"Read this next"} <span aria-hidden="true">→</span></button></>:a.status==="reading"?<><button disabled={busy || a.canComplete===false} onClick={()=>onStart(a)} aria-label={`Start quiz for ${book.title}`}>{a.canComplete===false?"Quiz tomorrow · keep reading!":"I’ve read it! Quiz time"} <span aria-hidden="true">→</span></button><p className="book-hint">Your {stars} agreed stars stay the same.</p></>:a.status==="retry_locked"?<><p className="book-hint">Explore the story with a grown-up before another try.</p><button disabled={busy} className="secondary" onClick={()=>onRetry(a)}>Parent unlock</button></>:a.status==="review"?<p className="book-hint">Tell a grown-up what you discovered. Your stars are almost here!</p>:<div className="completed-reward"><Star/><strong>+{stars} stars</strong><span>{a.award?.recorded?"Reward recorded":"A grown-up will record your reward"}</span></div>}
    </div>
  </article>;
}
