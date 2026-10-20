import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");
const { values: args } = parseArgs({
  options: { "data-dir": { type: "string" } },
});
const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 8787);
const origin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
const secure = process.env.COOKIE_SECURE === "true";
if (!/^https?:\/\//.test(origin))
  throw new Error("PUBLIC_ORIGIN must be an absolute HTTP(S) origin.");
if (origin.startsWith("https:") && !secure)
  throw new Error("HTTPS hosting requires COOKIE_SECURE=true.");
const dataDir = resolve(args["data-dir"] || process.env.DATA_DIR || "data");
const { app, db } = createApp({
  dataDir,
  origin,
  secureCookies: secure,
  setupToken: process.env.SETUP_TOKEN,
  timeZone: process.env.READING_TIME_ZONE || "UTC",
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT || 10),
});
const server = app.listen(port, host, () =>
  console.log(
    `Reading Stars: ${origin}\nPID ${process.pid}; parent ${process.ppid}; cwd ${process.cwd()}; listening ${host}:${port}; started ${new Date().toISOString()}`,
  ),
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
