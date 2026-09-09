import { useEffect, useState } from "react";
import type { MailAccountSummary } from "../shared/contracts/accounts";
import type {
  AddressGroup,
  AddressGroupsState,
} from "../shared/contracts/address-groups";
import { GROUP_COLORS } from "../core/classification/group-colors";

// Existing panel/tab styling; group membership stays visible beside its name.
// Colors identify groups only. Saving assignments does not touch provider mail.
export function OrganizationTrees({
  account,
  state,
  selected,
  disabled,
  onSelect,
  onSaved,
  onDirty,
}: {
  account: MailAccountSummary;
  state: AddressGroupsState;
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onSaved: (state: AddressGroupsState) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(state.groups),
    [editId, setEditId] = useState(selected),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(state.groups);
    setEditId(selected);
  }, [state.revision, selected]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.groups);
  useEffect(() => onDirty(dirty), [dirty]);
  const current = draft.find((g) => g.id === editId) ?? draft[0]!;
  const addresses = [
    ...new Set(state.groups.flatMap((g) => g.addresses)),
  ].sort();
  const multiple = draft.filter((g) => g.addresses.length).length > 1;
  const change = (values: Partial<AddressGroup>) =>
    setDraft(draft.map((g) => (g.id === current.id ? { ...g, ...values } : g)));
  const assign = (address: string, checked: boolean) =>
    setDraft(
      draft.map((g) => ({
        ...g,
        addresses: [
          ...g.addresses.filter((a) => a !== address),
          ...((checked ? g.id === current.id : g.id === "main")
            ? [address]
            : []),
        ],
      })),
    );
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await window.emailOrganizer.saveAddressGroups({
        provider: account.provider,
        connectionId: account.id,
        revision: state.revision,
        groups: draft,
      });
      setDraft(saved.groups);
      onSelect(current.id);
      await onSaved(saved);
    } catch (e) {
      setError(
        String(e).includes("mail_job_running")
          ? "Finish the running mail job, then save. Your group edits are still here."
          : String(e).includes("address_groups_changed")
            ? "The address list changed. Reload this page before saving groups."
            : String(e).includes("group_name_reserved")
              ? "Choose another name. Inbox, Spam, Trash and other system folder names are reserved."
              : "Could not save groups. Use different names for each group, then try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="readiness-panel organization-trees"
      aria-label="Address groups"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider} · {account.label}
          </p>
          <h2>Group your email addresses</h2>
        </div>
        <button
          className="secondary-button"
          disabled={disabled || busy}
          onClick={() => {
            const id = crypto.randomUUID();
            setDraft([
              ...draft,
              {
                id,
                name: `Group ${draft.length + 1}`,
                color: "blue",
                addresses: [],
              },
            ]);
            setEditId(id);
          }}
        >
          Add group
        </button>
      </div>
      <div className="tree-content">
        <p>
          Put addresses together to give them the same folders and mail rules.
        </p>
        <div
          className="proposal-scope-tabs tree-tabs"
          role="group"
          aria-label="Address groups"
        >
          {draft.map((g) => (
            <button
              type="button"
              key={g.id}
              className={current.id === g.id ? "active" : ""}
              aria-pressed={current.id === g.id}
              disabled={disabled || busy || dirty}
              onClick={() => {
                setEditId(g.id);
                onSelect(g.id);
              }}
            >
              <strong>
                <span className="group-color-dot" data-color={g.color} />
                {g.name}
              </strong>
              <small>
                {g.addresses.length} addresses · {GROUP_COLORS[g.color].label}
              </small>
            </button>
          ))}
        </div>
        <fieldset disabled={disabled || busy} className="address-group-editor">
          <legend>{current.name}</legend>
          <label>
            Group name
            <input
              aria-label="Group name"
              value={current.name}
              maxLength={64}
              onChange={(e) =>
                change({ name: e.target.value.replace(/[\\/\x00-\x1f]/g, "") })
              }
            />
          </label>
          <div
            className="group-color-picker"
            role="group"
            aria-label="Group color"
          >
            {Object.entries(GROUP_COLORS).map(([key, c]) => (
              <button
                type="button"
                key={key}
                aria-pressed={current.color === key}
                onClick={() => change({ color: key as AddressGroup["color"] })}
              >
                <span className="group-color-dot" data-color={key} />
                {c.label}
              </button>
            ))}
          </div>
          <div
            className="group-address-list"
            role="group"
            aria-label="Addresses in this group"
          >
            {addresses.map((a) => {
              const owner = draft.find((g) => g.addresses.includes(a));
              return (
                <label key={a}>
                  <input
                    type="checkbox"
                    checked={current.addresses.includes(a)}
                    disabled={
                      current.id === "main" && current.addresses.includes(a)
                    }
                    onChange={(e) => assign(a, e.target.checked)}
                  />
                  <span>
                    {a}
                    <small>
                      {owner?.id === current.id
                        ? "In this group"
                        : `In ${owner?.name ?? "Main"} — selecting moves it here`}
                    </small>
                  </span>
                </label>
              );
            })}
            {!addresses.length ? (
              <p>
                No confirmed addresses yet. Confirm your addresses on the
                Addresses page.
              </p>
            ) : null}
          </div>
          <p>
            {multiple
              ? `Folders for this group go inside “${current.name}”.`
              : "One group: category folders go directly in your mailbox, without a group parent folder."}
          </p>
          <small>
            {account.provider === "gmail"
              ? "The folder review will show the label colors Sift can apply in Gmail."
              : account.provider === "proton"
                ? "Color is shown in Sift. Proton Bridge cannot set folder colors; set this color and subfolder inheritance in Proton Mail → Settings → Folders and labels."
                : "Color is shown in Sift. This connection cannot set Outlook folder colors. Outlook's separate color categories can be configured in Outlook."}{" "}
            Colors do not change notifications or read status.
          </small>
          <div className="group-editor-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!dirty || !current.name.trim()}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save groups"}
            </button>
            {dirty ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDraft(state.groups);
                  setEditId(selected);
                }}
              >
                Cancel edits
              </button>
            ) : null}
            {current.id !== "main" ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDraft(
                    draft
                      .filter((g) => g.id !== current.id)
                      .map((g) =>
                        g.id === "main"
                          ? {
                              ...g,
                              addresses: [...g.addresses, ...current.addresses],
                            }
                          : g,
                      ),
                  );
                  setEditId("main");
                }}
              >
                Remove group
              </button>
            ) : null}
          </div>
        </fieldset>
        <small>
          Saving groups changes only the plan. Existing folders, messages, and
          filters stay unchanged. Removing a group returns its addresses to
          Main.
        </small>
        {error ? (
          <p className="connection-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
