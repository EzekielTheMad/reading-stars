import { useEffect, useState } from "react";
import type { Book } from "./types";
import type { BookInput, Quiz, Question } from "../shared/schema";
import { api } from "./api";
import { Field, Notice } from "./components";

const blankQuestion = (i: number): Question => ({
  id: `q-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${i}`}`,
  prompt: "",
  options: ["", "", "", ""],
  correct: 0,
  skill: ["events", "cause", "motives", "inference"][
    i % 4
  ] as Question["skill"],
  explanation: "",
  reference: "",
});
const blankQuiz = (): Quiz => ({
  questions: Array.from({ length: 5 }, (_, i) => blankQuestion(i)),
  discussion: "",
});
export function BookEditor({
  book,
  aiAvailable,
  onRefresh,
  onBack,
}: {
  book: Book;
  aiAvailable: boolean;
  onRefresh: () => Promise<unknown>;
  onBack: () => void;
}) {
  const [value, setValue] = useState<BookInput>(book),
    [quiz, setQuiz] = useState<Quiz>(book.draft || blankQuiz),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    setValue(book);
    setQuiz(book.draft || blankQuiz());
    setReviewed(false);
  }, [book]);
  function update(key: string, v: unknown) {
    setValue((s) => ({
      ...s,
      [key]: v,
      ...(["title", "author", "isbn", "edition"].includes(key)
        ? { confirmed: false }
        : {}),
    }));
    setReviewed(false);
  }
  async function saveBook() {
    await api(`/parent/books/${book.id}`, "PUT", value);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editQuestion(index: number, key: keyof Question, v: unknown) {
    setQuiz((s) => ({
      ...s,
      questions: s.questions.map((q, i) =>
        i === index ? { ...q, [key]: v } : q,
      ),
    }));
    setReviewed(false);
  }
  return (
    <div className="book-editor">
      <button className="text-button" onClick={onBack}>
        ← Family library
      </button>
      <div className="section-heading">
        <div>
          <div className="eyebrow">PREPARE A READING ADVENTURE</div>
          <h2>{book.title}</h2>
        </div>
        <span className="status">
          {book.readyForChildren ? "Shared with every reader" : "Parent preparation"}
        </span>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <Notice>{message}</Notice> : null}
      {!book.readyForChildren ? <Notice>
        Hidden from the children’s bookshelf until ready: {book.preparationNeeds.join(" · ")}.
        Saving a draft does not publish it.
      </Notice> : null}
      {book.readyForChildren && !book.confirmed ? <Notice>This approved book is in the shared library. The physical-edition check is still pending; confirm the copy here when you can.</Notice> : null}
      <section className="panel stack">
        <h3>1. Confirm the book</h3>
        <div className="form-grid">
          <Field label="Title">
            <input
              value={value.title}
              maxLength={200}
              onChange={(e) => update("title", e.target.value)}
            />
          </Field>
          <Field label="Author">
            <input
              value={value.author}
              maxLength={150}
              onChange={(e) => update("author", e.target.value)}
            />
          </Field>
          <Field label="ISBN (optional)">
            <input
              value={value.isbn}
              maxLength={30}
              onChange={(e) => update("isbn", e.target.value)}
            />
          </Field>
          <Field label="Edition / volume">
            <input
              value={value.edition}
              maxLength={150}
              onChange={(e) => update("edition", e.target.value)}
              placeholder="Exact volume or edition, if relevant"
            />
          </Field>
          <Field label="Format">
            <select
              value={value.format}
              onChange={(e) => update("format", e.target.value)}
            >
              <option value="graphic">Graphic novel</option>
              <option value="early">Early reader</option>
              <option value="chapter">Chapter book</option>
              <option value="nonfiction">Nonfiction</option>
            </select>
          </Field>
          <Field label="Pages (optional)">
            <input
              type="number"
              value={value.pages}
              min={0}
              max={10000}
              onChange={(e) => update("pages", Number(e.target.value))}
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={value.confirmed}
            onChange={(e) => update("confirmed", e.target.checked)}
          />
          I checked the title, author, and exact book or edition.
        </label>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await saveBook();
              setMessage("Book details saved.");
            })
          }
        >
          Save book details
        </button>
      </section>
      <section className="panel stack">
        <h3>2. Gather source material</h3>
        <p className="muted">
          Use a book upload, online discussion guide, or your own checked notes.
          A cover identifies a book; it does not supply its story.
        </p>
        <Field label="Upload book or cover">
          <input
            type="file"
            disabled={busy}
            accept=".pdf,.epub,.png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const body = new FormData();
              body.append("file", file);
              run(async () => {
                await saveBook();
                await api(`/parent/books/${book.id}/upload`, "POST", body);
                setMessage("Upload saved. Review any coverage warnings below.");
              });
              e.target.value = "";
            }}
          />
        </Field>
        {book.uploads.map((u) => (
          <div className="source-item" key={u.id}>
            <strong>{u.name}</strong>
            <div className="actions">
              {u.kind === "cover" ? (
                <button
                  className="secondary"
                  disabled={busy || !aiAvailable}
                  onClick={() =>
                    run(async () => {
                      const found = await api<{
                        title: string;
                        author: string;
                        isbn: string;
                      }>(`/parent/uploads/${u.id}/identify`, "POST");
                      await api(`/parent/books/${book.id}`, "PUT", {
                        ...value,
                        title: found.title || value.title,
                        author: found.author || value.author,
                        isbn: found.isbn || value.isbn,
                        confirmed: false,
                      });
                      setMessage(
                        "Cover details suggested. Check and confirm the exact book before continuing.",
                      );
                    })
                  }
                >
                  Identify cover with AI
                </button>
              ) : (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const result = await api<{ text: string }>(
                        `/parent/uploads/${u.id}`,
                      );
                      setSource(
                        result.text || "No readable text was extracted.",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Inspect extracted text
                </button>
              )}
            </div>
            {u.warnings.map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
          </div>
        ))}
        {source !== null ? (
          <details open>
            <summary>Extracted source text</summary>
            <pre className="source-text">{source}</pre>
          </details>
        ) : null}
        <button
          className="secondary"
          disabled={busy || !aiAvailable || !value.confirmed}
          onClick={() =>
            run(async () => {
              await saveBook();
              await api(`/parent/books/${book.id}/discover`, "POST");
              setMessage(
                "Sources found. Check the links and story coverage before drafting.",
              );
            })
          }
        >
          {busy ? "Working…" : "Find questions & guides online"}
        </button>
        {!aiAvailable ? (
          <Notice>
            AI is not configured yet. You can enter source notes and questions
            manually; existing quizzes work without AI.
          </Notice>
        ) : (
          <p className="small-note">
            AI preparation uses a paid service only when you click a preparation
            button. Book text or cover images may be sent to that service.
            Reader names and quiz answers are excluded.
          </p>
        )}
        {book.sources.length ? (
          <div className="source-links">
            {book.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.title || s.url} ↗
              </a>
            ))}
          </div>
        ) : null}
        <Field
          label="Source notes / study guide"
          hint="Include enough checked material to support the beginning, middle, and ending. Keep page, chapter, or URL references."
        >
          <textarea
            rows={8}
            value={value.notes}
            maxLength={100000}
            onChange={(e) => update("notes", e.target.value)}
          />
        </Field>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await saveBook();
              setMessage("Source notes saved.");
            })
          }
        >
          Save source notes
        </button>
      </section>
      <section className="panel stack">
        <div className="section-heading">
          <h3>3. Prepare & check the quiz</h3>
          <button
            className="secondary"
            disabled={busy || !aiAvailable || !value.confirmed}
            onClick={() =>
              run(async () => {
                await saveBook();
                await api(`/parent/books/${book.id}/draft`, "POST");
                setMessage(
                  "Draft prepared. Check every answer and reference before approving.",
                );
              })
            }
          >
            {busy ? "Preparing…" : "Draft questions with AI"}
          </button>
        </div>
        <Notice>
          A short quiz checks events, cause and effect, motives, and inference.
          New adventures use ten questions for books with 50,000+ words, otherwise five. Approve enough questions to cover the beginning, middle and end. Picture-dependent
          details need your own check.
        </Notice>
        {quiz.questions.map((q, i) => (
          <details className="question-editor" key={q.id} open>
            <summary>
              Question {i + 1}
              {q.prompt ? ` · ${q.prompt}` : " · Write a question"}
            </summary>
            <div className="stack">
              <Field label={`Question ${i + 1}`}>
                <textarea
                  value={q.prompt}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => editQuestion(i, "prompt", e.target.value)}
                />
              </Field>
              <div className="form-grid">
                {q.options.map((option, j) => (
                  <Field
                    key={j}
                    label={`Choice ${String.fromCharCode(65 + j)}`}
                  >
                    <input
                      value={option}
                      maxLength={400}
                      onChange={(e) =>
                        editQuestion(
                          i,
                          "options",
                          q.options.map((o, k) =>
                            j === k ? e.target.value : o,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
              <div className="form-grid">
                <Field label="Correct answer">
                  <select
                    value={q.correct}
                    onChange={(e) =>
                      editQuestion(i, "correct", Number(e.target.value))
                    }
                  >
                    {q.options.map((_, j) => (
                      <option key={j} value={j}>
                        {String.fromCharCode(65 + j)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Comprehension skill">
                  <select
                    value={q.skill}
                    onChange={(e) => editQuestion(i, "skill", e.target.value)}
                  >
                    <option value="events">Key events</option>
                    <option value="cause">Cause & effect</option>
                    <option value="motives">Character motives</option>
                    <option value="inference">Inference / meaning</option>
                  </select>
                </Field>
              </div>
              <Field label="Answer explanation">
                <textarea
                  value={q.explanation}
                  maxLength={1500}
                  rows={2}
                  onChange={(e) =>
                    editQuestion(i, "explanation", e.target.value)
                  }
                />
              </Field>
              <Field
                label="Supporting reference"
                hint="Page / chapter / source link and the detail that supports this answer."
              >
                <textarea
                  value={q.reference}
                  maxLength={1500}
                  rows={2}
                  onChange={(e) => editQuestion(i, "reference", e.target.value)}
                />
              </Field>
              {quiz.questions.length > 5 ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setQuiz((s) => ({
                      ...s,
                      questions: s.questions.filter((_, j) => j !== i),
                    }));
                    setReviewed(false);
                  }}
                >
                  Remove this question
                </button>
              ) : null}
            </div>
          </details>
        ))}
        {quiz.questions.length < 20 ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setQuiz((s) => ({
                ...s,
                questions: [...s.questions, blankQuestion(s.questions.length)],
              }));
              setReviewed(false);
            }}
          >
            + Add another question
          </button>
        ) : null}
        <Field
          label="Quick parent discussion"
          hint="Include a retelling or why question, with guidance on what understanding would sound like."
        >
          <textarea
            rows={3}
            value={quiz.discussion}
            maxLength={1500}
            onChange={(e) => {
              setQuiz((s) => ({ ...s, discussion: e.target.value }));
              setReviewed(false);
            }}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I checked every correct answer and reference, story coverage, and any
          gaps from illustrations or missing text.
        </label>
        <div className="actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await saveBook();
                await api(`/parent/books/${book.id}/draft`, "PUT", quiz);
                setMessage("Draft saved. You can finish it later.");
              })
            }
          >
            Save draft
          </button>
          <button
            disabled={busy || !reviewed || !value.confirmed}
            onClick={() =>
              run(async () => {
                await saveBook();
                await api(`/parent/books/${book.id}/draft`, "PUT", quiz);
                await api(`/parent/books/${book.id}/publish`, "POST", {
                  reviewed: true,
                });
                setMessage(
                  "Quiz approved! With a cover, this book is available to every reader. Check its difficulty and word count in Reward settings; use New adventure for a parent-agreed reward before reading.",
                );
              })
            }
          >
            Approve quiz →
          </button>
        </div>
        <p className="small-note">
          Approved versions are saved. Existing reading adventures keep their
          original quiz and agreed reward.
        </p>
      </section>
    </div>
  );
}
