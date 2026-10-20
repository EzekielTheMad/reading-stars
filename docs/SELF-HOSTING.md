# Self-hosting Reading Stars

Reading Stars runs as a single Node.js process with SQLite and private uploads. Node 24.14+ is required for the built-in SQLite API. Build the React client before starting the server. Production has no demo accounts or sample books unless you explicitly run the separate demo command.

## Configuration

`node scripts/configure.mjs` writes a new private `.env` with a random first-run setup token. It never overwrites a file. The regular Node server loads `.env`; Compose interpolates it. Keep it out of version control and restrict file access.

| Variable | Default / purpose |
| --- | --- |
| `HOST` | `127.0.0.1` for Node; Compose sets the container listener to `0.0.0.0` |
| `PORT` | `8787` inside the app |
| `DATA_DIR` | `./data`; Compose uses `/app/data` and a named volume |
| `PUBLIC_ORIGIN` | Exact browser origin, including port; default `http://127.0.0.1:8787` |
| `COOKIE_SECURE` | `false` for local HTTP; must be `true` for HTTPS |
| `SETUP_TOKEN` | Random private token required on the first setup screen |
| `READING_TIME_ZONE` | IANA timezone such as `Europe/London`; default `UTC` |
| `BIND_ADDRESS` / `HOST_PORT` | Compose only: default `127.0.0.1` / `8787` |
| `OPENAI_API_KEY` | Optional; blank disables AI preparation |
| `OPENAI_MODEL` / `OPENAI_SEARCH_MODEL` | Optional provider model IDs; defaults in `.env.example` |
| `AI_DAILY_LIMIT` | Default 10 preparation requests per UTC day, including failed calls |

Set the timezone before the first rewarded finish. Daily ledger dates already recorded are preserved; changing timezone afterward can make a transition day inconsistent. Reader and book difficulty bands are parent-entered, and do not auto-promote children.

With no setup token, only direct localhost first-run setup is allowed. Docker networking generally needs the setup token even when the host mapping is loopback. Once setup finishes, subsequent setup requests are rejected. There is no password recovery email service; keep credentials in your password manager.

## LAN and HTTPS

The demo always binds to loopback and has public credentials. Do not publish it or use it as your household installation.

For the regular app on a trusted LAN, set `PUBLIC_ORIGIN` to the exact URL used by the tablet and `HOST=0.0.0.0` for Node or `BIND_ADDRESS=0.0.0.0` for Compose. Permit only intended clients in your firewall. HTTP is suitable for a local trial, but does not encrypt the family password in transit.

For access over an untrusted network, use HTTPS through a reverse proxy. Keep the app bound to loopback where the proxy is on the same host; set `PUBLIC_ORIGIN=https://your-reading-host.example` and `COOKIE_SECURE=true`. Recreate only this service after changing Compose environment settings. No particular DNS, tunnel, cloud provider, or private server is required. The app deliberately does not trust client-supplied forwarded headers.

Use the configured origin consistently: `localhost` and `127.0.0.1` are different origins. Incorrect origin or secure-cookie settings commonly explain setup/login problems. Do not disable the origin checks to work around them.

## Books and questions

Parents add books, licensed covers, source notes, and checked questions. Books appear on the shared child shelf only when an actual cover file and valid approved quiz exist. Missing word counts, difficulty bands, or sufficient questions block new automatic choices with a preparation message. Edition flags and parent suitability checks remain truthful parent metadata.

Sources may be uploaded as PDF or unencrypted EPUB, up to 20 MB; covers are PNG/JPEG/WebP up to 5 MB, with five uploads per book. Text extraction is bounded to 500 PDF pages and 240,000 characters. Sparse or truncated text needs parent review. Full source text and answer keys are not sent through child APIs.

AI preparation is optional and parent-triggered. It needs a separately funded API credential and does not run paid background jobs or automatically retry. The daily request count is not a dollar spending cap; configure provider limits too. No live provider success is claimed by the offline tests.

## Backup and restore

For Node, run `npm run backup` or `npm run backup -- /private/path/new-backup-folder`. The destination must be new and outside `DATA_DIR`. The backup uses SQLite's online backup API and copies uploads; it contains password/PIN hashes and household data. Runtime environment/API keys are excluded and must be stored separately.

For Compose:

```sh
docker compose exec reading-stars npm run backup -- /tmp/reading-backup
docker compose cp reading-stars:/tmp/reading-backup ./reading-backup
```

Use a new destination each time. `/tmp` is limited to 128 MB: for larger libraries, mount a private backup directory or stop the service and back up the whole named volume. Never copy just an active SQLite main file without its WAL. Store backups outside the container before recreating it.

To restore, stop only Reading Stars, preserve its current data, restore the backup database and uploads into the data directory/volume, and ensure the runtime user (UID/GID 1000 in the image) can read/write them. Restart and verify login, an unfinished quiz, a source upload, and reward history. Never overwrite newer progress with an older backup without reconciling it.

## Updates and recovery

Back up current data and keep the previous image/source before updating. For a source installation, install the new locked dependencies and rebuild; for Compose, use `docker compose up -d --build`. Check `/api/health`, login, and a representative reader/parent workflow.

Rewards, quiz versions, saved answers, and quiz lengths are pinned for existing adventures. Schema changes are additive in this release. An older application that only understands five-question quizzes is incompatible with ten-question history: use a compatible fix-forward release after such activity exists, not an old database restore.

## Verification limits

The prepared public package is tested with fictional data: clean first-run setup, demo login, child/parent boundaries, real cover routes, saved answers, scoring, parent approval/recording, reward settings, and responsive browser screenshots. The Node build/test suite covers longer quizzes, concurrency and backup/restore. Container verification is recorded separately when performed. These checks do not prove your reverse proxy, backups, tablets, audio, model access, or factual quality of independently entered books.
