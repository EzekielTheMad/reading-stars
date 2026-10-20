import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import type { Book, LibraryBook } from "./types";

export function Star({ className = "" }: { className?: string }) {
  return (
    <svg className={`star ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m12 2 3 6 7 .9-5 4.9 1.2 7-6.2-3.3L5.8 21 7 14 2 8.9 9 8z"
        fill="currentColor"
      />
    </svg>
  );
}
export function BookMark() {
  return (
    <svg viewBox="0 0 40 36" aria-hidden="true" className="book-mark">
      <path
        d="M3 7q9-5 17 0 8-5 17 0v25q-9-5-17 0-8-5-17 0z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <path
        d="M20 7v25m5-18h7m-7 6h7M8 14h6m-6 6h6"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      {children}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
export function PinDialog({
  title,
  onSubmit,
  onClose,
}: {
  title: string;
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [pin, setPin] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(pin);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} onCancel={onClose} aria-labelledby="pin-title">
      <form onSubmit={submit} className="stack">
        <div className="eyebrow">GROWN-UPS ONLY</div>
        <h2 id="pin-title">{title}</h2>
        <p>Enter your six-digit parent PIN.</p>
        <Field label="Parent PIN">
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button disabled={busy}>{busy ? "Checking…" : "Unlock"}</button>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
const formatName: Record<string, string> = {
  graphic: "Graphic novel",
  early: "Early reader",
  chapter: "Chapter book",
  nonfiction: "Nonfiction",
};
export function BookCover({ book, index = 0 }: { book: Omit<LibraryBook,"offers"> & {uploads?: Book["uploads"]}; index?: number }) {
  const cover =
    book.coverId || book.uploads?.filter((u) => u.kind === "cover").at(-1)?.id;
  return cover ? (
    <img
      className="book-cover actual"
      src={`/api/covers/${cover}`}
      alt={`${book.title} cover`}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <div className={`book-cover cover-${index % 4}`} aria-hidden="true">
      <span className="cover-top">A LITTLE READING ADVENTURE</span>
      <BookMark />
      <strong>{book.title}</strong>
      <span>{book.author}</span>
      <div className="cover-bottom">
        <span>{formatName[book.format] || "Book"}</span>
        <Star />
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookMark />
        <Star />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
