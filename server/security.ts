import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { DB } from "./db.ts";

export function hashSecret(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
export function verifySecret(value: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = scryptSync(value, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function cookieToken(req: Request) {
  return /(?:^|;\s*)reading_session=([a-f0-9]{64})(?:;|$)/.exec(
    req.headers.cookie || "",
  )?.[1];
}
export function sessionFor(db: DB, req: Request) {
  const token = cookieToken(req);
  return token
    ? (db
        .prepare("SELECT * FROM sessions WHERE id=? AND expires>?")
        .get(tokenHash(token), Date.now()) as
        { id: string; parent_until: number } | undefined)
    : undefined;
}
export function requireAuth(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!sessionFor(db, req))
      return res
        .status(401)
        .json({ error: "Please sign in to your family bookshelf." });
    next();
  };
}
export function requireParent(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((sessionFor(db, req)?.parent_until || 0) <= Date.now())
      return res
        .status(403)
        .json({
          error: "Enter the parent PIN to continue.",
          code: "PARENT_REQUIRED",
        });
    next();
  };
}
export function newSession(
  db: DB,
  res: Response,
  secure: boolean,
  parent = false,
) {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 30 * 86400000;
  db.prepare("INSERT INTO sessions(id,expires,parent_until) VALUES(?,?,?)").run(
    tokenHash(token),
    expires,
    parent ? Date.now() + 10 * 60000 : 0,
  );
  res.cookie("reading_session", token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    maxAge: 30 * 86400000,
    path: "/",
  });
}
