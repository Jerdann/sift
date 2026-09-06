# Mail handling

Sift proposes actions using the message's purpose, not just the company that sent it. A single sender can send a receipt, a login code, and a sale. Those messages should not all share a folder or a read-status rule.

## Controls

In Organize, choose a message type and review examples from the saved scan. Choices apply to the current account unless you select profile defaults or a specific confirmed alias. Account choices override profile defaults; alias choices override the account. Resetting a scope restores its inherited choices.

- **Folder detail:** separate specific message types, or group them into fewer folders. Only selected destinations are created. Split aliases get their own folders.
- **Evidence:** clear subject matches only, or also tentative matches from locally saved text. Tentative matches are not exported as future filters or used for Spam/Trash.
- **Destination:** file the message, leave it in place, or send eligible low-value types to Spam or Trash.
- **Read status:** preserve the current status or mark read. Login codes, account security changes, payment problems, refunds, shipping updates, and active travel preserve status by default.
- **Age:** keep indefinitely or offer a separate Trash review after the chosen number of days. This is not a background expiration task.

Moving unread mail out of Inbox can affect mobile notifications. Choose **Leave in place** for mail that needs to remain in Inbox. Sift cannot guarantee how a phone or provider handles notifications.

## Matching logic

Sift first holds suspicious authentication failures and conversations for review. Subject evidence for login/security, payment problems, receipts, delivery, and travel is checked before promotional handling. Surveys, sales, newsletters, service notices, and announcements are distinct types. A mailing-list or unsubscribe header alone does not identify the purpose of a message.

The matching score is a heuristic, not a measured accuracy percentage. A subject can be vague, misleading, or use unsupported wording. Uncertain messages remain unchanged. Review examples rather than assuming every message was recognized.

Future rules combine exact observed sender addresses, one confirmed receiving alias, and subject conditions. They exclude higher-priority purposes and replies. Proton uses delivery headers for alias matching; messages without those headers will not match that alias rule. Mail addressed to multiple confirmed aliases is held instead of choosing an arbitrary container. Gmail and Outlook support narrower subject conditions than the local classifier, so some local classifications will not produce an automatic rule.

Spam review does not mean blocking an entire company's domain. Protected records and actionable purposes are excluded. Some suspicious messages cannot produce a safe future rule; review the actual rule list. Sift uses native Spam/Junk destinations but does not edit a provider-private blocked-sender list or claim to train its spam model.

## Updating an existing organization

1. Finish active mail operations before restarting for the update. Updating alone changes no provider mail or filters.
2. Scan again if messages or folders changed. Otherwise, **Build from mailbox** rebuilds the local proposal using the saved scan and new classifier.
3. Choose handling settings and review the shared and alias-specific folder lists. Approve folder creation. Matching folders are reused.
4. Complete Spam review before ordinary filtering.
5. In Rules, review existing-message changes separately from future filters. Old custom folders can be retired after approved mail moves; nonempty folders are retained. Existing protected or uncertain mail is not silently relocated just to empty a folder.
6. Review and install the new future filters. For Proton, disable conflicting old filters and import the new Sieve file in Proton Mail. Bridge cannot read, delete, or install server-side filters for Sift.
7. Use Unsubscribe and Delete as separate reviews. Failed unsubscribe requests do not require successful completion before Delete.

New drafts require new approval. Completed-action records remain available for Recovery; interrupted forward plans made by the older classifier will not resume. Rebuilding a proposal is different from **Delete saved scan**, which removes local index records and should not be needed for an ordinary update.

No action permanently deletes mail. Spam and Trash may be automatically emptied by the provider, so treat those choices as potentially irreversible over time. Exported Sieve files contain the user's addresses and sender rules; keep them private.
