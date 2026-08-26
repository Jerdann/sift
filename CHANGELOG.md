# Changelog

All notable changes to Sift are documented here. Releases follow [Semantic Versioning](https://semver.org/), and the format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [1.0.1] - 2026-08-25

### Fixed

- Packaged smoke tests now keep their temporary `--user-data-dir` even when a pre-rename Mail Steward profile directory exists, preventing synthetic “Package smoke” profiles from appearing in real local data.
- The packaged runtime test now verifies its resolved Electron user-data directory before it is allowed to create a synthetic profile and fails closed if isolation is lost.

## [1.0.0] - 2026-08-25

### Added

- A dedicated Recovery workspace with repeatable local database health checks and a content-free JSON diagnostic export that contains version, platform, schema, integrity, and count data only.
- Authenticated AES-256-GCM local-profile backups whose random keys are protected by the current Windows user's OS encryption, plus same-profile restore with checksum, schema, integrity, foreign-key, and encrypted-secret-set validation.
- Staged restore with automatic rollback until the restored profile opens successfully.
- An explicit local-index rebuild that clears downloaded metadata and derived proposals while preserving provider connections, encrypted credentials, managed-rule ownership, unsubscribe history, and all provider mail.
- Production bundle performance budgets and clean-profile onboarding assertions for independent Gmail, Outlook/Hotmail, and Proton workflows.
- Public recovery, rollback, uninstall, and shared-computer guidance.

### Changed

- The guided navigation now includes Recovery as its own action-oriented page.
- Release verification now gates renderer, preload, and main-process bundle sizes in addition to type, unit, Electron, privacy, packaging, and runtime checks.

### Fixed

- Outlook and Hotmail accounts are identified correctly in the shared account list instead of falling through to Proton copy.

### Security

- Backup restore is limited to the same generated local profile and OS-protected key context, rejects oversized or malformed payloads, validates authenticated encryption metadata, and refuses newer unsupported database schemas.
- Recovery confirmations are schema-locked to exact phrases before restore or index rebuild can run.
- Diagnostic reports exclude profile IDs, local paths, addresses, domains, subjects, message identifiers, headers, bodies, and secrets by construction and by privacy-canary tests.
- The production dependency audit reports no known vulnerabilities for v1.0.0.

## [0.9.0] - 2026-08-25

### Added

- Outlook, Hotmail, and Microsoft 365 connections through Microsoft public-client OAuth authorization code flow with PKCE, a system-browser consent screen, a loopback callback, and no client secret.
- Resumable Microsoft Graph metadata audits with trusted paging links, well-known folder discovery, immutable message IDs, local classification, and address-scoped organization proposals.
- Strict Microsoft identity discovery from provider profile aliases and Sent Items `From` evidence; recipients, copied participants, forwarding participants, and arbitrary delivery addresses cannot become owned identities.
- Verified Outlook history execution with nested folder creation, native Junk Email and Deleted Items routing, per-message checkpoints, selective retry, and exact original-folder/read-state Undo.
- Live Outlook inbox-rule inventory and reconciliation with deterministic Sift ownership, exact-match adoption, unrelated-rule protection, post-write verification, selective retry, and Undo.
- Outlook authenticated RFC 8058 one-click unsubscribe with provider-neutral ranking, recurrence tracking, per-host throttling, resume, and selective retry.
- Outlook stale-sender review with the same age boundary and protected critical categories used by Gmail and Proton.

### Changed

- The shared account, identity, proposal, rule, unsubscribe-ledger, job, export, and UI contracts now support Proton, Gmail, and Outlook without provider-specific address heuristics.
- Microsoft organization, rules, unsubscribe, and Trash actions appear in the same guided pages and approval sequence as existing providers.
- The minimum desktop window width now permits the compact application layout used on small laptops.

### Security

- Microsoft Graph continuation links are restricted to the official Graph origin before Sift reuses them.
- Refresh tokens remain encrypted outside the renderer, and the sealed preload bridge exposes only schema-validated Outlook operations.
- Outlook history execution uses immutable IDs plus live before/after checks; Undo refuses to overwrite messages whose provider state no longer matches Sift's receipt.
- Suspected spam is routed to provider-native Junk and is never contacted by the unsubscribe runner.

## [0.8.0] - 2026-08-25

### Added

- A dedicated Addresses workspace between Scan and Organize for evidence-backed ownership confirmation and per-address container decisions.
- An explicit connect → scan → addresses → organize → rules → unsubscribe → Trash workflow on the overview and primary navigation.
- A common per-account capability contract covering audit, identity evidence, folders/labels, live/exported rules, authenticated unsubscribe, native Spam, and native Trash.
- An account capability matrix that explains provider differences in context without lowering the quality of the common workflow.
- A compact application layout with an accessible icon navigation bar, single-column workflow, and horizontal containment for data-heavy review surfaces.

### Changed

- Account connection controls no longer run mailbox scans; the Scan page owns read-only inventory actions.
- Identity review is no longer embedded in Organize, and organization remains blocked until every selected mailbox has resolved ownership evidence and at least one confirmed identity.
- Organize now focuses only on correcting proposals and applying approved historical filing; future automation remains isolated on Rules.
- Overview always routes to the earliest unfinished stage instead of skipping directly from scan to organization.

### Security

- Address ownership requirements are enforced as a workflow prerequisite rather than explanatory copy alone.
- Provider capability gaps are represented by validated contract values and cannot silently fall back to an unrelated action.

## [0.7.0] - 2026-08-25

### Added

- Durable Gmail and Proton bulk-unsubscribe jobs with streamed progress, crash recovery, selective retry, verified outcomes, and a recurrence ledger that identifies lists which continue sending afterward.
- Provider-neutral subscription ranking using delivery frequency, recency, receiving address, read rate, accumulated volume, and low-value category signals.
- Separate manual-action, protected-mail, and spam-blocked unsubscribe queues.
- A shared stale-stream review that shows alias scope, newest activity, removable volume, and protected volume before approval.
- Native Gmail Trash batches with immutable age-bounded plans, live label preconditions, post-move verification, selective retry, and exact-label Undo.

### Changed

- One-click requests are paced per destination host and run only for explicitly selected authenticated RFC 8058 HTTPS endpoints.
- Gmail and Proton stale-history review now uses the same six-month default and the same protected critical categories.
- Gmail's local audit index is synchronized after verified history changes and Undo so later pruning plans cannot rely on stale label state.

### Security

- Suspected spam is never contacted during unsubscribe; it remains isolated for provider-native Spam handling.
- Trash proposals exclude security, account, transaction, finance, personal, suspicious, recent, already-spam, and already-trashed Gmail messages.
- No deletion path bypasses provider Trash, and every supported move retains the exact prior provider state needed for verified recovery.

## [0.6.0] - 2026-08-25

### Added

- A dedicated Rules workspace that inventories provider rules before proposing any change.
- Deterministic Gmail filter reconciliation with stable Sift ownership, exact-match adoption, selective retry, provider verification, and supported undo.
- Checksum-tracked Proton Sieve exports that clearly separate locally managed artifacts from server-side filters Proton Bridge cannot inspect.
- Verified Proton history moves with destination UID and UIDVALIDITY receipts, exact prior-flag restoration, selective retry, and Undo.
- Durable 100-message Gmail history batches with live label preconditions, post-change verification, streamed progress, selective retry, crash recovery, and exact-label Undo.

### Changed

- Future automation and existing-history organization are now separate actions: filters live on Rules, while historical moves and labels stay in Organize.
- Gmail and Proton history plans now use the corrected address-scoped proposal rather than the raw classifier output.
- Rule generation uses source category plus proven receiving address, so corrections remain stable without conflating unrelated recipients or senders.
- Gmail history execution reuses one access token per run and never creates future filters as a side effect of organizing old mail.

### Security

- Unrelated Gmail filters are explicitly classified as external and cannot be replaced or deleted by Sift.
- Provider operations require immutable revision approval, re-check current provider state, and record only non-secret verification metadata.
- Gmail and Proton Undo operations refuse to overwrite mail whose provider state changed after Sift’s verified action.

## [0.5.1] - 2026-08-25

### Fixed

- Gave clean Windows release runners enough time to download and launch Electron before the first UI assertion.

## [0.5.0] - 2026-08-25

### Added

- Address-scoped organization proposals with evidence, recency, representative samples, and deterministic revisions.
- Local corrections for category, target path, and proposal inclusion before any mailbox change.

### Changed

- Organization proposals are grouped by confirmed address container and keep shared mail explicit.
- Same-domain transactional, security, and promotional streams remain independently reviewable.

## [0.4.0] - 2026-08-25

### Added

- Multiple Proton and Gmail connections inside one isolated local profile.
- Evidence-backed owned-address review with persistent confirmation, rejection, and container choices.
- A provider-neutral Accounts workspace with explicit mailbox switching and always-available add-account actions.
- Release validation that keeps the package version, Git tag, and changelog in sync.

### Changed

- Gmail address mapping now uses provider identity, Sent mail, and direct-delivery evidence instead of assigning every message to the primary address.
- Account selection is explicit and scopes all existing provider workflows.
- Organize now begins with an address evidence ledger; only confirmed identities can reach categories, rules, cleanup, or retirement guidance.
- Release verification now includes type checking, unit tests, Electron end-to-end tests, package verification, runtime smoke testing, and the public privacy audit.

### Security

- Arbitrary message participants can no longer become user-owned identities merely by appearing in From, To, Cc, Bcc, Reply-To, or group-recipient fields.
- Account and identity operations remain restricted to the active local profile through validated IPC contracts.

[Unreleased]: https://github.com/Jerdann/sift/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/Jerdann/sift/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Jerdann/sift/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/Jerdann/sift/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Jerdann/sift/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Jerdann/sift/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Jerdann/sift/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/Jerdann/sift/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Jerdann/sift/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Jerdann/sift/compare/v0.3.0...v0.4.0
