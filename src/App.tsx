import { passingScore } from "../shared/rewards";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import type { Session, Shelf, Child, Attempt, LibraryBook, Assignment } from "./types";
import {
  BookMark,
  Empty,
  Field,
  PinDialog,
  Star,
} from "./components";
import { Parent } from "./Parent";
import { ShelfView } from "./Shelf";
import { ReaderPicker } from "./ReaderPicker";

export function App() {
  const [session, setSession] = useState<Session | null>(null),
    [shelf, setShelf] = useState<Shelf | null>(null),
    // Shared tablets require an explicit reader choice on every page load.
    [childId, setChildId] = useState(""),
    [parent, setParent] = useState(false),
    [pin, setPin] = useState<{
      title: string;
      run: (pin: string) => Promise<void>;
    } | null>(null),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh(lockParent = false) {
    const s = await api<Session>("/session");
    if (lockParent && s.authenticated && s.parent) {
      await api("/parent/lock", "POST");
      s.parent = false;
    }
    setSession(s);
    if (s.authenticated) setShelf(await api<Shelf>("/shelf"));
    else {
      setShelf(null);
      setParent(false);
      setAttempt(null);
      setChildId("");
    }
  }
  useEffect(() => {
    refresh(true).catch((e) => setError(e.message));
  }, []);
  useEffect(()=>{
    if(!shelf || parent)return;
    const day=Object.values(shelf.daily)[0]?.day;
    if(!day)return;
    const update=()=>api<Shelf>("/shelf").then(setShelf).catch(()=>{});
    const next=new Date(`${day}T00:00:00-07:00`).getTime()+86400000;
    const timer=window.setTimeout(update,Math.max(1000,next-Date.now()+100));
    const focus=()=>{if(document.visibilityState==="visible")void update();};
    document.addEventListener("visibilitychange",focus);
    return ()=>{window.clearTimeout(timer);document.removeEventListener("visibilitychange",focus);};
  },[shelf,parent]);
  useEffect(() => {
    if (!parent) return;
    const timer = window.setTimeout(() => {
      setParent(false);
      setPin(null);
      api("/parent/lock", "POST").catch(() => {});
    }, 10 * 60000);
    return () => window.clearTimeout(timer);
  }, [parent]);
  const child = shelf?.children.find((c) => c.id === childId);
  function choose(c: Child) {
    setChildId(c.id);
    setAttempt(null);
    setError("");
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 401) await refresh();
    } finally {
      setBusy(false);
    }
  }
  function openParent() {
    setPin({
      title: "Open the parent corner",
      run: async (value) => {
        await api("/parent/unlock", "POST", { pin: value });
        setParent(true);
        setAttempt(null);
        await refresh();
      },
    });
  }
  async function leaveParent() {
    await api("/parent/lock", "POST");
    setParent(false);
    setChildId("");
    await refresh();
  }
  async function start(a: Assignment) {
    await run(async () =>
      setAttempt(await api<Attempt>(`/assignments/${a.id}/start`, "POST")),
    );
  }
  const currentAssignment = shelf?.assignments.find(
      (a) => a.id === attempt?.assignmentId,
    ),
    currentBook = shelf?.books.find((b) => b.id === currentAssignment?.book_id);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Reading Stars home">
          <BookMark />
          <span>
            reading
            <span className="brand-stars">
              stars
              <Star />
            </span>
          </span>
        </a>
        {session?.authenticated ? (
          <nav aria-label="Main navigation">
            <button
              className="nav-button"
              onClick={() =>
                run(async () => {
                  if (parent) await leaveParent();
                  setAttempt(null);
                })
              }
            >
              Bookshelf
            </button>
            <button
              className={`nav-button ${parent ? "active" : ""}`}
              onClick={openParent}
            >
              Parent corner <span aria-hidden="true">↗</span>
            </button>
            <ReaderPicker
              readers={shelf?.children || []}
              child={child}
              stars={child && shelf ? shelf.assignments.filter(a=>a.child_id===child.id && a.status==="completed").reduce((sum,a)=>sum+a.stars,0) : 0}
              busy={busy}
              quizOpen={!!attempt}
              parentMode={parent}
              onChoose={reader=>run(async()=>{ if(parent)await leaveParent(); choose(reader); })}
              onSignOut={()=>run(async()=>{ await api("/logout","POST"); await refresh(); })}
            />
          </nav>
        ) : (
          <span className="header-tag">BIG ADVENTURES START SMALL</span>
        )}
      </header>
      {error ? (
        <div className="error banner" role="alert">
          {error}
          <button className="text-button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      ) : null}
      {!session ? (
        <main>
          <div className="empty">
            {error
              ? "The bookshelf is unavailable."
              : "Opening your bookshelf…"}
            {error ? (
              <button onClick={() => run(refresh)}>Try again</button>
            ) : null}
          </div>
        </main>
      ) : !session.authenticated ? (
        <Auth session={session} onDone={() => refresh(true)} />
      ) : parent ? (
        <Parent
          onLock={() => run(leaveParent)}
          onExpired={() => {
            setParent(false);
            openParent();
          }}
        />
      ) : attempt && currentBook ? (
        <QuizView
          key={attempt.id}
          initial={attempt}
          book={currentBook}
          onBack={() =>
            run(async () => {
              setAttempt(null);
              await refresh();
            })
          }
          onComplete={refresh}
        />
      ) : shelf && shelf.children.length && !child ? (
        <main className="choose-reader-page">
          <div className="choose-reader-art" aria-hidden="true"><BookMark/><Star/></div>
          <div className="eyebrow">YOUR OWN READING ADVENTURE</div>
          <h1>Who’s ready for a story?</h1>
          <p>Choose your name at the top.<br/>Your books and stars will be waiting for you.</p>
        </main>
      ) : shelf && child ? (
        <main>
          <section className="hero">
            <div>
              <div className="eyebrow">YOUR NEXT ADVENTURE IS WAITING</div>
              <h1>
                Find a book.
                <br />
                <span>Let the adventure begin.</span>
              </h1>
              <p>
                Dragons, mysteries, and brand-new worlds.
                <br />
                Show what you know and watch your stars grow.
              </p>
            </div>
            <div className="hero-art" aria-hidden="true">
              <span className="orbit orbit-one">✦</span>
              <span className="orbit orbit-two">✧</span>
              <div className="art-book book-back"></div>
              <div className="art-book book-front">
                <BookMark />
                <span>
                  ONE MORE
                  <br />
                  ADVENTURE
                </span>
                <Star />
              </div>
              <div className="art-label">Every story is a discovery.</div>
            </div>
          </section>
          <ShelfView
            key={child.id}
            shelf={shelf}
            child={child}
            busy={busy}
            onStart={start}
            onChoose={async (book) => {
              let chosen = false;
              await run(async () => {
                await api(`/library/${book.id}/choose`, "POST", { childId: child.id });
                await refresh();
                chosen = true;
              });
              return chosen;
            }}
            onRetry={(a) =>
              setPin({
                title: "Ready for another try?",
                run: async (value) => {
                  await api(`/parent/assignments/${a.id}/retry`, "POST", {
                    pin: value,
                  });
                  await refresh();
                },
              })
            }
          />
          <section
            className="how-it-works"
            aria-label="How to earn reading stars"
          >
            {[
              ["01", "Find your adventure", "Pick a book from your shelf."],
              [
                "02",
                "Show what you know",
                "A few questions. Big discoveries.",
              ],
              ["03", "Share & shine", "Tell a grown-up, then earn your stars."],
            ].map(([n, title, text]) => (
              <div key={n}>
                <span>{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </section>
        </main>
      ) : (
        <main>
          <Empty title="Your bookshelf is ready">
            Open the parent corner to add a reader.
          </Empty>
        </main>
      )}
      <footer>
        <span>Made for curious minds.</span>
        <span>Your family chooses the rewards. A grown-up approves earned stars.</span>
      </footer>
      {pin ? (
        <PinDialog
          title={pin.title}
          onSubmit={pin.run}
          onClose={() => setPin(null)}
        />
      ) : null}
    </div>
  );
}
function Auth({
  session,
  onDone,
}: {
  session: Session;
  onDone: () => Promise<void>;
}) {
  const [password, setPassword] = useState(""),
    [pin, setPin] = useState(""),
    [setupToken, setSetupToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        session.setup ? "/setup" : "/login",
        "POST",
        session.setup ? { password, pin, setupToken } : { password },
      );
      setPassword("");
      setPin("");
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="welcome">
      <section>
        <div className="eyebrow">A BOOKSHELF FULL OF POSSIBILITY</div>
        <h1>
          A little reading.
          <br />
          <span>A lot to discover.</span>
        </h1>
        <p>
          Your family’s place to celebrate reading, understanding, and the next
          great story.
        </p>
        <div className="welcome-art" aria-hidden="true">
          <BookMark />
          <Star />
          <span>read · discover · shine</span>
        </div>
      </section>
      <form className="panel stack auth-form" onSubmit={submit}>
        <div className="eyebrow">
          {session.setup ? "LET’S GET STARTED" : "WELCOME BACK"}
        </div>
        <h2>
          {session.setup ? "Make room for adventure." : "Open your bookshelf."}
        </h2>
        <p>
          {session.setup
            ? "A grown-up sets this up once. Keep your parent PIN separate from the family password."
            : "Use the family password to sign in on this device."}
        </p>
        <Field
          label="Family password"
          hint={
            session.setup
              ? "At least 12 characters. A parent can sign in on each tablet."
              : undefined
          }
        >
          <input
            type="password"
            autoComplete={session.setup ? "new-password" : "current-password"}
            value={password}
            minLength={session.setup ? 12 : 1}
            maxLength={200}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {session.setup ? (
          <>
            <Field
              label="Parent PIN"
              hint="Six digits. Needed for parent controls and every retry."
            >
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Server setup token (if configured)">
              <input
                type="password"
                autoComplete="off"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button disabled={busy}>
          {busy
            ? "Opening…"
            : session.setup
              ? "Create our bookshelf"
              : "Let’s read"}{" "}
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </main>
  );
}
function QuizView({
  initial,
  book,
  onBack,
  onComplete,
}: {
  initial: Attempt;
  book: LibraryBook;
  onBack: () => void;
  onComplete: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState(initial.answers),
    [index, setIndex] = useState(0),
    [result, setResult] = useState<{ score: number; passed: boolean } | null>(
      initial.submitted
        ? { score: initial.score!, passed: initial.score! >= passingScore(initial.questions.length) }
        : null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [speechNote, setSpeechNote] = useState("");
  const question = initial.questions[index];
  useEffect(
    () => () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );
  async function save(next: Record<string, string>) {
    await api(`/attempts/${initial.id}/answers`, "PUT", { answers: next });
  }
  async function move(next: number) {
    setBusy(true);
    setError("");
    try {
      await save(answers);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setIndex(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ score: number; passed: boolean }>(
        `/attempts/${initial.id}/submit`,
        "POST",
        { answers },
      );
      setResult(r);
      await onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pause() {
    setBusy(true);
    try {
      if (!result) await save(answers);
      onBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function speak() {
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      setSpeechNote(
        "Read-aloud is unavailable on this device. Ask a grown-up to read with you.",
      );
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      `${question.prompt}. ${question.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join(". ")}`,
    );
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    utterance.onerror = () =>
      setSpeechNote(
        "The voice could not play. Ask a grown-up to read with you.",
      );
    window.speechSynthesis.speak(utterance);
  }
  return (
    <main className="quiz-layout">
      <button className="text-button" disabled={busy} onClick={pause}>
        ← {result ? "Back to bookshelf" : "Save & return to bookshelf"}
      </button>
      <div className="quiz-heading">
        <div className="eyebrow">SHOW WHAT YOU DISCOVERED</div>
        <h1>{book.title}</h1>
      </div>
      {result ? (
        <section className="panel quiz-result">
          <div className="result-star">
            <Star />
          </div>
          <h2>
            {result.passed
              ? "You’re ready to share!"
              : "Let’s give the story another look."}
          </h2>
          <p>
            You answered <strong>{result.score} of {initial.questions.length}</strong> questions
            correctly.
          </p>
          <p>
            {result.passed
              ? "Tell a grown-up what happened and why. They’ll help you finish this adventure and approve your stars."
              : "Ask a grown-up to go over the story with you. They can unlock another try with their PIN when you’re ready."}
          </p>
          <button onClick={onBack}>Back to my bookshelf</button>
        </section>
      ) : (
        <section className="panel quiz-panel">
          <div className="quiz-progress">
            <span>Question {index + 1} of {initial.questions.length}</span>
            <span>{Object.keys(answers).length} answered</span>
          </div>
          <progress max={initial.questions.length} value={index + 1} aria-label="Quiz progress" />
          <div className="quiz-tools">
            <span className="small-note">Take your time. You’ve got this.</span>
            <button className="secondary" type="button" onClick={speak}>
              ♫ Read to me
            </button>
          </div>
          <fieldset className="answer-group">
            <legend>{question.prompt}</legend>
            {question.options.map((option, i) => (
              <label
                key={option.id}
                className={`answer-choice ${answers[question.id] === option.id ? "chosen" : ""}`}
              >
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value={option.id}
                  checked={answers[question.id] === option.id}
                  onChange={() =>
                    setAnswers((a) => ({ ...a, [question.id]: option.id }))
                  }
                />
                <span className="answer-letter">
                  {String.fromCharCode(65 + i)}
                </span>
                <span>{option.text}</span>
              </label>
            ))}
          </fieldset>
          {speechNote ? (
            <p className="notice" role="status">
              {speechNote}
            </p>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="quiz-actions">
            <button
              className="secondary"
              disabled={busy || index === 0}
              onClick={() => move(index - 1)}
            >
              Back
            </button>
            {index < initial.questions.length - 1 ? (
              <button
                disabled={busy || answers[question.id] === undefined}
                onClick={() => move(index + 1)}
              >
                Next question →
              </button>
            ) : (
              <button
                disabled={busy || Object.keys(answers).length < initial.questions.length}
                onClick={finish}
              >
                {busy ? "Finishing…" : "Finish my quiz ✦"}
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
