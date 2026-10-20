import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { randomUUID, randomInt, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z, ZodError } from "zod";
import { openDatabase, transaction, type DB } from "./db.ts";
import { rewardStore } from "./rewards.ts";
import { questionCount, passedAttempt } from "../shared/rewards.ts";
import {
  hashSecret,
  verifySecret,
  newSession,
  sessionFor,
  requireAuth,
  requireParent,
} from "./security.ts";
import { extractUpload } from "./uploads.ts";
import { makeAI, type AIProvider, type BookContext } from "./ai.ts";
import {
  bookSchema,
  childSchema,
  draftSchema,
  quizSchema,
  type Quiz,
} from "../shared/schema.ts";

type Row = Record<string, any>;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const shuffle = <T>(items: T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const validPin = z.string().regex(/^\d{6}$/, "Use a six-digit parent PIN.");
const bodyPin = z.object({ pin: validPin });
const safeUrl = (s: string) => {
  try {
    const u = new URL(s);
    return ["http:", "https:"].includes(u.protocol) ? s : "";
  } catch {
    return "";
  }
};

export interface AppOptions {
  now?: () => Date;
  dataDir: string;
  origin: string;
  secureCookies?: boolean;
  ai?: AIProvider | null;
  setupToken?: string;
  staticDir?: string;
  aiDailyLimit?: number;
  timeZone?: string;
}
export function createApp(options: AppOptions) {
  const dataDir = resolve(options.dataDir),
    uploadsDir = join(dataDir, "uploads");
  mkdirSync(uploadsDir, { recursive: true, mode: 0o700 });
  const timeZone=options.timeZone || "UTC";
  new Intl.DateTimeFormat("en",{timeZone}).format();
  const db = openDatabase(dataDir,timeZone),
    app = express();
  const rewards=rewardStore(db,options.now || (()=>new Date()),timeZone);
  const dailyLimitMessage="Two book adventures finished today! Keep reading, and come back tomorrow for another quiz. Your agreed stars stay the same.";
  app.disable("x-powered-by");
  // Deliberately do not trust client-supplied X-Forwarded-* headers.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
        },
      },
      strictTransportSecurity: options.secureCookies ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== options.origin)
        return res
          .status(403)
          .json({ error: "This request came from a different site." });
      if (req.headers["sec-fetch-site"] === "cross-site")
        return res
          .status(403)
          .json({ error: "Cross-site requests are not allowed." });
    }
    next();
  });
  const auth = requireAuth(db),
    parent = requireParent(db);
  const limiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many attempts. Please wait 15 minutes before trying again.",
    },
  });
  const setting = (key: string) =>
    (
      db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
        Row | undefined
    )?.value as string | undefined;
  const audit = (action: string, entity: string, detail: string) =>
    db
      .prepare("INSERT INTO audit(action,entity,detail) VALUES(?,?,?)")
      .run(action, entity, detail);
  const canonical = (value: string) =>
    value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  function rejectDuplicateBook(
    book: z.infer<typeof bookSchema>,
    exceptId?: string,
  ) {
    if (book.title === "Book to identify" || book.author === "To confirm")
      return;
    const isbn = book.isbn.replace(/[\s-]/g, "").toUpperCase();
    const duplicate = (
      db
        .prepare("SELECT id,title,author,edition,isbn FROM books")
        .all() as Row[]
    ).find(
      (other) =>
        other.id !== exceptId &&
        ((isbn && isbn === other.isbn.replace(/[\s-]/g, "").toUpperCase()) ||
          (canonical(other.title) === canonical(book.title) &&
            canonical(other.author) === canonical(book.author) &&
            canonical(other.edition) === canonical(book.edition))),
    );
    if (duplicate)
      fail(
        409,
        "This book is already in your library. Use its existing quiz and adventure rather than adding it twice.",
      );
  }
  const get = (
    table:
      "books" | "children" | "assignments" | "attempts" | "quizzes" | "uploads",
    id: string,
  ): Row =>
    (db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Row) ||
    fail(404, "That item could not be found.");
  const checkPin = (pin: string) => {
    if (!verifySecret(pin, setting("pin") || ""))
      fail(403, "That parent PIN did not match.");
  };
  const pinBody = (req: Request) => checkPin(bodyPin.parse(req.body).pin);
  const ai = options.ai === null ? undefined : options.ai || makeAI();
  let aiBusy = false;
  async function aiCall<T>(
    operation: string,
    fn: (provider: AIProvider) => Promise<T>,
  ) {
    if (!ai)
      return fail(
        503,
        "AI preparation is not configured. You can still add and approve questions yourself.",
      );
    if (aiBusy)
      return fail(
        409,
        "A book is already being prepared. Please wait for it to finish.",
      );
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_usage WHERE date(created)=date('now')",
        )
        .get() as Row
    ).n;
    if (count >= (options.aiDailyLimit || 10))
      return fail(
        429,
        "Today’s book preparation limit has been reached. Existing quizzes still work.",
      );
    const id = randomUUID();
    db.prepare("INSERT INTO ai_usage(id,operation,status) VALUES(?,?,?)").run(
      id,
      operation,
      "running",
    );
    aiBusy = true;
    try {
      const result = await fn(ai);
      db.prepare("UPDATE ai_usage SET status='completed' WHERE id=?").run(id);
      return result;
    } catch (error) {
      db.prepare("UPDATE ai_usage SET status='failed' WHERE id=?").run(id);
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        502,
        "Book preparation could not finish. Your saved work is safe. Check service access or try again later.",
      );
    } finally {
      aiBusy = false;
    }
  }
  const bookContext = (book: Row): BookContext => ({
    title: book.title,
    author: book.author,
    edition: book.edition,
    format: book.format,
    notes: book.notes,
    text: (
      db
        .prepare(
          "SELECT extracted FROM uploads WHERE book_id=? AND kind='book'",
        )
        .all(book.id) as Row[]
    )
      .map((u) => u.extracted)
      .join("\n")
      .slice(0, 240000),
    sources: JSON.parse(book.sources),
  });
  function coverFor(bookId: string): Row | undefined {
    const covers = db.prepare(
      "SELECT id,path,mime FROM uploads WHERE book_id=? AND kind='cover' ORDER BY rowid DESC",
    ).all(bookId) as Row[];
    return covers.find((cover) => {
      try {
        const file = statSync(join(uploadsDir, cover.path));
        return file.isFile() && file.size > 0;
      } catch { return false; }
    });
  }
  function preparation(book: Row) {
    const needs: string[] = [];
    if (!book.confirmed) needs.push("Confirm edition");
    if (!coverFor(book.id)) needs.push("Needs cover");
    const latest = db.prepare(
      "SELECT body FROM quizzes WHERE book_id=? ORDER BY rowid DESC LIMIT 1",
    ).get(book.id) as Row | undefined;
    let approved = false;
    try { approved = !!latest && quizSchema.safeParse(JSON.parse(latest.body)).success; }
    catch { /* A damaged quiz must not expose an unfinished book. */ }
    if (!approved) needs.push("Needs approved quiz");
    // Edition review remains parent-facing information. An approved quiz and a
    // real cover are the family's visibility rule for the shared library.
    return { readyForChildren: needs.every(need => need === "Confirm edition"), preparationNeeds: needs,
      requiredQuestions:questionCount(rewards.book(book).words),
      approvedQuestionCount:approved ? JSON.parse(latest!.body).questions.length : 0 };
  }
  function quizForNewAdventure(book: Row) {
    const config=rewards.book(book);
    if(!config.words)return fail(409,"Set this book’s word count in Reward settings before starting a new adventure.");
    const quiz=db.prepare("SELECT id,body FROM quizzes WHERE book_id=? ORDER BY rowid DESC LIMIT 1").get(book.id) as Row | undefined;
    const count=questionCount(config.words);
    if(!quiz || quizSchema.parse(JSON.parse(quiz.body)).questions.length<count)
      return fail(409,`Approve at least ${count} questions before starting this adventure.`);
    return {id:quiz.id,count};
  }
  function parentBook(book: Row) {
    return {
      ...book,
      ...preparation(book),
      reward: rewards.book(book),
      coverId: coverFor(book.id)?.id,
      confirmed: !!book.confirmed,
      draft: book.draft ? JSON.parse(book.draft) : null,
      sources: JSON.parse(book.sources),
      uploads: (
        db
          .prepare(
            "SELECT id,kind,name,mime,warnings FROM uploads WHERE book_id=?",
          )
          .all(book.id) as Row[]
      ).map((u) => ({ ...u, warnings: JSON.parse(u.warnings) })),
      quizzes: db
        .prepare(
          "SELECT id,created FROM quizzes WHERE book_id=? ORDER BY rowid DESC",
        )
        .all(book.id),
    };
  }
  function childBook(book: Row) {
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      coverId: coverFor(book.id)?.id,
    };
  }
  function publicAttempt(attempt: Row) {
    const quiz = JSON.parse(
      get("quizzes", get("assignments", attempt.assignment_id).quiz_id).body,
    ) as Quiz;
    const picked = JSON.parse(attempt.questions) as {
      id: string;
      order: number[];
    }[];
    return {
      id: attempt.id,
      assignmentId: attempt.assignment_id,
      submitted: attempt.submitted,
      score: attempt.score,
      answers: JSON.parse(attempt.answers),
      questions: picked.map((item) => {
        const q = quiz.questions.find((q) => q.id === item.id)!;
        return {
          id: q.id,
          prompt: q.prompt,
          options: item.order.map((original, index) => ({
            id: String(index),
            text: q.options[original],
          })),
        };
      }),
    };
  }
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/session", (req, res) => {
    const session = sessionFor(db, req);
    res.json({
      setup: !setting("password"),
      authenticated: !!session,
      parent: !!session && session.parent_until > Date.now(),
      timeZone,
      aiAvailable: !!ai,
    });
  });
  app.post("/api/setup", limiter, (req, res) => {
    if (setting("password"))
      return fail(409, "This family bookshelf is already set up.");
    const body = z
      .object({
        password: z.string().min(12).max(200),
        pin: validPin,
        setupToken: z.string().max(300).optional(),
      })
      .parse(req.body);
    if (options.setupToken) {
      const a = Buffer.from(body.setupToken || ""),
        b = Buffer.from(options.setupToken);
      if (a.length !== b.length || !timingSafeEqual(a, b))
        return fail(403, "Enter the setup token configured on the server.");
    } else {
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress || "",
      );
      if (!local || !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname))
        return fail(
          403,
          "Initial setup must run on localhost, or use a server setup token.",
        );
    }
    transaction(db, () => {
      db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run(
        "password",
        hashSecret(body.password),
      );
      db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run(
        "pin",
        hashSecret(body.pin),
      );
    });
    newSession(db, res, !!options.secureCookies, true);
    audit("setup", "household", "Created family bookshelf");
    res.status(201).json({ ok: true });
  });
  app.post("/api/login", limiter, (req, res) => {
    const { password } = z
      .object({ password: z.string().max(200) })
      .parse(req.body);
    if (!setting("password") || !verifySecret(password, setting("password")!))
      return fail(401, "That family password did not match.");
    newSession(db, res, !!options.secureCookies);
    res.json({ ok: true });
  });
  app.post("/api/logout", auth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE id=?").run(sessionFor(db, req)!.id);
    res.clearCookie("reading_session", {
      path: "/",
      httpOnly: true,
      secure: !!options.secureCookies,
      sameSite: "strict",
    });
    res.json({ ok: true });
  });
  app.post("/api/parent/unlock", auth, limiter, (req, res) => {
    pinBody(req);
    db.prepare("UPDATE sessions SET parent_until=? WHERE id=?").run(
      Date.now() + 10 * 60000,
      sessionFor(db, req)!.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/parent/lock", auth, (req, res) => {
    db.prepare("UPDATE sessions SET parent_until=0 WHERE id=?").run(
      sessionFor(db, req)!.id,
    );
    res.json({ ok: true });
  });
  app.get("/api/shelf", auth, (_req, res) => {
    const readerRows=db.prepare("SELECT * FROM children ORDER BY age").all() as Row[];
    const children=readerRows.map(c=>({id:c.id,name:c.name,age:c.age,color:c.color}));
    const books = (db.prepare("SELECT * FROM books").all() as Row[])
      .filter((book) => preparation(book).readyForChildren).map(book=>({...childBook(book),offers:Object.fromEntries(readerRows.map(c=>{
        const offer=rewards.suggest(book,c);
        return [c.id,{stars:offer.needsParent?null:offer.stars,needsParent:offer.needsParent,questionCount:offer.questionCount,quizReady:preparation(book).approvedQuestionCount>=offer.questionCount}];
      }))}));
    const visibleBookIds = new Set(books.map((book) => book.id));
    const assignments = (
      db.prepare("SELECT * FROM assignments").all() as Row[]
    ).filter((a) => visibleBookIds.has(a.book_id)).map((a) => {
      const award = db
        .prepare("SELECT stars,recorded FROM awards WHERE assignment_id=?")
        .get(a.id) as Row | undefined;
      return {
        ...a,
        canComplete: rewards.canComplete(a),
        rationale: undefined,
        quiz_id: undefined,
        retry_credit: undefined,
        award: award || null,
      };
    });
    res.json({ children, books, assignments, daily:Object.fromEntries(readerRows.map(c=>[c.id,rewards.daily(c.id)])) });
  });
  app.get("/api/parent", auth, parent, (_req, res) =>
    res.json({
      children: (db.prepare("SELECT * FROM children ORDER BY age").all() as Row[]).map(c=>({...c,readingBand:rewards.reader(c)})),
      books: (
        db.prepare("SELECT * FROM books ORDER BY rowid DESC").all() as Row[]
      ).map(parentBook),
      assignments: db.prepare("SELECT * FROM assignments").all(),
      awards: db
        .prepare(
          "SELECT awards.*,assignments.child_id,assignments.book_id FROM awards JOIN assignments ON assignments.id=awards.assignment_id ORDER BY awards.rowid DESC",
        )
        .all(),
      attempts: (
        db.prepare("SELECT * FROM attempts ORDER BY rowid DESC").all() as Row[]
      ).map((a) => {
        const assignment = get("assignments", a.assignment_id),
          quiz = JSON.parse(get("quizzes", assignment.quiz_id).body) as Quiz;
        return {
          ...a,
          answers: JSON.parse(a.answers),
          questions: JSON.parse(a.questions),
          quiz,
        };
      }),
      timeZone,
      aiAvailable: !!ai,
      aiUsage: db
        .prepare(
          "SELECT operation,status,created FROM ai_usage ORDER BY rowid DESC LIMIT 20",
        )
        .all(),
      audit: db
        .prepare(
          "SELECT action,entity,detail,created FROM audit ORDER BY id DESC LIMIT 30",
        )
        .all(),
    }),
  );
  app.put("/api/parent/children/:id/reward",auth,parent,(req,res)=>{
    const child=get("children",String(req.params.id));
    const {band}=z.object({band:z.number().int().min(1).max(5).nullable()}).strict().parse(req.body);
    db.prepare("INSERT INTO reward_readers(child_id,band) VALUES(?,?) ON CONFLICT(child_id) DO UPDATE SET band=excluded.band").run(child.id,band);
    audit("reader_reward_band",child.id,"Updated reward band for future adventures; existing rewards preserved.");
    res.json({ok:true});
  });
  app.put("/api/parent/books/:id/reward",auth,parent,(req,res)=>{
    const book=get("books",String(req.params.id));
    const b=z.object({band:z.number().int().min(1).max(5).nullable(),workload:z.enum(["short","compact","standard","long"]).nullable(),review:z.boolean(),words:z.number().int().min(1).max(10_000_000).nullable().optional(),wordCountSource:z.string().trim().max(2000).optional()}).strict().parse(req.body);
    transaction(db,()=>{
    db.prepare("INSERT INTO reward_books(book_id,band,workload,review) VALUES(?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET band=excluded.band,workload=excluded.workload,review=excluded.review").run(book.id,b.band,b.workload,Number(b.review));
    if(b.words!==undefined)db.prepare("INSERT INTO book_word_counts(book_id,words,source) VALUES(?,?,?) ON CONFLICT(book_id) DO UPDATE SET words=excluded.words,source=excluded.source").run(book.id,b.words,b.wordCountSource ?? "Parent-entered count");
    });
    audit("book_reward_settings",book.id,"Updated word count and difficulty for future adventures; existing rewards and quiz lengths preserved.");
    res.json({ok:true});
  });
  app.post("/api/parent/children", auth, parent, (req, res) => {
    const c = childSchema.parse(req.body),
      id = randomUUID();
    db.prepare(
      "INSERT INTO children(id,name,age,profile,confidence,color) VALUES(?,?,?,?,?,?)",
    ).run(id, c.name, c.age, c.profile, c.confidence, c.color);
    res.status(201).json({ id });
  });
  app.put("/api/parent/children/:id", auth, parent, (req, res) => {
    get("children", String(req.params.id));
    const c = childSchema.parse(req.body);
    db.prepare(
      "UPDATE children SET name=?,age=?,profile=?,confidence=?,color=? WHERE id=?",
    ).run(
      c.name,
      c.age,
      c.profile,
      c.confidence,
      c.color,
      String(req.params.id),
    );
    res.json({ ok: true });
  });
  app.post("/api/parent/books", auth, parent, (req, res) => {
    const b = bookSchema.parse(req.body),
      id = randomUUID();
    rejectDuplicateBook(b);
    db.prepare(
      "INSERT INTO books(id,title,author,isbn,edition,format,pages,notes,confirmed) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      b.title,
      b.author,
      b.isbn,
      b.edition,
      b.format,
      b.pages,
      b.notes,
      Number(b.confirmed),
    );
    res.status(201).json({ id });
  });
  app.put("/api/parent/books/:id", auth, parent, (req, res) => {
    const old = get("books", String(req.params.id)),
      b = bookSchema.parse(req.body);
    rejectDuplicateBook(b, old.id);
    const identityChanged = ["title", "author", "isbn", "edition"].some(
      (k) => old[k] !== b[k as keyof typeof b],
    );
    const assigned = db
      .prepare("SELECT id FROM assignments WHERE book_id=? LIMIT 1")
      .get(old.id);
    if (identityChanged && assigned)
      return fail(
        409,
        "This edition is already assigned. Add a separate book for a different title or edition.",
      );
    if (
      identityChanged &&
      (JSON.parse(old.sources).length ||
        db
          .prepare(
            "SELECT id FROM uploads WHERE book_id=? AND kind='book' LIMIT 1",
          )
          .get(old.id))
    )
      return fail(
        409,
        "This book already has text or online sources. Add a separate book for a different title or edition so sources do not get mixed.",
      );
    db.prepare(
      "UPDATE books SET title=?,author=?,isbn=?,edition=?,format=?,pages=?,notes=?,confirmed=?,draft=? WHERE id=?",
    ).run(
      b.title,
      b.author,
      b.isbn,
      b.edition,
      b.format,
      b.pages,
      b.notes,
      Number(b.confirmed),
      identityChanged ? null : old.draft,
      old.id,
    );
    if (identityChanged)
      { db.prepare("DELETE FROM quizzes WHERE book_id=?").run(old.id);
        db.prepare("DELETE FROM reward_books WHERE book_id=?").run(old.id);
        db.prepare("DELETE FROM book_word_counts WHERE book_id=?").run(old.id); }
    res.json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.post(
    "/api/parent/books/:id/upload",
    auth,
    parent,
    upload.single("file"),
    async (req, res) => {
      const book = get("books", String(req.params.id));
      if (!req.file)
        return fail(400, "Choose a book file or cover image first.");
      if (
        (
          db
            .prepare("SELECT COUNT(*) AS n FROM uploads WHERE book_id=?")
            .get(book.id) as Row
        ).n >= 5
      )
        return fail(400, "Each book can have up to five source uploads.");
      let extracted: Awaited<ReturnType<typeof extractUpload>>;
      try {
        extracted = await extractUpload(req.file.buffer, req.file.originalname);
      } catch (e) {
        return fail(
          400,
          e instanceof Error ? e.message : "Cannot read this upload.",
        );
      }
      const id = randomUUID(),
        filename = id + extracted.extension;
      writeFileSync(join(uploadsDir, filename), req.file.buffer, {
        mode: 0o600,
      });
      try {
        db.prepare(
          "INSERT INTO uploads(id,book_id,kind,name,path,mime,extracted,warnings) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          id,
          book.id,
          extracted.kind,
          req.file.originalname.slice(0, 200),
          filename,
          extracted.mime,
          extracted.text,
          JSON.stringify(extracted.warnings),
        );
      } catch (error) {
        unlinkSync(join(uploadsDir, filename));
        throw error;
      }
      res
        .status(201)
        .json({ id, warnings: extracted.warnings, kind: extracted.kind });
    },
  );
  app.get("/api/covers/:id", auth, (req, res) => {
    const u = get("uploads", String(req.params.id));
    if (u.kind !== "cover") return fail(404, "Cover not found.");
    const session = sessionFor(db, req)!;
    if (session.parent_until <= Date.now() && !preparation(get("books", u.book_id)).readyForChildren)
      return fail(404, "Cover not found.");
    res.type(u.mime).sendFile(u.path, {root:uploadsDir});
  });
  app.get("/api/parent/uploads/:id", auth, parent, (req, res) => {
    const u = get("uploads", String(req.params.id));
    res.json({
      name: u.name,
      text: u.extracted,
      warnings: JSON.parse(u.warnings),
    });
  });
  app.post(
    "/api/parent/uploads/:id/identify",
    auth,
    parent,
    async (req, res) => {
      const u = get("uploads", String(req.params.id));
      if (u.kind !== "cover")
        return fail(400, "Choose a cover image to identify a book.");
      const result = await aiCall("cover", (provider) =>
        provider.identify(
          `data:${u.mime};base64,${readFileSync(join(uploadsDir, u.path)).toString("base64")}`,
        ),
      );
      res.json(result);
    },
  );
  app.post("/api/parent/books/:id/discover", auth, parent, async (req, res) => {
    const book = get("books", String(req.params.id));
    if (!book.confirmed)
      return fail(
        400,
        "Confirm this book’s title and edition before finding questions.",
      );
    const result = await aiCall("sources", (provider) =>
      provider.discover(bookContext(book)),
    );
    const sources = result.sources.filter((s) => safeUrl(s.url));
    db.prepare("UPDATE books SET sources=?,notes=? WHERE id=?").run(
      JSON.stringify(sources),
      `${book.notes}\n\n[Web source synthesis — verify against the linked material]\n${result.text}`.slice(
        -100000,
      ),
      book.id,
    );
    res.json({ sources });
  });
  app.post("/api/parent/books/:id/draft", auth, parent, async (req, res) => {
    const book = get("books", String(req.params.id));
    if (!book.confirmed)
      return fail(400, "Confirm the title and edition first.");
    const context = {...bookContext(book),requiredQuestions:questionCount(rewards.book(book).words)};
    if ((context.notes + context.text).trim().length < 200)
      return fail(
        400,
        "Add source notes, a readable book upload, or find online sources first.",
      );
    const result = await aiCall("quiz", (provider) => provider.draft(context));
    const parsed = quizSchema.safeParse(result);
    if (!parsed.success || parsed.data.questions.length<context.requiredQuestions)
      return fail(
        422,
        `The available material did not produce ${context.requiredQuestions} reliable questions. Add fuller sources or enter questions yourself.`,
      );
    db.prepare("UPDATE books SET draft=? WHERE id=?").run(
      JSON.stringify(parsed.data),
      book.id,
    );
    res.json({ ok: true });
  });
  app.put("/api/parent/books/:id/draft", auth, parent, (req, res) => {
    get("books", String(req.params.id));
    const draft = draftSchema.parse(req.body);
    db.prepare("UPDATE books SET draft=? WHERE id=?").run(
      JSON.stringify(draft),
      String(req.params.id),
    );
    res.json({ ok: true });
  });
  app.post("/api/parent/books/:id/publish", auth, parent, (req, res) => {
    const book = get("books", String(req.params.id));
    const { reviewed } = z
      .object({ reviewed: z.literal(true) })
      .parse(req.body);
    if (!book.confirmed || !book.draft)
      return fail(400, "Confirm the edition and save a complete quiz first.");
    const quiz = quizSchema.parse(JSON.parse(book.draft));
    const required=questionCount(rewards.book(book).words);
    if(quiz.questions.length<required)return fail(400,`This book needs at least ${required} approved questions.`);
    const id = randomUUID();
    db.prepare("INSERT INTO quizzes(id,book_id,body) VALUES(?,?,?)").run(
      id,
      book.id,
      JSON.stringify(quiz),
    );
    audit(
      "quiz_approved",
      book.id,
      reviewed
        ? "Parent checked answers, references, story coverage, and picture-dependent gaps"
        : "",
    );
    res.status(201).json({ id });
  });
  app.post("/api/parent/suggest", auth, parent, (req, res) => {
    const { childId, bookId, effort } = z
      .object({
        childId: z.string(),
        bookId: z.string(),
        effort: z.enum(["easy", "comfortable", "stretch"]).optional(),
      })
      .parse(req.body);
    const child = get("children", childId),
      book = get("books", bookId);
    const result=rewards.suggest(book,child,effort);
    const config=rewards.book(book);
    const rationale=`${result.base===null ? "Set this book’s word count first; no automatic price is available." : `${config.words!.toLocaleString("en-US")} words → ${result.base} base stars × ${result.multiplier} relative-difficulty multiplier → ${result.stars} stars (nearest whole star, minimum 1).`} ${result.needsParent ? "A parent needs to check the edition, classification or suitability before the child chooses it." : "Reward is fixed when the adventure is chosen."} New quizzes use ${result.questionCount} questions. Existing adventures keep their agreed stars and quiz length.`;
    res.json({...result,rationale});
  });
  app.post("/api/parent/assignments", auth, parent, (req, res) => {
    const b = z
      .object({
        childId: z.string(),
        bookId: z.string(),
        effort: z.enum(["easy", "comfortable", "stretch"]),
        stars: z.number().int().min(1).max(100),
        rationale: z.string().trim().min(3).max(3000),
      })
      .parse(req.body);
    get("children", b.childId);
    const book = get("books", b.bookId);
    if (!preparation(book).readyForChildren)
      return fail(400, "Add a cover and approve a complete quiz before assigning this book.");
    if (!coverFor(book.id)) return fail(400, "Add a cover image before assigning this book.");
    const quiz = quizForNewAdventure(book);
    if (
      db
        .prepare("SELECT id FROM assignments WHERE child_id=? AND book_id=?")
        .get(b.childId, b.bookId)
    )
      return fail(
        409,
        "This child already has this book. It can earn stars once.",
      );
    const id = randomUUID();
    db.prepare(
      "INSERT INTO assignments(id,child_id,book_id,quiz_id,stars,effort,rationale,question_count) VALUES(?,?,?,?,?,?,?,?)",
    ).run(id, b.childId, b.bookId, quiz.id, b.stars, b.effort, b.rationale,quiz.count);
    audit("assigned", id, `${b.stars} stars agreed before reading`);
    res.status(201).json({ id });
  });
  app.post("/api/library/:id/choose", auth, (req, res) => {
    const { childId } = z.object({ childId: z.string().min(1).max(100) }).strict().parse(req.body);
    const bookId=String(req.params.id);
    const result=transaction(db,()=>{
      const child=get("children",childId);
      const book=get("books",bookId);
      if(!preparation(book).readyForChildren)
        return fail(409,"This adventure is still being prepared. Pick another book for now.");
      const existing=db.prepare("SELECT id FROM assignments WHERE child_id=? AND book_id=?").get(childId,bookId) as Row | undefined;
      if(existing)return {id:existing.id,created:false};
      const offer=rewards.suggest(book,child);
      if(offer.needsParent)return fail(409,"Ask a grown-up to agree on this book’s reward in Parent corner → New adventure first.");
      const quiz=quizForNewAdventure(book);
      const id=randomUUID();
      // Rewards are fixed before reading. Children cannot supply stars, change
      // an existing parent reward, reset progress or issue themselves retries.
      db.prepare("INSERT INTO assignments(id,child_id,book_id,quiz_id,stars,effort,rationale,question_count) VALUES(?,?,?,?,?,?,?,?)")
        .run(id,childId,bookId,quiz.id,offer.stars,offer.effort,"Shared library choice; word-count base multiplied by relative difficulty, fixed before reading. Parent discussion approval required.",quiz.count);
      audit("book_chosen",id,`${offer.stars} stars fixed before reading; parent discussion required.`);
      return {id,created:true};
    });
    res.status(result.created?201:200).json({id:result.id});
  });
  app.post("/api/assignments/:id/start", auth, (req, res) => {
    const assignmentId = String(req.params.id);
    const result = transaction(db, () => {
      const a = get("assignments", assignmentId);
      if (!preparation(get("books", a.book_id)).readyForChildren)
        return fail(409, "This book is being prepared. Ask a parent to check its cover and quiz.");
      const open = db
        .prepare(
          "SELECT * FROM attempts WHERE assignment_id=? AND submitted IS NULL",
        )
        .get(a.id) as Row | undefined;
      if (open) return open;
      if (["review", "completed"].includes(a.status))
        return fail(
          409,
          "This book is waiting for parent review or has already earned stars.",
        );
      if(!rewards.canComplete(a))return fail(409,dailyLimitMessage);
      const count = (
        db
          .prepare("SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?")
          .get(a.id) as Row
      ).n;
      if (count > 0 && !a.retry_credit)
        return fail(403, "Ask a parent to unlock another try with their PIN.");
      const quiz = JSON.parse(get("quizzes", a.quiz_id).body) as Quiz;
      if(quiz.questions.length<a.question_count)return fail(409,"This quiz needs more approved questions. Ask a parent to check it.");
      const picked = shuffle(quiz.questions)
        .slice(0, a.question_count)
        .map((q) => ({ id: q.id, order: shuffle([0, 1, 2, 3]) }));
      const id = randomUUID();
      db.prepare(
        "INSERT INTO attempts(id,assignment_id,questions) VALUES(?,?,?)",
      ).run(id, a.id, JSON.stringify(picked));
      db.prepare(
        "UPDATE assignments SET retry_credit=0,status='reading' WHERE id=?",
      ).run(a.id);
      return get("attempts", id);
    });
    res.json(publicAttempt(result));
  });
  app.get("/api/attempts/:id", auth, (req, res) =>
    res.json(publicAttempt(get("attempts", String(req.params.id)))),
  );
  const answersSchema = z.object({
    answers: z.record(z.string(), z.string().regex(/^[0-3]$/)),
  });
  function validateAnswers(
    attempt: Row,
    answers: Record<string, string>,
    complete: boolean,
  ) {
    const ids = (JSON.parse(attempt.questions) as Row[]).map((q) => q.id);
    if (
      Object.keys(answers).some((id) => !ids.includes(id)) ||
      (complete && ids.some((id) => answers[id] === undefined))
    )
      fail(400, `Answer each of the ${ids.length} questions before finishing.`);
  }
  app.put("/api/attempts/:id/answers", auth, (req, res) => {
    const a = get("attempts", String(req.params.id));
    if (a.submitted) return fail(409, "This attempt is already finished.");
    const { answers } = answersSchema.parse(req.body);
    validateAnswers(a, answers, false);
    db.prepare(
      "UPDATE attempts SET answers=? WHERE id=? AND submitted IS NULL",
    ).run(JSON.stringify(answers), a.id);
    res.json({ ok: true });
  });
  app.post("/api/attempts/:id/submit", auth, (req, res) => {
    const result = transaction(db, () => {
      const attempt = get("attempts", String(req.params.id));
      if (attempt.submitted) return attempt;
      const { answers } = answersSchema.parse(req.body);
      validateAnswers(attempt, answers, true);
      const assignment = get("assignments", attempt.assignment_id),
        quiz = JSON.parse(get("quizzes", assignment.quiz_id).body) as Quiz;
      let score = 0;
      for (const item of JSON.parse(attempt.questions) as {
        id: string;
        order: number[];
      }[]) {
        const q = quiz.questions.find((q) => q.id === item.id)!;
        if (item.order[Number(answers[item.id])] === q.correct) score++;
      }
      const passed=passedAttempt({score,questions:attempt.questions});
      if(passed && !rewards.reserve(assignment))return fail(409,dailyLimitMessage);
      db.prepare(
        "UPDATE attempts SET answers=?,score=?,submitted=CURRENT_TIMESTAMP WHERE id=?",
      ).run(JSON.stringify(answers), score, attempt.id);
      db.prepare("UPDATE assignments SET status=? WHERE id=?").run(
        passed ? "review" : "retry_locked",
        assignment.id,
      );
      return get("attempts", attempt.id);
    });
    res.json({ score: result.score, passed: passedAttempt({score:result.score,questions:result.questions}) });
  });
  app.post("/api/parent/assignments/:id/retry", auth, limiter, (req, res) => {
    pinBody(req);
    const a = get("assignments", String(req.params.id));
    if (a.status === "completed")
      return fail(409, "This book already earned its stars.");
    if (
      db
        .prepare(
          "SELECT id FROM attempts WHERE assignment_id=? AND submitted IS NULL",
        )
        .get(a.id)
    )
      return fail(409, "Finish or resume the current attempt first.");
    if (
      !db
        .prepare(
          "SELECT id FROM attempts WHERE assignment_id=? AND submitted IS NOT NULL",
        )
        .get(a.id)
    )
      return fail(409, "The first attempt is already available.");
    db.prepare(
      "UPDATE assignments SET retry_credit=1,status='reading' WHERE id=?",
    ).run(a.id);
    audit(
      "retry_unlocked",
      a.id,
      "Parent entered PIN; one further attempt permitted",
    );
    res.json({ ok: true });
  });
  app.post("/api/parent/assignments/:id/approve", auth, parent, (req, res) => {
    const b = z
      .object({
        discussionChecked: z.literal(true),
        override: z.boolean().default(false),
        reason: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    const result = transaction(db, () => {
      const a = get("assignments", String(req.params.id));
      const existing = db
        .prepare("SELECT * FROM awards WHERE assignment_id=?")
        .get(a.id);
      if (existing) return existing;
      const latest = db
        .prepare(
          "SELECT * FROM attempts WHERE assignment_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(a.id) as Row | undefined;
      if (!latest?.submitted)
        return fail(400, "Finish a quiz before approving its reward.");
      if (!passedAttempt(latest as {score:number|null;questions:string}) && (!b.override || b.reason.length < 10))
        return fail(
          400,
          "For an override, record why the child demonstrated understanding or which question was flawed.",
        );
      if(!rewards.reserve(a))return fail(409,dailyLimitMessage);
      const id = randomUUID();
      db.prepare(
        "INSERT INTO awards(id,assignment_id,stars,reason) VALUES(?,?,?,?)",
      ).run(id, a.id, a.stars, b.reason || "Passed quiz and parent discussion");
      db.prepare(
        "UPDATE assignments SET status='completed',retry_credit=0 WHERE id=?",
      ).run(a.id);
      audit(
        b.override ? "reward_override" : "reward_approved",
        a.id,
        b.reason || "Parent discussion complete",
      );
      return db.prepare("SELECT * FROM awards WHERE id=?").get(id);
    });
    res.json(result);
  });
  app.post("/api/parent/awards/:id/record", auth, parent, (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare("SELECT id FROM awards WHERE id=?").get(id))
      return fail(404, "Award not found.");
    const result = db
      .prepare(
        "UPDATE awards SET recorded=CURRENT_TIMESTAMP WHERE id=? AND recorded IS NULL",
      )
      .run(id);
    if (result.changes)
      audit("reward_recorded", id, "Parent confirmed manual reward recording");
    res.json({ ok: true });
  });
  const staticDir = resolve(options.staticDir || "dist");
  app.use(
    express.static(staticDir, {
      index: false,
      setHeaders(res, file) {
        if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api/"))
      return res.status(404).json({ error: "Endpoint not found." });
    if (!existsSync(join(staticDir, "index.html")))
      return res
        .status(503)
        .send("Build the Reading Stars interface with npm run build first.");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(staticDir, "index.html"));
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ZodError)
        return res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" ")
            .slice(0, 1500),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof multer.MulterError)
        return res.status(400).json({
          error:
            error.code === "LIMIT_FILE_SIZE"
              ? "Uploads must be 20 MB or smaller."
              : "Please upload one file at a time.",
        });
      // Never log request bodies, credentials, provider responses, or raw database errors.
      res.status(500).json({
        error:
          "Something went wrong. Your saved work is safe. Please try again.",
      });
    },
  );
  return { app, db };
}
