import { useEffect, useState } from "react";
import type { MailAccountSummary } from "../shared/contracts/accounts";
import type { MailCategory } from "../shared/contracts/analysis";
import type {
  HandlingPreferences,
  HandlingPreview,
  HandlingScope,
  CategoryHandling,
} from "../shared/contracts/mail-handling";
import { CATEGORY_PRESENTATION } from "../core/classification/mail-classifier";
import {
  defaultHandling,
  handlingFor,
} from "../core/classification/mail-handling";
import {
  attentionCategories,
  removableCategories,
} from "../core/classification/message-purpose";

const labels = CATEGORY_PRESENTATION;
const categories = Object.keys(labels) as MailCategory[];

export function MailHandlingPanel({
  account,
  onSaved,
}: {
  account: MailAccountSummary;
  onSaved: () => Promise<unknown>;
}) {
  const [level, setLevel] = useState<HandlingScope["level"]>("account");
  const [address, setAddress] = useState<string | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<HandlingPreferences>({
    detail: "detailed",
    strictness: "clear",
    categories: {},
  });
  const [category, setCategory] = useState<MailCategory>("promotions");
  const [previewResult, setPreviewResult] = useState<{
    key: string;
    value: HandlingPreview;
  } | null>(null);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scope: HandlingScope = {
    provider: account.provider,
    connectionId: account.id,
    level,
    address,
  };
  const previewKey = JSON.stringify({ ...scope, preferences, page, category });
  const preview =
    previewResult?.key === previewKey ? previewResult.value : null;
  const switchScope = (value: string) => {
    setLoaded(false);
    setPreviewResult(null);
    setPendingScope(null);
    setLevel(value === "profile" || value === "account" ? value : "alias");
    setAddress(value === "profile" || value === "account" ? null : value);
  };

  useEffect(() => {
    let canceled = false;
    setLoaded(false);
    setPreviewResult(null);
    setError("");
    setNotice("");
    void window.emailOrganizer
      .getMailHandling(scope)
      .then((state) => {
        if (canceled) return;
        setPreferences(state.preferences);
        setAliases(state.aliases);
        setDirty(false);
        setLoaded(true);
        setPage(0);
      })
      .catch(() => {
        if (!canceled)
          setError(
            "Could not load handling choices. Reopen this page to try again.",
          );
      });
    return () => {
      canceled = true;
    };
  }, [account.id, account.provider, level, address]);

  useEffect(() => {
    if (!loaded) return;
    let canceled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void window.emailOrganizer
        .previewMailHandling({ ...scope, preferences, page, category })
        .then((result) => {
          if (!canceled) {
            setPreviewResult({ key: previewKey, value: result });
            setLoading(false);
          }
        })
        .catch(() => {
          if (!canceled) {
            setLoading(false);
            setPreviewResult(null);
            setError(
              "Could not preview these choices. Finish a mailbox scan, then try again.",
            );
          }
        });
    }, 250);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [
    loaded,
    account.id,
    account.provider,
    level,
    address,
    preferences,
    page,
    category,
  ]);

  const change = (next: HandlingPreferences) => {
    setPreferences(next);
    setDirty(true);
    setPage(0);
    setNotice("");
  };
  const policy = handlingFor(preferences, category);
  const setPolicy = (patch: Partial<CategoryHandling>) =>
    change({
      ...preferences,
      categories: {
        ...preferences.categories,
        [category]: { ...policy, ...patch },
      },
    });
  const save = async (reset = false) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const state = await window.emailOrganizer.saveMailHandling({
        ...scope,
        preferences,
        reset,
      });
      setPreferences(state.preferences);
      setDirty(false);
      await onSaved();
      setNotice(
        "Choices saved and the folder proposal rebuilt. No messages, folders, or provider filters changed. Review and approve the new plans below and in Rules.",
      );
      return true;
    } catch {
      setError(
        "Could not finish saving and rebuilding. Let any active mail job finish, then try again. No mailbox changes were requested.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };
  const count = preview?.groups.find((group) => group.category === category);
  return (
    <section
      className="readiness-panel mail-handling"
      aria-labelledby={`handling-${account.id}`}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider} · {account.label}
          </p>
          <h2 id={`handling-${account.id}`}>
            Choose what happens to each kind of mail
          </h2>
        </div>
      </div>
      <div className="handling-content">
        <p>
          Sift checks what a message is about—not just which company sent it.
          Login and payment actions are checked before sales. Mailing-list
          headers alone do not make a message a subscription.
        </p>
        <p className="handling-note">
          This is a preview of your saved scan. Changing or saving these choices
          does not change your mailbox. Existing mail and future filters require
          separate approval.
        </p>
        <div className="handling-controls">
          <label>
            Apply these choices to
            <select
              aria-label="Apply these choices to"
              value={level === "alias" ? (address ?? "account") : level}
              disabled={saving}
              onChange={(event) => {
                const value = event.target.value;
                if (dirty) setPendingScope(value);
                else switchScope(value);
              }}
            >
              <option value="profile">Default for this local profile</option>
              <option value="account">This email account</option>
              {aliases.map((alias) => (
                <option key={alias} value={alias}>
                  {alias}
                </option>
              ))}
            </select>
          </label>
          <label>
            Folder detail
            <select
              aria-label="Folder detail"
              disabled={!loaded || saving}
              value={preferences.detail}
              onChange={(event) =>
                change({
                  ...preferences,
                  detail: event.target.value as HandlingPreferences["detail"],
                })
              }
            >
              <option value="detailed">
                Separate folders for specific message types
              </option>
              <option value="simple">Fewer folders, grouped by subject</option>
            </select>
          </label>
          <label>
            Which evidence to include
            <select
              aria-label="Which evidence to include"
              disabled={!loaded || saving}
              value={preferences.strictness}
              onChange={(event) =>
                change({
                  ...preferences,
                  strictness: event.target
                    .value as HandlingPreferences["strictness"],
                })
              }
            >
              <option value="clear">Clear subject matches only</option>
              <option value="broader">
                Also include tentative content matches
              </option>
            </select>
          </label>
        </div>
        <p className="handling-note">
          Account choices override profile defaults; address choices override
          the account. Tentative matches are never used for Spam, Trash, or
          future filters. More folder detail does not mean more aggressive
          deletion.
        </p>
        {pendingScope !== null ? (
          <div className="handling-warning" role="status">
            <p>
              You have unsaved choices. Save them or discard them before
              switching to another profile, account, or address.
            </p>
            <div className="handling-actions">
              <button
                className="secondary-button"
                disabled={saving || loading || !preview}
                onClick={() =>
                  void (async () => {
                    if (await save()) switchScope(pendingScope);
                  })()
                }
              >
                Save and rebuild, then switch
              </button>
              <button
                className="secondary-button"
                disabled={saving}
                onClick={() => switchScope(pendingScope)}
              >
                Discard changes and switch
              </button>
              <button
                className="secondary-button"
                disabled={saving}
                onClick={() => setPendingScope(null)}
              >
                Keep editing
              </button>
            </div>
          </div>
        ) : null}
        <div className="handling-category">
          <label>
            Message type
            <select
              aria-label="Message type"
              value={category}
              disabled={saving}
              onChange={(event) => {
                setCategory(event.target.value as MailCategory);
                setPage(0);
              }}
            >
              {categories.map((value) => (
                <option key={value} value={value}>
                  {labels[value].label}
                  {preview
                    ? ` (${preview.groups.find((group) => group.category === value)?.count ?? 0})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="handling-controls">
            <label>
              Destination
              <select
                aria-label="Destination"
                disabled={
                  !loaded ||
                  saving ||
                  ["other", "suspicious", "spam"].includes(category)
                }
                value={policy.destination}
                onChange={(event) =>
                  setPolicy({
                    destination: event.target
                      .value as CategoryHandling["destination"],
                  })
                }
              >
                <option value="file">Move to its folder</option>
                <option value="inbox">Leave in place</option>
                {removableCategories.has(category) ? (
                  <>
                    <option value="spam">Move to Spam</option>
                    <option value="trash">Move to Trash</option>
                  </>
                ) : null}
              </select>
            </label>
            <label>
              Read status
              <select
                aria-label="Read status"
                disabled={!loaded || saving || policy.destination === "inbox"}
                value={policy.markRead ? "read" : "preserve"}
                onChange={(event) =>
                  setPolicy({ markRead: event.target.value === "read" })
                }
              >
                <option value="preserve">Do not change read status</option>
                <option value="read">Mark as read</option>
              </select>
            </label>
            <label>
              Offer to remove old messages
              <select
                aria-label="Offer to remove old messages"
                disabled={
                  !loaded ||
                  saving ||
                  (!removableCategories.has(category) &&
                    !["codes", "accounts"].includes(category))
                }
                value={policy.retentionDays ?? "keep"}
                onChange={(event) =>
                  setPolicy({
                    retentionDays:
                      event.target.value === "keep"
                        ? null
                        : Number(event.target.value),
                  })
                }
              >
                <option value="keep">Keep indefinitely</option>
                {[7, 30, 90, 180, 365, 730].map((days) => (
                  <option value={days} key={days}>
                    Review for Trash after {days} days
                  </option>
                ))}
              </select>
            </label>
          </div>
          {attentionCategories.has(category) ? (
            <p className="handling-warning">
              These messages can need immediate attention. The default preserves
              read status. Moving an unread message out of Inbox can still
              change phone notifications; use “Leave in place” if it needs to
              stay in Inbox.
            </p>
          ) : null}
          <p className="handling-note">
            Age limits create a review in Delete. They do not run in the
            background or permanently delete anything. Spam and Trash may be
            automatically emptied by your email provider.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={!loaded || saving}
            onClick={() => setPolicy(defaultHandling(category))}
          >
            Reset this message type to Sift defaults
          </button>
        </div>
        <div className="handling-preview" aria-busy={loading}>
          <div className="handling-summary" role="status">
            {!loaded
              ? "Loading saved choices…"
              : loading
                ? "Updating preview…"
                : preview
                  ? `${preview.total.toLocaleString()} scanned · ${preview.matched.toLocaleString()} eligible for handling · ${preview.held.toLocaleString()} held for review · ${preview.retention.toLocaleString()} old messages eligible for a separate Trash review`
                  : "No preview yet"}
          </div>
          {count ? (
            <p>
              <strong>
                {labels[category].label}: {count.matched.toLocaleString()}{" "}
                eligible of {count.count.toLocaleString()}
              </strong>
              <br />
              {count.action} · {count.target}
            </p>
          ) : preview ? (
            <p>
              No examples of this message type were found in the saved scan. A
              folder is not needed unless matching mail is found or you
              explicitly choose one.
            </p>
          ) : null}
          {preview?.examples.length ? (
            <>
              <ul className="handling-examples">
                {preview.examples.map((example, index) => (
                  <li key={`${example.sender}:${example.subject}:${index}`}>
                    <strong>{example.subject}</strong>
                    <span>
                      {example.sender} ·{" "}
                      {example.address ?? "No confirmed receiving address"}
                    </span>
                    <span>
                      {labels[example.priorCategory].label} →{" "}
                      {labels[example.category].label}
                    </span>
                    <span>
                      {example.source} → {example.target}
                    </span>
                    <span>{example.action}</span>
                    <small>{example.reasons.join(". ")}</small>
                  </li>
                ))}
              </ul>
              <div className="handling-pagination">
                <button
                  className="secondary-button"
                  disabled={loading || page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous examples
                </button>
                <span>
                  Page {page + 1} of {preview.pages}
                </span>
                <button
                  className="secondary-button"
                  disabled={loading || page + 1 >= preview.pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next examples
                </button>
              </div>
            </>
          ) : null}
          <p className="handling-note">
            {preview?.withBody
              ? `${preview.withBody.toLocaleString()} scanned messages include locally saved text.`
              : "This scan uses subjects and headers; message bodies were not available."}{" "}
            Uncertain mail is left for review. Examples stay on this computer.
          </p>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="handling-actions">
          <button
            className="primary-button compact"
            disabled={!loaded || loading || saving || !preview}
            onClick={() => void save()}
          >
            {saving
              ? "Saving and rebuilding…"
              : dirty
                ? "Save choices and rebuild proposal"
                : "Rebuild proposal with these choices"}
          </button>
          <button
            className="secondary-button"
            disabled={!loaded || saving}
            onClick={() => void save(true)}
          >
            {level === "profile"
              ? "Save default choices and rebuild"
              : "Save inherited choices and rebuild"}
          </button>
        </div>
      </div>
    </section>
  );
}
