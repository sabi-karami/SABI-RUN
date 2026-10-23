# Security / امنیت

This is a preview release, not an independently audited product.

## Fixed locally
- Management API authentication and reseller ownership checks.
- Salt-derived admin/reseller session cookies; global session revocation.
- Cross-origin write rejection.
- Telegram webhook authentication before message parsing.
- Secret exclusion from settings and backups.
- Atomic initial password creation; fail-closed authentication on D1 failure.
- Removed embedded credential and remote private-state control.

## Known limitations
Password hashes still use SHA-256; use a long random password. Login throttling is isolate-local. Subscription links remain bearer secrets; username-based lookup is retained for compatibility. Some public upstream/SOCKS fallback behavior is retained. SHA-256 release checksums are not signed releases. No full load test, external penetration test, or end-to-end tunnel validation has been performed.

Cloudflare blocked redeployment with 8000119. The latest fixes in this repository are **not deployed** to the first published sample. Do not use that sample for sensitive production data.

Report issues privately to the repository owner. Never post tokens, panel passwords, UUID subscriptions, or full backups in public issues.
