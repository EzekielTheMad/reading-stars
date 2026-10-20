# Security

This is an early family self-hosting application, not a multi-tenant service. Run one household per instance. Child profiles share access and can see the shared bookshelf; they do not provide identity verification between siblings. Parent actions require the separate PIN.

Keep real installations behind HTTPS when accessed over untrusted networks. Use unique credentials and protect `.env`, the data directory, and backups. Never expose the local demo: its password and PIN are deliberately public. The demo command is loopback-only and disables paid AI.

For a vulnerability, use the repository's private **Security → Report a vulnerability** option when available. If unavailable, open a minimal issue asking for a private reporting channel without disclosing exploit details. Do not include family data, passwords, tokens, source books, or raw databases. No third-party security audit or compliance certification is claimed.
