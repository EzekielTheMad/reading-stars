# Public release verification — 0.1.0

Prepared October 20, 2026 using only fictional households. The private running installation is outside this repository and was not modified.

## Passed before publication

- Locked dependency installation, TypeScript/Vite production build, and 32 automated tests.
- Tests cover empty-household setup without demo credentials/readers/books, demo isolation, normal authentication/PIN boundaries, actual cover files, accurately counted original text, five/ten-question scoring, save/resume, retries, fixed rewards/quiz versions, parent approval/recording, daily limits, uploads, backup/restore, and configurable timezone behavior.
- A real loopback HTTP smoke workflow logged in, loaded three covers, chose a story, saved/resumed answers, passed a quiz, enforced parent authorization, approved/recorded an award idempotently, and checked independent daily allowances.
- Chromium demo workflow completed all five questions, saved/resumed answers, approved/recorded the reward after PIN entry, and displayed Activity. Switching from parent mode to another reader relocked server parent access. No browser page errors were observed; reward settings had no horizontal overflow at 320/390 pixels.
- Five screenshots were captured from that fictional demo. Cover art, stories, and questions are original project sample content. No private installation screenshot was reused.
- Public-package file scan, documentation link checks, and human inspection of the publication list. Runtime data, `.env`, backups, local demo progress, and private deployment material are excluded from Git and the source archive. Automated scanning is not a guarantee that every possible secret can be detected.
- Dependency inventory and license/notice texts generated from locked dependencies; root application/demo license is MIT.

## Limits and CI

The local Docker daemon was unavailable, so the container was not exercised locally during preparation. GitHub Actions is configured to independently build/test the Node app on Linux and build/run the exact Docker image through the disposable HTTP smoke workflow with no network access and a read-only root. Check the Actions result for the commit you deploy; a workflow definition alone is not a passing run.

Physical tablet/audio support, your reverse proxy, disaster recovery on your host, real optional AI provider access, and factual correctness of books entered by users remain outside these checks. The demo contains only short stories; longer-book scoring is exercised by automated fixtures rather than a fabricated full-length sample.
