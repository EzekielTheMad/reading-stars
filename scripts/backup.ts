import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
export async function backupData(dataDir: string, outputDir: string) {
  const source = resolve(dataDir),
    destination = resolve(outputDir),
    rel = relative(source, destination);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw new Error("Choose a backup destination outside the data directory.");
  if (existsSync(destination))
    throw new Error(
      "Backup destination already exists. Choose a new directory.",
    );
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(source, "reading-stars.sqlite"), {
    readOnly: true,
  });
  const schema=(db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version;
  try {
    await backup(db, join(destination, "reading-stars.sqlite"));
  } finally {
    db.close();
  }
  if (existsSync(join(source, "uploads")))
    cpSync(join(source, "uploads"), join(destination, "uploads"), {
      recursive: true,
    });
  writeFileSync(
    join(destination, "backup-info.json"),
    JSON.stringify(
      {
        created: new Date().toISOString(),
        schema,
        includes: ["database", "uploads"],
        excludes: ["API keys", "runtime environment"],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return destination;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const dest =
    process.argv[2] ||
    join(
      "backups",
      new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"),
    );
  console.log(
    `Backup saved: ${await backupData(process.env.DATA_DIR || "data", dest)}`,
  );
}
