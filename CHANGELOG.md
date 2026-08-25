# Changelog

All notable changes to Sift are documented here. Releases follow [Semantic Versioning](https://semver.org/), and the format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Planned

- Per-address organization revisions and correction learning.
- Idempotent provider rule reconciliation.
- Durable unsubscribe and recoverable stale-mail pruning.

## [0.4.0] - 2026-08-25

### Added

- Multiple Proton and Gmail connections inside one isolated local profile.
- Evidence-backed owned-address review with persistent confirmation, rejection, and container choices.
- Release validation that keeps the package version, Git tag, and changelog in sync.

### Changed

- Gmail address mapping now uses provider identity, Sent mail, and direct-delivery evidence instead of assigning every message to the primary address.
- Account selection is explicit and scopes all existing provider workflows.
- Release verification now includes type checking, unit tests, Electron end-to-end tests, package verification, runtime smoke testing, and the public privacy audit.

### Security

- Arbitrary message participants can no longer become user-owned identities merely by appearing in From, To, Cc, Bcc, Reply-To, or group-recipient fields.
- Account and identity operations remain restricted to the active local profile through validated IPC contracts.

[Unreleased]: https://github.com/Jerdann/sift/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Jerdann/sift/compare/v0.3.0...v0.4.0
