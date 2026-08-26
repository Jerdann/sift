# Recovery and maintenance

Sift keeps each person's provider connections, local mail index, decisions, and job receipts in an isolated local profile. Provider mail remains with Proton, Google, or Microsoft. The Recovery page provides explicit maintenance actions for that local data.

## Content-free diagnostics

**Check local health** runs SQLite integrity and relationship checks and reports only:

- Sift version, operating system, and processor architecture
- database schema version and file size
- provider connection and indexed-message counts
- durable job-state counts
- OS encryption availability

The exported JSON report never includes profile IDs, local paths, email addresses, sender domains, subjects, bodies, headers, credentials, tokens, or provider message IDs. Review the small JSON file before attaching it to a public issue.

## Encrypted profile backups

**Create encrypted backup** takes a consistent SQLite snapshot and includes the profile's already-encrypted provider secret files. The complete payload is compressed and encrypted with AES-256-GCM. Its random encryption key is then protected with Electron `safeStorage`, which uses the current Windows user's operating-system encryption.

Consequences:

- Treat a `.siftbackup` file as sensitive even though its contents are encrypted.
- Restore with the same Windows user on the same device. Sift does not claim these backups are portable between Windows users or computers.
- A restore must target the same generated Sift profile ID. It cannot overwrite a different person's local profile.
- Sift authenticates the encrypted payload, verifies every checksum, runs SQLite integrity and foreign-key checks, rejects newer unsupported schemas, stages the replacement, and keeps the previous files available for automatic rollback until the restored profile opens successfully.
- Restoring a local backup never changes provider mail by itself. It restores Sift's local view and receipts.

Type `RESTORE LOCAL PROFILE` in the Recovery page before choosing a backup. Create a fresh backup before installing an older release or attempting a restore.

## Rebuild the local index

Use **Rebuild local index** when an audit or proposal is stale or damaged. Type `REBUILD LOCAL INDEX` to confirm.

The rebuild removes downloaded message metadata, classifications, address evidence, organization proposals, rule inventories, scan checkpoints, and incomplete local action jobs. It preserves:

- provider connections and OS-encrypted credentials
- account selection
- Sift-managed rule ownership records
- the unsubscribe recurrence ledger
- every message, folder, label, and rule held by the provider

Run Scan again after rebuilding. Existing provider rules are inventoried again before Sift proposes further rule changes.

## Updates and rollback

Automatic updates are off until the user enables them in Settings. Enabled installed Windows builds can check completed public GitHub releases hourly and download newer Squirrel packages in the background. The prompt defaults to **Later**, which keeps the current session open; Electron applies an already-downloaded update the next time Sift starts.

To roll back:

1. Create an encrypted profile backup.
2. Download the earlier `Sift-Setup.exe` from GitHub Releases.
3. Close Sift and run the installer.
4. Open the existing local profile and run **Check local health**.

An older build may not understand a profile already migrated by a newer version. Prefer restoring the backup made by the older version when its schema is compatible. Sift refuses to restore a backup whose schema requires a newer build.

## Uninstall and shared computers

Disconnect provider accounts before removing Sift from a shared computer. Uninstalling the application may leave encrypted local profile data in the Windows application-data directory. Uninstall alone is not a secure-erasure promise.

Sift intentionally does not offer an in-app permanent provider-mail deletion command. Approved cleanup goes only to the provider's recoverable Spam/Junk or Trash/Deleted Items location.
