# Mail handling

Sift proposes actions using the message's purpose, not just the company that sent it. A single sender can send a receipt, a login code, and a sale. Those messages should not all share a folder or a read-status rule.

## Controls

In Organize, first choose Main folders or a separate address. Then choose a mail group and review examples from the saved scan. Main-folder previews exclude separate addresses. Account choices override profile defaults; individual-address choices override the account. Advanced defaults and individual-address settings are available below the editor.

## Separate folder trees

**Separate email addresses** stays visible after addresses are confirmed. Choose an address, then **Create separate tree**. Name its parent folder and select its tab to edit only that address's mail. Main and separate-tree future rules exclude the other confirmed addresses; mail with multiple possible owners stays out of automatic routing.

**Copy main choices** copies the current main draft or saved group choices and folder detail into the selected address's draft. It preserves that address's sender rules and never copies a sender rule for a different recipient. Saving makes this an independent copy; later changes to the main tree do not overwrite it. An address with no saved choices inherits the main choices until it is customized.

**Use main folders** changes the proposed destinations but keeps the address's handling choices. Those choices remain editable under **Other account and address settings**. No existing folder is renamed or removed by these controls; review and approve the resulting plan separately.

## Group controls

- **Folders and groups:** Fewer combines related types into fewer folders and fewer groups to edit. More detail separates specific types. Only needed, selected destinations are created. Split aliases get their own folders.
- **Match strictness:** Strict uses clear subject matches. Normal also tries similar wording after punctuation and spacing changes. Broad is offered only when locally saved message text is available. Tentative matches never become future filters or Spam/Trash actions.
- **Keep / File / Spam / Trash:** leave the message in place, file it, or send eligible low-value types to Spam or Trash.
- **Read status:** preserve the current status or mark read. Login codes, account security changes, payment problems, refunds, shipping updates, and active travel preserve status by default.
- **Age:** keep indefinitely or offer a separate Trash review after the chosen number of days. This is not a background expiration task.

Moving unread mail out of Inbox can affect mobile notifications. Choose **Keep** for mail that needs to remain in Inbox. Sift cannot guarantee how a phone or provider handles notifications.

Examples update while you edit. Each has a KEEP, FILE, SPAM, TRASH, or REVIEW label and shows the destination and read-status action. **Show the rule** explains the conditions. A mixed group retains different read-status defaults until you explicitly change them.

## Sort unknown mail in groups

**Needs sorting** lists exact sender/address pairs, largest first, with eight groups per page. Select a sender, choose a category and action, and optionally require words in the subject. The preview shows the matching count and both included and excluded examples. **Use this rule** adds the group choice to your draft. You can edit or remove sender rules before saving.

Rules match exact sender addresses, not an entire company or domain. They only override unclassified or low-value mail; detected payments, security, account actions, personal replies and other protected records remain under their own group choices. This is not proof that every unknown message is disposable. Vague subjects and unavailable bodies can conceal important content.

After saving, existing-message actions still require approval in Rules. Future sender filters use the exact sender, alias and optional subject words, with protected-purpose exclusions. They replace Sift's ordinary future rules for that sender/address pair to avoid conflicting actions. Other mail from that sender can therefore stay in Inbox. External provider filters still need separate review.

## Saving and retrying

Control changes are saved as local drafts, without changing mail. Drafts survive navigation and restarting. **Use this rule** must be clicked to add a sender rule to the draft. **Save choices and rebuild proposal** saves the choices first, then rebuilds the local folder plan. If rebuilding fails, retry without entering choices again. Real unfinished mail jobs still block applying new choices, but not saving a draft. Old orphaned mutation jobs with no action plan are stopped on upgrade while successful results are retained.

## Matching logic

Sift first holds suspicious authentication failures and conversations for review. Subject evidence for login/security, payment problems, receipts, delivery, and travel is checked before promotional handling. Surveys, sales, newsletters, service notices, and announcements are distinct types. Policy notices go to Updates, not Accounts.

An otherwise unrecognized message with a mailing-list or unsubscribe header is shown as **Other mailing-list mail**. The header proves neither a paid subscription nor spam. This group defaults to File with read status preserved; group-wide Spam, Trash, and age deletion are not offered. Examples include a sender-rule action if you want a more specific choice. Proton and Outlook future filing requires the list header as well as the sender and alias, and excludes recognized message purposes. Gmail cannot express this header-presence condition, so Sift skips that automatic future rule instead of replacing it with a sender-only catch-all. This is distinct from editorial newsletters and subscription status.

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
