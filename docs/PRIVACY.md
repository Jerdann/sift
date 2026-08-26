# Privacy and data retention

Effective August 26, 2026.

Sift is a local-first desktop application. It does not operate a hosted mailbox database, advertising system, product-analytics service, or telemetry backend. Sift stores its working data on the computer where it runs and connects directly to the mail services the user chooses.

## Data stored locally

Each local profile has an isolated SQLite database and encrypted secret namespace. Depending on the connected provider and enabled scan options, Sift retains:

- email addresses, sender domains, message identifiers, dates, subjects, selected headers, folder or label state, and classification results;
- Proton plain-text body excerpts only when the user explicitly enables optional body extraction; Gmail and Outlook scans are metadata-only;
- address-ownership decisions, containers, organization proposals, rule inventories, managed-rule ownership, unsubscribe history, cleanup plans, job checkpoints, verification receipts, and Undo receipts;
- OAuth refresh tokens and Proton Bridge credentials encrypted with the current Windows user's operating-system protection.

Sift does not download attachments. Provider mail remains with Proton, Google, or Microsoft. Sift does not offer permanent provider-mail deletion; approved deletion jobs use the provider's recoverable Spam, Junk, Trash, or Deleted Items location.

## Retention and removal

Local data is retained until one of the following actions removes it:

- **Disconnect an account:** removes that account's local connection, encrypted credential, provider-scoped index, and dependent analysis records.
- **Rebuild local index:** removes downloaded message metadata, classifications, address evidence, proposals, rule inventories, scan checkpoints, and incomplete local action jobs. It preserves provider connections, encrypted credentials, managed-rule ownership, and unsubscribe history.
- **Remove local profile files:** removes the remaining profile database, encrypted secrets, plans, ledgers, and receipts from that computer.

Uninstalling Sift may leave its application-data directory behind. Uninstall alone is not a secure-erasure promise. Disconnect accounts first on a shared computer and remove the Sift application-data folder separately when permanent local removal is required.

Encrypted `.siftbackup` files, exported diagnostics, Sieve files, and rule packs remain wherever the user chose to save them. Sift does not manage their retention after export.

Provider-side messages, folders, labels, Spam, Junk, Trash, and Deleted Items follow the provider's retention policy. Removing Sift's local records does not remove provider mail unless the user separately approved a provider mutation.

## Network connections

Sift may connect to:

- local Proton Mail Bridge;
- Google and Microsoft OAuth and mail APIs for accounts the user connects;
- authenticated one-click unsubscribe endpoints the user approves;
- the public Sift update service when automatic updates are enabled.

Sift does not send the local mailbox index, credentials, email addresses, subjects, headers, or message identifiers to the update service. An update request includes the installed Sift version, operating system, and processor architecture needed to select a compatible public release. Disabling automatic updates in Settings stops new scheduled update checks and background downloads; a request already in progress may finish.

## Updates and restart consent

Automatic updates are off by default. A user must enable them from Settings before Sift makes its first update request. When enabled, an installed Windows build checks its public GitHub release feed hourly and may download a completed release in the background.

The update prompt defaults to **Later**, so Sift does not force the current session to restart. Choosing **Restart and update** applies the downloaded update immediately. Electron applies an already-downloaded update the next time Sift starts even when the user chose **Later**; disabling updates cannot remove a release that Electron has already downloaded. Users who leave automatic updates disabled can install a chosen release manually from the public GitHub Releases page.

## Diagnostics and backups

Content-free diagnostics include application and operating-system version, database health, schema, file size, and aggregate counts. They exclude profile IDs, local paths, addresses, domains, subjects, bodies, headers, credentials, tokens, and provider message IDs.

Encrypted profile backups contain the local profile database and already-encrypted secret files. The backup payload is encrypted with AES-256-GCM, and its random key is protected for the current Windows user. Treat backup files as sensitive and retain or remove them according to your own storage policy.

## Provider policies

Google, Microsoft, Proton, unsubscribe services, GitHub, and the public Electron update service process direct requests under their own policies. Sift's policy describes Sift's local storage and behavior; it does not replace those services' terms or retention rules.
