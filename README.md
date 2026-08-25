# Sift

Sift is a local-first Windows desktop application that turns years of crowded Proton Mail and Gmail history into an understandable, maintainable system. It maps accounts and subscriptions, proposes labels and rules, prunes promotional clutter, and applies only the changes you approve.

Install Sift once with `Sift-Setup.exe`. Installed builds check the public GitHub release feed for updates, download newer versions in the background, and ask before restarting to apply them.

## Current status

The working desktop build supports:

- Proton Mail through the local Proton Mail Bridge: discovery, resumable metadata-first history audit, proof-based alias detection, per-address containers, local classification, sender recency review, approval-gated folder cleanup, native Spam and Trash routing, safe bulk unsubscribe, and Proton Sieve export.
- Gmail through Google OAuth for Desktop apps: resumable metadata-only history audit, local classification, an exact approval plan, nested labels, future filters, historical mark-read/archive batches, native Spam labeling, and authenticated one-click bulk unsubscribe.
- Provider-neutral local profiles and portable JSON rule packs, so separate people and mailboxes do not share data or credentials.

No permanent deletion is implemented. The final cleanup pass moves only approved stale history to the provider's recoverable Trash. Personal, security, account, transaction, finance, suspicious, uncertain, and mixed-use sender streams are excluded from that pass.

No provider password, OAuth token, address, subject, body, or raw message content belongs in source control, logs, fixtures, or diagnostics.

## Development

Requirements:

- Windows 10 or 11 x64
- Node.js 24 for the development toolchain
- pnpm 10

Install and run:

```powershell
pnpm install
pnpm start
```

The renderer runs with Electron sandboxing and context isolation. It has no Node.js, filesystem, database, shell, or generic IPC access.

## Verification

```powershell
pnpm typecheck
pnpm test:unit
pnpm test:e2e
pnpm test
```

All fixtures are synthetic. End-to-end tests use a newly generated temporary profile root and remove it after the Electron process closes.

## Windows package

```powershell
pnpm package
pnpm verify:package
pnpm smoke:package
pnpm make
```

The packaged application directory is written to `out/Sift-win32-x64`. Package verification requires the app executable, asar resources, and unpacked native SQLite binding, and rejects development files, source maps, environment files, and known privacy canaries.

`pnpm make` creates a no-admin Squirrel.Windows installer and update artifacts in `out/make/squirrel.windows/x64`, plus a portable ZIP in `out/make/zip/win32/x64`. The installer is the recommended build because it receives automatic updates.

## Releases

Pushing a semantic-version tag such as `v0.3.0` runs the Windows release workflow. It verifies the project, builds the Squirrel installer, and publishes `Sift-Setup.exe`, the full update package, and the `RELEASES` manifest to GitHub Releases. The public Electron update service discovers only complete, non-draft releases.

## First-run setup

### Proton Mail

1. Install and sign in to Proton Mail Bridge.
2. In Bridge, open the mailbox configuration and copy the generated IMAP username, password, port, and security mode.
3. Create or open a Sift local profile, enter those Bridge credentials, map the mailbox, then start the read-only scan.
4. Review the proposal before approving cleanup or unsubscribe actions. Sieve export writes a file for manual review/import in Proton Mail settings; it never overwrites server filters directly.

### Gmail

Google requires the person distributing the app to provide an OAuth client:

1. Create a Google Cloud project, enable the Gmail API, and configure an OAuth consent screen.
2. Add `gmail.modify` and `gmail.settings.basic` scopes. While the project is in Testing, add each Gmail address—including a partner's address—as a test user.
3. Create an OAuth client with application type **Desktop app** and copy its client ID.
4. In Sift, paste the client ID and choose **Open Google sign-in**. The app uses the system browser, PKCE, and a random `127.0.0.1` callback; it never receives the Google password.
5. Run the Gmail audit, build the organization proposal, review the exact impact, and approve the action plan.

Testing-mode Google grants can expire after seven days. A broadly distributed build needs Google's OAuth verification for the requested Gmail scopes.

## Privacy boundary

- Profile paths use generated IDs, never display names.
- Each profile has a separate SQLite database and encrypted-secret namespace.
- Secret plaintext is encrypted with Electron `safeStorage`; storage fails closed when OS encryption is unavailable.
- Renderer IPC commands and results are runtime validated.
- Email HTML is never rendered and remote resources are blocked.
- No permanent delete, address shutdown, body-link unsubscribe, or external content upload is part of Sift.
- Automated unsubscribe is limited to authenticated RFC 8058 HTTPS one-click endpoints. Likely spam is never contacted.
