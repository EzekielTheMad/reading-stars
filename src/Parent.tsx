import { passingScore } from "../shared/rewards";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { BookCover, Empty, Field, Notice, PinDialog, Star } from "./components";
import type { ParentData, Child, Book, Assignment } from "./types";
import type { Effort, Quiz } from "../shared/schema";
import { BookEditor } from "./BookEditor";
import { bookSeries, compareBooks, matchesBook } from "../shared/library";
import { RewardSettings } from "./RewardSettings";
import { Activity } from "./Activity";

export function Parent({
  onLock,
  onExpired,
}: {
  onLock: () => void;
  onExpired: () => void;
}) {
  const [data, setData] = useState<ParentData | null>(null),
    [tab, setTab] = useState("overview"),
    [bookId, setBookId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [libraryFilter, setLibraryFilter] = useState("all"),
    [libraryQuery, setLibraryQuery] = useState(""),
    [newBook, setNewBook] = useState(false),
    [retry, setRetry] = useState<Assignment | null>(null);
  async function load() {
    const result = await api<ParentData>("/parent");
    setData(result);
    return result;
  }
  useEffect(() => {
    load().catch((e) => {
      if (e.status === 403) onExpired();
      else setError(e.message);
    });
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 401))
        onExpired();
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <main>
        <p>{error || "Opening the parent corner…"}</p>
      </main>
    );
  const owed = data.awards.filter((a) => !a.recorded),
    pending = data.assignments.filter(
      (a) => a.status === "review" || a.status === "retry_locked",
    );
  const book = data.books.find((b) => b.id === bookId);
  const libraryBooks = data.books.filter((b) => {
    const matchesQuery = matchesBook(b, libraryQuery);
    return matchesQuery && (libraryFilter === "all" ||
      (libraryFilter === "drafts" && !!b.draft && !b.readyForChildren) ||
      (libraryFilter === "ready" && b.readyForChildren) ||
      (libraryFilter === "questions" && !b.draft && !b.quizzes.length));
  });
  return (
    <main className="parent-page">
      <div className="section-heading">
        <div>
          <div className="eyebrow">A LITTLE GUIDANCE. A LOT OF GROWTH.</div>
          <h1>Parent corner</h1>
          <p>Celebrate understanding, one story at a time.</p>
        </div>
        <button className="secondary" onClick={onLock}>
          Lock & return to readers
        </button>
      </div>
      <div className="parent-tabs" role="group" aria-label="Parent sections">
        {[
          ["overview", "Review & stars"],
          ["activity", "Activity"],
          ["books", "Books & questions"],
          ["readers", "Readers"],
          ["assign", "New adventure"],
          ["rewards", "Reward settings"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => {
              setTab(id);
              setBookId("");
              setError("");
            }}
          >
            {label}
            {id === "overview" && pending.length ? (
              <span>{pending.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {tab === "overview" ? (
        <>
          <div className="summary-grid">
            {data.children.map((c) => {
              const awards = data.awards.filter((a) => a.child_id === c.id),
                owedStars = awards
                  .filter((a) => !a.recorded)
                  .reduce((n, a) => n + a.stars, 0);
              return (
                <div className="panel summary-card" key={c.id}>
                  <div className={`avatar ${c.color}`}>{c.name[0]}</div>
                  <h3>{c.name}</h3>
                  <div className="summary-stars">
                    <Star />
                    {owedStars}
                    <span>stars waiting to be recorded</span>
                  </div>
                  <small>
                    {awards.length} books approved ·{" "}
                    {awards.reduce((n, a) => n + a.stars, 0)} reading stars
                    earned
                  </small>
                </div>
              );
            })}
          </div>
          <section className="parent-section">
            <h2>Ready for a conversation</h2>
            <p className="muted">
              Ask for a brief retelling and a reason behind an important event.
              Listen for understanding beyond a memorized answer.
            </p>
            {pending.length ? (
              pending.map((a) => (
                <Review
                  key={a.id}
                  assignment={a}
                  data={data}
                  onApprove={(body) =>
                    run(async () => {
                      await api(
                        `/parent/assignments/${a.id}/approve`,
                        "POST",
                        body,
                      );
                      await load();
                    })
                  }
                  onRetry={() => setRetry(a)}
                  busy={busy}
                />
              ))
            ) : (
              <Empty title="All caught up">
                Finished quizzes will appear here for your quick check.
              </Empty>
            )}
          </section>
          <section className="parent-section">
            <h2>Record earned rewards</h2>
            <Notice>
              Give the agreed reward using your family’s system, then mark the matching award recorded here. Reading Stars does not transfer money or update another app.
            </Notice>
            {owed.length ? (
              <div className="award-list">
                {owed.map((a) => (
                  <div className="award-row" key={a.id}>
                    <div>
                      <strong>
                        {data.children.find((c) => c.id === a.child_id)?.name}
                      </strong>
                      <span>
                        {data.books.find((b) => b.id === a.book_id)?.title}
                      </span>
                    </div>
                    <span className="award-value">
                      <Star />
                      {a.stars}
                    </span>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(`/parent/awards/${a.id}/record`, "POST");
                          await load();
                        })
                      }
                    >
                      Mark reward recorded
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No stars waiting to be recorded.</p>
            )}
          </section>
          <details className="panel">
            <summary>Recorded awards & recent activity</summary>
            {data.awards
              .filter((a) => a.recorded)
              .map((a) => (
                <p key={a.id}>
                  {data.children.find((c) => c.id === a.child_id)?.name} ·{" "}
                  {data.books.find((b) => b.id === a.book_id)?.title} ·{" "}
                  {a.stars} stars · recorded {a.recorded}
                </p>
              ))}
            {data.audit.slice(0, 10).map((entry, i) => (
              <p className="small-note" key={i}>
                {entry.created} · {entry.action.replaceAll("_", " ")} ·{" "}
                {entry.detail}
              </p>
            ))}
          </details>
        </>
      ) : tab === "books" ? (
        book ? (
          <BookEditor
            key={book.id}
            book={book}
            aiAvailable={data.aiAvailable}
            onRefresh={load}
            onBack={() => setBookId("")}
          />
        ) : (
          <>
            <div className="section-heading">
              <div>
                <h2>The family library</h2>
                <p>
                  Prepare books here. Every reader can explore books with a cover and an approved quiz. Edition checks stay in parent mode.
                </p>
              </div>
              <button onClick={() => setNewBook(true)}>+ Add a book</button>
            </div>
            {data.books.length ? <div className="panel stack">
              <Field label="Find a book">
                <input type="search" value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)} placeholder="Title, author, or series" />
              </Field>
              <div className="parent-tabs" role="group" aria-label="Library preparation filter">
                {[["all", "All books"], ["drafts", "Quiz drafts"], ["ready", "Shared library"], ["questions", "Needs questions"]].map(([id,label]) =>
                  <button key={id} className={libraryFilter === id ? "selected" : ""} aria-pressed={libraryFilter === id} onClick={() => setLibraryFilter(id)}>{label}</button>)}
              </div>
              <p className="small-note">{libraryBooks.length} of {data.books.length} books · Preparation stays in the parent corner.</p>
            </div> : null}
            {data.books.length ? (
              <div className="library-grid">
                {libraryBooks.map((b, i) => (
                  <button
                    className="library-item"
                    key={b.id}
                    onClick={() => setBookId(b.id)}
                  >
                    <BookCover book={b} index={i} />
                    <span>
                      <strong>{b.title}</strong>
                      <small>{b.author}</small>
                      <span className="status">
                        {b.readyForChildren
                          ? `Shared with every reader${b.confirmed ? "" : " · Edition check pending"}`
                          : `${b.draft ? "Quiz draft" : "Parent preparation"} · ${b.preparationNeeds.join(" · ")}`}
                      </span>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty title="Start with a familiar favorite">
                Add a book you own, then prepare a quiz for that exact
                book.
              </Empty>
            )}
            {data.books.length && !libraryBooks.length ? <Empty title="No books match this view">
              Try another title or choose All books. Books join the shared library after cover and quiz review.
            </Empty> : null}
          </>
        )
      ) : tab === "activity" ? (
        <Activity data={data} busy={busy} onRefresh={()=>run(async()=>{await load();})}/>
      ) : tab === "rewards" ? (
        <RewardSettings data={data} busy={busy} save={fn=>run(async()=>{await fn();await load();})}/>
      ) : tab === "readers" ? (
        <div className="reader-editor-grid">
          {data.children.map((c) => (
            <ReaderForm
              key={c.id}
              child={c}
              busy={busy}
              onSave={(value) =>
                run(async () => {
                  await api(`/parent/children/${c.id}`, "PUT", value);
                  await load();
                })
              }
            />
          ))}
          <ReaderForm
            key="new"
            busy={busy}
            onSave={(value) =>
              run(async () => {
                await api("/parent/children", "POST", value);
                await load();
              })
            }
          />
        </div>
      ) : (
        <AssignForm
          data={data}
          onSave={(body) =>
            run(async () => {
              await api("/parent/assignments", "POST", body);
              await load();
              setTab("overview");
            })
          }
          busy={busy}
        />
      )}
      {newBook ? (
        <NewBook
          onClose={() => setNewBook(false)}
          onCreated={async (id) => {
            await load();
            setBookId(id);
            setNewBook(false);
          }}
        />
      ) : null}
      {retry ? (
        <PinDialog
          title="Unlock one more attempt"
          onClose={() => setRetry(null)}
          onSubmit={async (pin) => {
            await api(`/parent/assignments/${retry.id}/retry`, "POST", { pin });
            await load();
          }}
        />
      ) : null}
    </main>
  );
}
function ReaderForm({
  child,
  busy,
  onSave,
}: {
  child?: Child;
  busy: boolean;
  onSave: (value: Omit<Child, "id">) => void;
}) {
  const [value, setValue] = useState<Omit<Child, "id">>(
      child || { name: "", age: 6, profile: "", confidence: "", color: "blue" },
    ),
    [saved, setSaved] = useState(false);
  function update(key: string, v: string | number) {
    setValue((s) => ({ ...s, [key]: v }));
    setSaved(false);
  }
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
        setSaved(true);
      }}
    >
      <h2>{child ? "Reading profile" : "Add a reader"}</h2>
      <Field label="Reader name">
        <input
          value={value.name}
          maxLength={40}
          required
          onChange={(e) => update("name", e.target.value)}
        />
      </Field>
      <div className="form-grid">
        <Field label="Age">
          <input
            type="number"
            min={3}
            max={18}
            required
            value={value.age}
            onChange={(e) => update("age", Number(e.target.value))}
          />
        </Field>
        <Field label="Profile color">
          <select
            value={value.color}
            onChange={(e) => update("color", e.target.value)}
          >
            <option value="green">Forest</option>
            <option value="orange">Sunshine</option>
            <option value="blue">Ocean</option>
            <option value="purple">Berry</option>
          </select>
        </Field>
      </div>
      <Field
        label="Reading ability & example books"
        hint="Describe what feels easy, comfortable, or challenging. This is not a formal reading-level assessment."
      >
        <textarea
          rows={4}
          value={value.profile}
          maxLength={2000}
          onChange={(e) => update("profile", e.target.value)}
        />
      </Field>
      <Field
        label="Confidence & preferred formats"
        hint="Enjoying pictures or feeling hesitant about a format is separate from reading ability."
      >
        <textarea
          rows={3}
          value={value.confidence}
          maxLength={1000}
          onChange={(e) => update("confidence", e.target.value)}
        />
      </Field>
      <button disabled={busy}>
        {busy ? "Saving…" : child ? "Save profile" : "Add reader"}
      </button>
      {saved && !busy ? (
        <small>Changes submitted. Check any message above.</small>
      ) : null}
    </form>
  );
}
function NewBook({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  const [title, setTitle] = useState(""),
    [author, setAuthor] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [createdId, setCreatedId] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!title && !file)
        throw new Error("Enter a title or choose a book file.");
      let id = createdId;
      if (!id) {
        const result = await api<{ id: string }>("/parent/books", "POST", {
          title: title || "Book to identify",
          author: author || "To confirm",
        });
        id = result.id;
        setCreatedId(id);
      }
      if (file) {
        const form = new FormData();
        form.append("file", file);
        await api(`/parent/books/${id}/upload`, "POST", form);
      }
      await onCreated(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      className="panel modal-card"
      aria-labelledby="new-book-title"
    >
      <form className="stack" onSubmit={submit}>
        <div className="eyebrow">ONE MORE ADVENTURE</div>
        <h2 id="new-book-title">Add a book</h2>
        <Field label="Book title">
          <input
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!!createdId}
          />
        </Field>
        <Field label="Author">
          <input
            value={author}
            maxLength={150}
            onChange={(e) => setAuthor(e.target.value)}
            disabled={!!createdId}
          />
        </Field>
        <Field
          label="Book or cover (optional)"
          hint="PDF or unencrypted EPUB, up to 20 MB. Cover images: PNG, JPEG, or WebP, up to 5 MB."
        >
          <input
            type="file"
            accept=".pdf,.epub,.png,.jpg,.jpeg,.webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </Field>
        <p className="small-note">
          For a physical book, enter its title now. Confirm the edition and find
          online sources in the next step.
        </p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button disabled={busy}>
            {busy ? "Adding…" : createdId ? "Retry upload" : "Add to library"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </form>
    </dialog>
  );
}
function AssignForm({
  data,
  onSave,
  busy,
}: {
  data: ParentData;
  onSave: (body: unknown) => void;
  busy: boolean;
}) {
  const books = data.books.filter((b) => b.readyForChildren).sort(compareBooks),
    [childId, setChildId] = useState(data.children[0]?.id || ""),
    [bookId, setBookId] = useState(books[0]?.id || ""),
    [effort, setEffort] = useState<Effort | "">(""),
    [stars, setStars] = useState(1),
    [rationale, setRationale] = useState(""),
    [suggesting, setSuggesting] = useState(false),
    [error, setError] = useState(""),
    [bookQuery, setBookQuery] = useState("");
  async function suggest() {
    setSuggesting(true);
    setError("");
    try {
      const result = await api<{
        effort: Effort;
        stars: number | null;
        rationale: string;
      }>("/parent/suggest", "POST", {
        childId,
        bookId,
        ...(effort ? { effort } : {}),
      });
      if(result.stars===null)throw new Error("Set the book’s word count and difficulty in Reward settings first.");
      setEffort(result.effort);
      setStars(result.stars);
      setRationale(result.rationale);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }
  if (!books.length)
    return (
      <Empty title="Prepare a book first">
        Go to Books & questions, add a cover, and approve
        its questions. Ready books are available to every reader.
      </Empty>
    );
  const child = data.children.find((c) => c.id === childId);
  return (
    <form
      className="panel stack assign-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          childId,
          bookId,
          effort: effort || "comfortable",
          stars,
          rationale,
        });
      }}
    >
      <Notice>Ready books are available to every reader. New rewards use word-count base stars multiplied by relative difficulty (×0.6 to ×1.4). Books with 50,000+ words use ten questions; shorter books use five. Use this form for a parent-agreed reward before the child chooses a book. Existing adventures keep their original reward.</Notice>
      <div className="eyebrow">AGREE ON THE REWARD BEFORE READING</div>
      <h2>A new reading adventure</h2>
      <Field label="Search books to assign"><input type="search" value={bookQuery} onChange={e=>setBookQuery(e.target.value)} placeholder="Find title, author, or series" /></Field>
      <div className="form-grid">
        <Field label="Reader">
          <select
            value={childId}
            onChange={(e) => {
              setChildId(e.target.value);
              setEffort("");
              setRationale("");
            }}
          >
            {data.children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Book">
          <select
            value={bookId}
            onChange={(e) => {
              setBookId(e.target.value);
              setEffort("");
              setRationale("");
            }}
          >
            {books.filter(b=>b.id===bookId || matchesBook(b,bookQuery)).map((b) => (
              <option key={b.id} value={b.id}>
                {bookSeries(b)?.name ? `${bookSeries(b)!.name} · ` : ""}{b.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Notice>
        <strong>{child?.name}’s profile:</strong>{" "}
        {child?.profile || "No reading notes yet."}
        <br />
        {child?.confidence}
      </Notice>
      <p className="muted">The suggested multiplier uses the saved reader and book bands. Change those in Reward settings if needed. A custom parent-agreed reward remains available below.</p>
      <button
        className="secondary"
        type="button"
        onClick={suggest}
        disabled={suggesting}
      >
        {suggesting ? "Considering…" : "Suggest stars"}
      </button>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {rationale ? (
        <>
          <Notice>{rationale}</Notice>
          <Field
            label="Agreed reward"
            hint="The agreed reward stays fixed for this adventure, including retries."
          >
            <input
              type="number"
              min={1}
              max={100}
              required
              value={stars}
              onChange={(e) => setStars(Number(e.target.value))}
            />
          </Field>
          <button disabled={busy}>
            {busy ? "Saving…" : `Assign adventure · ${stars} stars`}
          </button>
        </>
      ) : null}
    </form>
  );
}
function Review({
  assignment: a,
  data,
  onApprove,
  onRetry,
  busy,
}: {
  assignment: Assignment;
  data: ParentData;
  onApprove: (body: unknown) => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const attempt = data.attempts.find(
      (t) => t.assignment_id === a.id && t.submitted,
    ),
    child = data.children.find((c) => c.id === a.child_id),
    book = data.books.find((b) => b.id === a.book_id),
    [checked, setChecked] = useState(false),
    [override, setOverride] = useState(false),
    [reason, setReason] = useState("");
  if (!attempt) return null;
  return (
    <article className="panel review-card">
      <div className="section-heading">
        <div>
          <div className="eyebrow">{child?.name}</div>
          <h3>{book?.title}</h3>
          <p>
            {attempt.score}/{attempt.questions.length} correct · {a.stars} stars agreed
          </p>
        </div>
        <span className={`status ${a.status}`}>
          {a.status === "review" ? "Ready to discuss" : "Review & revisit"}
        </span>
      </div>
      <blockquote>{attempt.quiz.discussion}</blockquote>
      <details>
        <summary>Review questions & answers</summary>
        {attempt.questions.map((picked, i) => {
          const q = attempt.quiz.questions.find((q) => q.id === picked.id)!;
          const choice = attempt.answers[q.id];
          return (
            <div className="review-question" key={q.id}>
              <strong>
                {i + 1}. {q.prompt}
              </strong>
              <p>
                Child chose:{" "}
                {choice === undefined
                  ? "No answer"
                  : q.options[picked.order[Number(choice)]]}
              </p>
              <p>Correct answer: {q.options[q.correct]}</p>
              <p>{q.explanation}</p>
              <small>Reference: {q.reference}</small>
            </div>
          );
        })}
      </details>
      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        We discussed the book and I’m satisfied they understood it.
      </label>
      {(attempt.score || 0) < passingScore(attempt.questions.length) ? (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            Approve an exception for a flawed question or demonstrated
            understanding.
          </label>
          {override ? (
            <Field label="Why this exception is appropriate">
              <textarea
                minLength={10}
                maxLength={2000}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          ) : null}
        </>
      ) : null}
      <div className="actions">
        <button
          disabled={
            busy ||
            !checked ||
            ((attempt.score || 0) < passingScore(attempt.questions.length) &&
              (!override || reason.trim().length < 10))
          }
          onClick={() =>
            onApprove({ discussionChecked: checked, override, reason })
          }
        >
          Approve {a.stars} stars <Star />
        </button>
        <button className="secondary" disabled={busy} onClick={onRetry}>
          Unlock another try with PIN
        </button>
      </div>
    </article>
  );
}
