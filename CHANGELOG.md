# Changelog

All notable changes to Sift are documented here. Releases follow [Semantic Versioning](https://semver.org/), and the format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Planned

- Durable unsubscribe retry, provider-aware throttling, and clearer manual-action queues.
- A unified age-aware stale-history planner across providers.
- Outlook and Hotmail account support.

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

[Unreleased]: https://github.com/Jerdann/sift/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Jerdann/sift/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/Jerdann/sift/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Jerdann/sift/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Jerdann/sift/compare/v0.3.0...v0.4.0
