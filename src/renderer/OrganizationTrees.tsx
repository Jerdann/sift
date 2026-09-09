import { useState } from "react";
import type {
  AccountIdentitySummary,
  AccountIdentityUpdateInput,
  MailAccountSummary,
} from "../shared/contracts/accounts";

export function OrganizationTrees({
  account,
  identities,
  selected,
  disabled,
  onSelect,
  onUpdate,
}: {
  account: MailAccountSummary;
  identities: AccountIdentitySummary[];
  selected: string;
  disabled: boolean;
  onSelect: (address: string) => void;
  onUpdate: (input: AccountIdentityUpdateInput) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [address, setAddress] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const confirmed = identities.filter((i) => i.status === "confirmed");
  const split = confirmed.filter((i) => i.containerEnabled);
  const available = confirmed.filter((i) => !i.containerEnabled);
  const change = async (i: AccountIdentitySummary, enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      await onUpdate({
        provider: account.provider,
        connectionId: account.id,
        address: i.address,
        status: "confirmed",
        containerEnabled: enabled,
        containerName: enabled
          ? (names[i.address] ?? i.containerName ?? i.address.split("@")[0]!)
          : null,
      });
      onSelect(enabled ? i.address : "account");
      setAddress("");
    } catch {
      setError(
        "Could not save the folder split. Finish any running mail job, then try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="readiness-panel organization-trees"
      aria-label="Folder trees"
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">
            {account.provider} · {account.label}
          </p>
          <h2>Separate email addresses</h2>
        </div>
      </div>
      <div className="tree-content">
        <p>Keep house, work, or other shared mail in its own folders.</p>
        <div
          className="proposal-scope-tabs tree-tabs"
          role="group"
          aria-label="Edit folder tree"
        >
          <button
            type="button"
            className={selected === "account" ? "active" : ""}
            aria-pressed={selected === "account"}
            disabled={disabled || busy}
            onClick={() => onSelect("account")}
          >
            <strong>Main folders</strong>
            <small>
              {split.length
                ? "Excludes every address listed below"
                : "All confirmed addresses"}
            </small>
          </button>
          {split.map((i) => (
            <button
              type="button"
              key={i.id}
              className={selected === i.address ? "active" : ""}
              aria-pressed={selected === i.address}
              disabled={disabled || busy}
              onClick={() => onSelect(i.address)}
            >
              <strong>{i.containerName}</strong>
              <small>{i.address} only</small>
            </button>
          ))}
        </div>
        {split.map((i) => (
          <div className="tree-address-row" key={i.id}>
            <span>
              <strong>{i.address}</strong>
              <small>Separate from main-folder filters</small>
            </span>
            <label>
              Folder name
              <input
                aria-label={`Folder name for ${i.address}`}
                value={names[i.address] ?? i.containerName ?? ""}
                maxLength={64}
                disabled={disabled || busy}
                onChange={(e) =>
                  setNames({
                    ...names,
                    [i.address]: e.target.value.replace(/[\\/]/g, ""),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={
                disabled ||
                busy ||
                !names[i.address]?.trim() ||
                names[i.address] === i.containerName
              }
              onClick={() => void change(i, true)}
            >
              Save name
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled || busy}
              onClick={() => void change(i, false)}
            >
              Use main folders
              <br />
              <small>Keep this address's choices</small>
            </button>
          </div>
        ))}
        {available.length ? (
          <div className="tree-add">
            <label>
              Separate another address
              <select
                aria-label="Address to separate"
                value={address}
                disabled={disabled || busy}
                onChange={(e) => setAddress(e.target.value)}
              >
                <option value="">Choose an address</option>
                {available.map((i) => (
                  <option key={i.id} value={i.address}>
                    {i.address}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={!address || disabled || busy}
              onClick={() => {
                const i = available.find((i) => i.address === address);
                if (i) void change(i, true);
              }}
            >
              Create separate tree
            </button>
          </div>
        ) : null}
        <small>
          No mail or folders change here. Review and create the folders below.
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
