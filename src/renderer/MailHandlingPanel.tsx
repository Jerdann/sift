import { useEffect, useRef, useState } from "react";
import type { MailAccountSummary } from "../shared/contracts/accounts";
import type { MailCategory } from "../shared/contracts/analysis";
import type {
  HandlingPreferences,
  HandlingPreview,
  HandlingScope,
  CategoryHandling,
  SenderHandlingRule,
} from "../shared/contracts/mail-handling";
import { CATEGORY_PRESENTATION as labels } from "../core/classification/mail-classifier";
import {
  defaultHandling,
  handlingFor,
} from "../core/classification/mail-handling";
import { handlingGroups } from "../core/classification/handling-groups";
import {
  attentionCategories,
  removableCategories,
  patternsFor,
} from "../core/classification/message-purpose";

const actions = {
  inbox: "Keep",
  file: "File",
  spam: "Spam",
  trash: "Trash",
} as const;
const levels = [
  "Strict: clear subject matches",
  "Normal: also try similar subject wording",
  "Broad: also use saved message text",
];
const number = (n: number) => n.toLocaleString();

export function MailHandlingPanel({
  account,
  onSaved,
}: {
  account: MailAccountSummary;
  onSaved: () => Promise<unknown>;
}) {
  const [scopeValue, setScopeValue] = useState("account");
  const [aliases, setAliases] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<HandlingPreferences>({
    detail: "detailed",
    strictness: "clear",
    categories: {},
  });
  const [groupId, setGroupId] = useState("other");
  const [senderRule, setSenderRule] = useState<SenderHandlingRule | null>(null);
  const [page, setPage] = useState(0),
    [senderPage, setSenderPage] = useState(0);
  const [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    key: string;
    value: HandlingPreview;
  } | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [draftStatus, setDraftStatus] = useState("");
  const [rebuildFailed, setRebuildFailed] = useState(false),
    [refresh, setRefresh] = useState(0);
  const draftQueue = useRef(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scope: HandlingScope = {
    provider: account.provider,
    connectionId: account.id,
    level:
      scopeValue === "profile" || scopeValue === "account"
        ? scopeValue
        : "alias",
    address:
      scopeValue === "profile" || scopeValue === "account" ? null : scopeValue,
  };
  const scopeKey = JSON.stringify(scope),
    activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const groups = handlingGroups(preferences.detail);
  const group =
    groups.find((g) => g.id === groupId) ??
    groups.find((g) => g.id === "other")!;
  const chosen = senderRule ? [senderRule.category] : group.categories;
  const policy = senderRule?.handling ?? handlingFor(preferences, chosen[0]!);
  const policies = chosen.map((c) => handlingFor(preferences, c));
  const mixedAction =
    !senderRule && policies.some((p) => p.destination !== policy.destination);
  const mixedRead =
    !senderRule && policies.some((p) => p.markRead !== policy.markRead);
  const mixed = mixedAction || mixedRead;
  const canDiscard = chosen.every((c) => removableCategories.has(c));
  const needsSorting = group.id === "other";
  const readOnly =
    !senderRule &&
    chosen.every((c) => ["other", "suspicious", "spam"].includes(c));
  const previewPreferences: HandlingPreferences = senderRule
    ? {
        ...preferences,
        rules: [
          ...(preferences.rules ?? []).filter(
            (r) =>
              r.sender !== senderRule.sender ||
              r.address !== senderRule.address,
          ),
          senderRule,
        ],
      }
    : preferences;
  const input = {
    ...scope,
    preferences: previewPreferences,
    page,
    category: null,
    categories: group.categories,
    sender: senderRule?.sender ?? null,
    receivingAddress: senderRule?.address ?? null,
    senderPage,
  };
  const previewKey = JSON.stringify({ ...input, refresh });
  const preview =
    previewResult?.key === previewKey ? previewResult.value : null;
  const lastPreview = previewResult?.value;
  const counts = (cats: MailCategory[]) =>
    lastPreview?.groups
      .filter((g) => cats.includes(g.category))
      .reduce((n, g) => n + g.count, 0) ?? 0;
  const busy = loaded && !preview && !error;
  const matchCount = senderRule
    ? (preview?.ruleMatches[senderRule.id] ?? 0)
    : (preview?.groups
        .filter((g) => chosen.includes(g.category))
        .reduce((n, g) => n + g.matched, 0) ?? 0);
  const matchLevel =
    policy.matchLevel ?? (preferences.strictness === "clear" ? 0 : 2);

  useEffect(() => {
    let canceled = false;
    setLoaded(false);
    setPreviewResult(null);
    setError("");
    setNotice("");
    setSenderRule(null);
    setPage(0);
    setSenderPage(0);
    void draftQueue.current
      .then(() => window.emailOrganizer.getMailHandling(scope))
      .then((state) => {
        if (canceled) return;
        setPreferences(state.draft ?? state.preferences);
        setAliases(state.aliases);
        setLoaded(true);
        setDraftStatus(state.draft ? "Restored your saved draft." : "");
      })
      .catch(() => {
        if (!canceled)
          setError(
            "Could not load your choices. Reopen this page to try again.",
          );
      });
    return () => {
      canceled = true;
    };
  }, [scopeKey]);

  useEffect(() => {
    if (!loaded) return;
    let canceled = false;
    setError("");
    const timer = setTimeout(() => {
      void window.emailOrganizer
        .previewMailHandling(input)
        .then((value) => {
          if (!canceled) setPreviewResult({ key: previewKey, value });
        })
        .catch(() => {
          if (!canceled) {
            setPreviewResult(null);
            setError(
              "Could not preview these choices. Your draft is kept. Try again after a scan.",
            );
          }
        });
    }, 180);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [loaded, previewKey]);

  const change = (next: HandlingPreferences) => {
    setPreferences(next);
    setPage(0);
    setNotice("");
    setDraftStatus("Saving draft…");
    const key = scopeKey;
    draftQueue.current = draftQueue.current
      .catch(() => {})
      .then(() =>
        window.emailOrganizer.saveMailHandlingDraft({
          ...scope,
          preferences: next,
        }),
      )
      .then(() => {
        if (mounted.current && activeScope.current === key)
          setDraftStatus("Draft saved on this computer.");
      })
      .catch(() => {
        if (mounted.current && activeScope.current === key)
          setDraftStatus(
            "Draft could not be saved. Keep this page open and try Save again.",
          );
      });
  };
  const setPolicy = (patch: Partial<CategoryHandling>) => {
    if (senderRule) {
      setSenderRule({
        ...senderRule,
        handling: { ...senderRule.handling, ...patch },
      });
      setPage(0);
      return;
    }
    const categories = { ...preferences.categories };
    for (const c of chosen)
      categories[c] = { ...handlingFor(preferences, c), ...patch };
    change({ ...preferences, categories });
  };
  const rebuild = async () => {
    try {
      await onSaved();
      setRebuildFailed(false);
      setNotice("Choices saved. Folder plan updated. No mail was changed.");
      setRefresh((n) => n + 1);
    } catch {
      setRebuildFailed(true);
      setNotice(
        "Choices saved. The folder plan could not be rebuilt. Retry below; you do not need to enter your choices again.",
      );
    }
  };
  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await draftQueue.current;
      await window.emailOrganizer.saveMailHandlingDraft({
        ...scope,
        preferences,
      });
      const state = await window.emailOrganizer.saveMailHandling({
        ...scope,
        preferences,
      });
      setPreferences(state.preferences);
      setDraftStatus("Choices saved.");
      await rebuild();
    } catch (e) {
      setError(
        String(e).includes("mail_job_running")
          ? "A mail job is still unfinished. Your draft is saved. Finish or cancel that job, then save again."
          : "Could not save choices. Your draft is kept on this computer. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  const selectSender = (sender: string, address: string) => {
    setSenderRule(
      preferences.rules?.find(
        (r) => r.sender === sender && r.address === address,
      ) ?? {
        id: crypto.randomUUID(),
        sender,
        address,
        subjectContains: null,
        category: "promotions",
        handling: {
          destination: "inbox",
          markRead: false,
          retentionDays: null,
        },
      },
    );
    setPage(0);
  };
  const addSenderRule = () => {
    if (!senderRule || !preview || !matchCount) return;
    change({
      ...preferences,
      rules: [
        ...(preferences.rules ?? []).filter(
          (r) =>
            r.sender !== senderRule.sender || r.address !== senderRule.address,
        ),
        senderRule,
      ],
    });
    setSenderRule(null);
    setSenderPage(0);
    setNotice(
      "Rule added for " +
        number(matchCount) +
        " messages. Save when you are ready.",
    );
  };
  const selectGroup = (id: string) => {
    setGroupId(id);
    setSenderRule(null);
    setPage(0);
    setSenderPage(0);
  };
  const ruleInvalid = Boolean(
    senderRule && /[\r\n*?]/.test(senderRule.subjectContains ?? ""),
  );
  return (
    <section
      className="readiness-panel mail-handling"
      aria-labelledby={"handling-" + account.id}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider} · {account.label}
          </p>
          <h2 id={"handling-" + account.id}>
            Choose what happens to your mail
          </h2>
        </div>
      </div>
      <div className="handling-content">
        <p className="handling-note">
          Preview only. Nothing moves until you approve a plan.
        </p>
        <fieldset disabled={!loaded || saving} className="handling-general">
          <legend>General settings</legend>
          <label>
            Apply these choices to
            <select
              aria-label="Apply these choices to"
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
            >
              <option value="account">This email account</option>
              <option value="profile">All accounts — default choices</option>
              {aliases.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="handling-control-label">Folders and groups</span>
            <div
              className="handling-segments"
              role="group"
              aria-label="Folder detail"
            >
              {(["simple", "detailed"] as const).map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={preferences.detail === d}
                  onClick={() => {
                    change({ ...preferences, detail: d });
                    selectGroup("other");
                  }}
                >
                  {d === "simple" ? "Fewer" : "More detail"}
                </button>
              ))}
            </div>
          </div>
        </fieldset>
        <div className="handling-group-picker">
          <label>
            Which group are we editing?
            <select
              aria-label="Group to edit"
              value={group.id}
              disabled={!loaded || saving}
              onChange={(e) => selectGroup(e.target.value)}
            >
              {groups
                .filter(
                  (g) =>
                    g.id === group.id ||
                    g.id === "other" ||
                    counts(g.categories) > 0,
                )
                .sort(
                  (a, b) =>
                    counts(b.categories) - counts(a.categories) ||
                    a.label.localeCompare(b.label),
                )
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label} · {number(counts(g.categories))}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {needsSorting && !senderRule ? (
          <div className="handling-senders">
            <h3>Sort a sender at a time</h3>
            <p className="handling-note">
              Biggest groups first. Choose one to preview a rule for its
              matching mail.
            </p>
            {scope.level === "profile" ? (
              <p>Choose an email account above to add sender rules.</p>
            ) : (
              <>
                {(lastPreview?.senders ?? []).map((s) => (
                  <button
                    className="handling-sender"
                    type="button"
                    disabled={!preview || saving}
                    key={s.sender + s.address}
                    onClick={() => selectSender(s.sender, s.address)}
                  >
                    <span>
                      <strong>{s.sender}</strong>
                      <small>To {s.address}</small>
                      <small>{s.subject}</small>
                    </span>
                    <strong>
                      {number(s.count)} <span aria-hidden="true">→</span>
                    </strong>
                  </button>
                ))}
                {preview && !preview.senders.length ? (
                  <p>
                    No more unclassified sender groups. Mail with an unclear
                    owner or sender stays unchanged.
                  </p>
                ) : null}
                {(lastPreview?.senderPages ?? 1) > 1 ? (
                  <div className="handling-pagination">
                    <button
                      className="secondary-button"
                      disabled={senderPage === 0 || !preview}
                      onClick={() => setSenderPage((n) => n - 1)}
                    >
                      Previous senders
                    </button>
                    <span>
                      {senderPage + 1} / {lastPreview?.senderPages}
                    </span>
                    <button
                      className="secondary-button"
                      disabled={
                        !preview ||
                        senderPage + 1 >= (preview?.senderPages ?? 1)
                      }
                      onClick={() => setSenderPage((n) => n + 1)}
                    >
                      Next senders
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {senderRule ? (
          <div className="handling-sender-editor">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setSenderRule(null)}
            >
              Back to senders
            </button>
            <h3>{senderRule.sender}</h3>
            <p className="handling-note">
              Only mail to {senderRule.address}. Detected security, payments,
              account actions and replies are protected.
            </p>
            <div className="handling-controls">
              <label>
                Put matching mail in this group
                <select
                  aria-label="Classify sender as"
                  value={senderRule.category}
                  disabled={saving}
                  onChange={(e) => {
                    const category = e.target.value as MailCategory;
                    setSenderRule({
                      ...senderRule,
                      category,
                      handling: defaultHandling(category),
                    });
                  }}
                >
                  {Object.entries(labels)
                    .filter(
                      ([c]) => !["other", "suspicious", "spam"].includes(c),
                    )
                    .map(([c, v]) => (
                      <option key={c} value={c}>
                        {v.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Subject must contain (optional)
                <input
                  aria-label="Subject must contain"
                  maxLength={160}
                  value={senderRule.subjectContains ?? ""}
                  disabled={saving}
                  onChange={(e) => {
                    setSenderRule({
                      ...senderRule,
                      subjectContains: e.target.value || null,
                    });
                    setPage(0);
                  }}
                  placeholder="Any subject"
                />
              </label>
            </div>
          </div>
        ) : null}
        {!readOnly ? (
          <fieldset className="handling-category" disabled={!loaded || saving}>
            <legend>{senderRule ? "Rule for this sender" : group.label}</legend>
            <div className="handling-segments" role="group" aria-label="Action">
              {(Object.keys(actions) as Array<keyof typeof actions>).map(
                (action) => (
                  <button
                    type="button"
                    key={action}
                    aria-pressed={!mixedAction && policy.destination === action}
                    disabled={["spam", "trash"].includes(action) && !canDiscard}
                    onClick={() => setPolicy({ destination: action })}
                  >
                    {actions[action]}
                  </button>
                ),
              )}
            </div>
            {mixed ? (
              <p className="handling-note">
                This group has different choices. Pick an action to use it for
                the whole group.
              </p>
            ) : null}
            <div className="handling-controls">
              <label className="handling-toggle">
                <input
                  type="checkbox"
                  role="switch"
                  checked={!mixedRead && policy.markRead}
                  disabled={policy.destination === "inbox"}
                  onChange={(e) => setPolicy({ markRead: e.target.checked })}
                />
                Mark as read
              </label>
              {!senderRule ? (
                <label>
                  Match strictness
                  <input
                    type="range"
                    aria-label="Match strictness"
                    min="0"
                    max="2"
                    step="1"
                    value={matchLevel}
                    onChange={(e) =>
                      setPolicy({ matchLevel: Number(e.target.value) })
                    }
                  />
                  <small>{levels[matchLevel]}</small>
                </label>
              ) : null}
            </div>
            {chosen.some((c) => attentionCategories.has(c)) ? (
              <p className="handling-warning">
                These messages may need you. Keep them unread unless you want
                otherwise. Filing can also affect phone alerts.
              </p>
            ) : null}
            {["spam", "trash"].includes(policy.destination) ? (
              <p className="handling-warning">
                Your provider may empty Spam or Trash automatically.{" "}
                {senderRule
                  ? "Check the examples, including the excluded mail."
                  : "Only clear matches are used, at every strictness level."}
              </p>
            ) : null}
            {canDiscard ||
            chosen.every((c) => ["codes", "accounts"].includes(c)) ? (
              <details>
                <summary>Old mail</summary>
                <label className="handling-toggle">
                  <input
                    type="checkbox"
                    checked={policy.retentionDays !== null}
                    onChange={(e) =>
                      setPolicy({ retentionDays: e.target.checked ? 90 : null })
                    }
                  />
                  Offer old mail for Trash review
                </label>
                {policy.retentionDays !== null ? (
                  <label>
                    Older than {policy.retentionDays} days
                    <input
                      type="range"
                      aria-label="Age in days"
                      min="7"
                      max="730"
                      step="1"
                      value={policy.retentionDays}
                      onChange={(e) =>
                        setPolicy({ retentionDays: Number(e.target.value) })
                      }
                    />
                  </label>
                ) : null}
                <p className="handling-note">
                  Reviewed in Delete. Never deleted in the background by Sift.
                </p>
              </details>
            ) : null}
            <details className="handling-formula">
              <summary>Show the rule</summary>
              <code>
                IF{" "}
                {senderRule
                  ? "sender = " +
                    senderRule.sender +
                    " AND to = " +
                    senderRule.address +
                    (senderRule.subjectContains
                      ? " AND subject contains “" +
                        senderRule.subjectContains +
                        "”"
                      : "") +
                    " AND not a protected message"
                  : "type is " +
                    chosen.map((c) => labels[c].label).join(" OR ") +
                    " AND match is " +
                    [
                      "clear",
                      "clear or similar",
                      "clear, similar or saved-text",
                    ][matchLevel]}{" "}
                THEN{" "}
                {mixed
                  ? "use the choices shown on each example"
                  : actions[policy.destination].toUpperCase() +
                    " · " +
                    (policy.markRead && policy.destination !== "inbox"
                      ? "mark read"
                      : "keep read status")}
              </code>
              {!senderRule ? (
                <p className="handling-note">
                  Subject matches:{" "}
                  {chosen.flatMap((c) => patternsFor(c)).join(" OR ")}. Earlier
                  protected matches take priority. Similar wording and body-only
                  matches never become Spam, Trash, or future filters.
                </p>
              ) : null}
            </details>
          </fieldset>
        ) : !needsSorting ? (
          <p>
            These messages stay unchanged. Review them in Spam before creating
            filters.
          </p>
        ) : null}
        {!needsSorting || senderRule ? (
          <div className="handling-preview" aria-busy={busy}>
            <div className="handling-summary" role="status">
              {busy
                ? "Updating examples…"
                : preview
                  ? number(matchCount) +
                    " matches · " +
                    (senderRule
                      ? "other mail uses its group choices"
                      : number(counts(chosen) - matchCount) + " need review")
                  : "No preview available"}
            </div>
            {preview?.examples.length ? (
              <>
                <ul className="handling-examples">
                  {preview.examples.map((example, i) => (
                    <li key={i}>
                      <div className="handling-example-head">
                        <span
                          className={
                            "handling-badge action-" +
                            example.actionCode?.toLowerCase()
                          }
                        >
                          {example.actionCode}
                        </span>
                        <strong>{example.subject}</strong>
                      </div>
                      <span>
                        {example.sender} ·{" "}
                        {example.address ?? "Owner not confirmed"}
                      </span>
                      {senderRule && example.ruleId !== senderRule.id ? (
                        <small>
                          Not in this sender rule — uses its group choice.
                        </small>
                      ) : null}
                      <span>
                        {example.source} → {example.target} · {example.action}
                      </span>
                      <details>
                        <summary>Why?</summary>
                        <small>
                          {example.reasons
                            .filter(
                              (r) =>
                                !r.startsWith("User-selected sender rule:"),
                            )
                            .join(". ")}
                        </small>
                      </details>
                    </li>
                  ))}
                </ul>
                <div className="handling-pagination">
                  <button
                    className="secondary-button"
                    disabled={!preview || page === 0}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    Previous examples
                  </button>
                  <span>
                    {page + 1} / {preview.pages}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={!preview || page + 1 >= preview.pages}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Next examples
                  </button>
                </div>
              </>
            ) : preview ? (
              <p>No matching examples in this scan.</p>
            ) : null}
            {senderRule ? (
              <button
                className="primary-button compact"
                disabled={!preview || !matchCount || saving || ruleInvalid}
                onClick={addSenderRule}
              >
                Use this rule for {number(matchCount)} messages
              </button>
            ) : null}
            {ruleInvalid ? (
              <p className="form-error">Use plain words, without * or ?.</p>
            ) : null}
          </div>
        ) : null}
        {(preferences.rules?.length ?? 0) > 0 ? (
          <details className="handling-saved-rules">
            <summary>Your sender rules ({preferences.rules?.length})</summary>
            {preferences.rules?.map((r) => (
              <div key={r.id} className="handling-pagination">
                <span>
                  {r.sender} → {actions[r.handling.destination]} ·{" "}
                  {labels[r.category].label}
                  <small> · {r.address}</small>
                </span>
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => {
                    setSenderRule(r);
                    setPage(0);
                  }}
                >
                  Edit
                </button>
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={() =>
                    change({
                      ...preferences,
                      rules: preferences.rules?.filter(
                        (item) => item.id !== r.id,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </details>
        ) : null}
        <p className="handling-note">
          {lastPreview
            ? number(lastPreview.total) +
              " scanned · " +
              number(
                lastPreview.groups.find((g) => g.category === "other")?.count ??
                  0,
              ) +
              " need sorting. "
            : ""}
          {draftStatus}
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        <div className="handling-actions">
          <button
            className="primary-button compact"
            disabled={!loaded || saving || !preview || Boolean(senderRule)}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save choices and rebuild proposal"}
          </button>
          {rebuildFailed ? (
            <button
              className="secondary-button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await rebuild();
                } finally {
                  setSaving(false);
                }
              }}
            >
              Retry building folders
            </button>
          ) : null}
          {error ? (
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setRefresh((n) => n + 1)}
            >
              Retry preview
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
