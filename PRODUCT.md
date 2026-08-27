# Product

## Platform

web

## Users

People with years of accumulated mail across one or more providers, including households where one mailbox contains several aliases with distinct purposes. Users may be non-technical, but need exact control over high-impact mailbox changes.

## Product Purpose

Sift turns a crowded mailbox into a maintainable system by proving owned identities, separating their purposes, finding the broadest safe cleanup opportunities, and narrowing those opportunities into reviewable organization, filtering, unsubscribe, and deletion jobs.

Success means a user can understand what each address is for, choose how it should be containerized, approve categories and future rules per address, remove stale bulk mail, and keep the system working without manually reading thousands of messages.

## Positioning

Sift learns structure from local mailbox history, but never treats a statistical guess as authority to mutate mail. Every stage produces an inspectable proposal, and the user shapes the hierarchy before any provider action runs.

## Operating Context

- Desktop Electron application running locally on Windows.
- Proton Mail connects through Proton Bridge; Gmail connects through OAuth.
- One provider account may contain multiple aliases with different personal, household, gaming, shopping, or joint-account purposes.
- The pruning sequence is: scan → folders and existing mail → spam decisions → future filters → unsubscribe → reversible deletion.

## Capabilities and Constraints

- Alias ownership may be proven by Sent-folder From evidence or strong inbound delivery evidence. To/Cc/Bcc alone cannot prove ownership.
- Received-only aliases may be organized and containerized. Only aliases proven as Sent-folder authors may be considered for retirement.
- Organization proposals are provider- and address-specific.
- Sender proposals include message volume and last activity.
- Likely spam is never contacted through unsubscribe.
- Deletion is approval-gated and should be reversible by moving messages to the provider's Trash; permanent deletion is outside the initial safety boundary.
- Outlook and Hotmail support are planned, not implemented.

## Brand Commitments

The product is named Sift. Voice is direct, practical, and product-focused. The interface should sell the relief of pruning mail without defensive or patronizing language.

## Evidence on Hand

The working codebase includes Proton and Gmail scans, local classification, organization plans, rule export, cleanup execution, and safe unsubscribe. Real mailbox evidence remains local and must never enter source control or diagnostics.

## Product Principles

1. Prove identity before inferring purpose.
2. Catch the biggest safe opportunities first, then narrow the decision.
3. Keep aliases and their purposes visible throughout every proposal.
4. Show recency beside volume; age changes the correct cleanup action.
5. Make every destructive outcome explicit, approval-gated, and reversible.
6. Explain each page's goal, decision logic, exclusions, and exact changes in plain English.

## Accessibility & Inclusion

Use plain language, keyboard-accessible controls, legible contrast, and progressive disclosure so ordinary email users can make high-stakes decisions without understanding provider protocols.
