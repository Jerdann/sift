import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";
import { ImapFlowMutationClient } from "../../src/main/proton/proton-mutation-client";

describe("Proton mutation folder namespace", () => {
  it("preserves read status when requested and changes flags without a same-folder MOVE", async () => {
    const messageFlagsAdd = vi.fn(async () => true),
      messageMove = vi.fn(async () => ({ uidMap: new Map([[42, 142]]) })),
      release = vi.fn();
    const imap = {
      getMailboxLock: vi.fn(async () => ({ release })),
      messageFlagsAdd,
      messageMove,
    } as unknown as ImapFlow;
    const client = new ImapFlowMutationClient(imap);
    expect(
      await client.moveMany("INBOX", [42], "Folders/Security", false),
    ).toEqual(new Map([[42, { path: "Folders/Security", uid: 142 }]]));
    expect(messageFlagsAdd).not.toHaveBeenCalled();
    messageMove.mockClear();
    expect(
      await client.moveMany("Folders/Receipts", [42], "Folders/Receipts", true),
    ).toEqual(new Map([[42, { path: "Folders/Receipts", uid: 42 }]]));
    expect(messageFlagsAdd).toHaveBeenCalledWith([42], ["\\Seen"], {
      uid: true,
    });
    expect(messageMove).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("restores flags without moving a same-folder message during undo", async () => {
    const messageMove = vi.fn(),
      messageFlagsSet = vi.fn(async () => true),
      release = vi.fn();
    const imap = {
      getMailboxLock: vi.fn(async () => ({ release })),
      messageMove,
      messageFlagsSet,
      mailbox: { uidValidity: 1 },
      fetch: async function* () {
        yield { uid: 42, flags: new Set(["\\Flagged"]) };
      },
    } as unknown as ImapFlow;
    const receipt = await new ImapFlowMutationClient(imap).restore(
      "Folders/Receipts",
      42,
      "Folders/Receipts",
      ["\\Flagged"],
    );
    expect(receipt).toMatchObject({ uid: 42, flags: ["\\Flagged"] });
    expect(messageMove).not.toHaveBeenCalled();
    expect(messageFlagsSet).toHaveBeenCalledWith(42, ["\\Flagged"], {
      uid: true,
    });
  });
  it("creates portable folder paths beneath the Bridge Folders root", async () => {
    const mailboxes = [
      { path: "Folders", delimiter: "/", specialUse: undefined },
      { path: "Labels", delimiter: "/", specialUse: undefined },
    ];
    const mailboxCreate = vi.fn(async (providerPath: string) => {
      mailboxes.push({
        path: providerPath,
        delimiter: "/",
        specialUse: undefined,
      });
      return { path: providerPath, created: true };
    });
    const imap = {
      list: vi.fn(async () => mailboxes),
      mailboxCreate,
    } as unknown as ImapFlow;
    const client = new ImapFlowMutationClient(imap);

    await expect(
      client.prepareTarget("Joint House Things/Money/Receipts", false),
    ).resolves.toBe("Folders/Joint House Things/Money/Receipts");
    expect(
      mailboxCreate.mock.calls.map(([providerPath]) => providerPath),
    ).toEqual([
      "Folders/Joint House Things",
      "Folders/Joint House Things/Money",
      "Folders/Joint House Things/Money/Receipts",
    ]);
  });

  it("does not create an account-root mailbox or recreate an existing folder", async () => {
    const mailboxCreate = vi.fn();
    const imap = {
      list: vi.fn(async () => [
        { path: "Folders", delimiter: "/", specialUse: undefined },
        { path: "Folders/Games", delimiter: "/", specialUse: undefined },
      ]),
      mailboxCreate,
    } as unknown as ImapFlow;
    const client = new ImapFlowMutationClient(imap);

    await expect(client.prepareTarget("Games", false)).resolves.toBe(
      "Folders/Games",
    );
    expect(mailboxCreate).not.toHaveBeenCalled();
  });

  it("turns an explicit provider MOVE rejection into a safe item failure", async () => {
    const release = vi.fn();
    const imap = {
      getMailboxLock: vi.fn(async () => ({ release })),
      messageFlagsAdd: vi.fn(async () => true),
      messageMove: vi.fn(async () => false),
    } as unknown as ImapFlow;
    const client = new ImapFlowMutationClient(imap);

    await expect(
      client.moveMany("All Mail", [42], "Folders/Social"),
    ).rejects.toThrow("provider_move_rejected");
    expect(release).toHaveBeenCalledOnce();
  });
});
