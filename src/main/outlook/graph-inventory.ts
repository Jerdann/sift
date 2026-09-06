import type { OutlookFetch } from "./outlook-oauth";

export interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
}

export async function readGraphPages<T>(
  fetchPort: OutlookFetch,
  token: string,
  path: string,
): Promise<T[]> {
  const rows: T[] = [];
  const visited = new Set<string>();
  let next: string | undefined = path;
  while (next) {
    const url = new URL(
      next.startsWith("https://")
        ? next
        : `https://graph.microsoft.com/v1.0${next}`,
    );
    if (
      url.origin !== "https://graph.microsoft.com" ||
      !url.pathname.startsWith("/v1.0/") ||
      url.username ||
      url.password
    )
      throw new Error("outlook_inventory_url_invalid");
    if (visited.has(url.href) || visited.size >= 1000)
      throw new Error("outlook_inventory_incomplete");
    visited.add(url.href);
    const response = await fetchPort(url.href, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`outlook_api_${response.status}`);
    const page = (await response.json()) as { value?: T[] } & Record<
      string,
      unknown
    >;
    rows.push(...(page.value ?? []));
    const continuation = page["@" + "odata.nextLink"];
    next = typeof continuation === "string" ? continuation : undefined;
  }
  return rows;
}

export async function readGraphFolders(
  fetchPort: OutlookFetch,
  token: string,
): Promise<GraphFolder[]> {
  const fields =
    "?$top=100&includeHiddenFolders=true&$select=id,displayName,parentFolderId";
  const folders = await readGraphPages<GraphFolder>(
    fetchPort,
    token,
    `/me/mailFolders${fields}`,
  );
  const seen = new Set(folders.map((folder) => folder.id));
  for (let index = 0; index < folders.length; index++) {
    if (folders.length > 10000) throw new Error("outlook_inventory_incomplete");
    const children = await readGraphPages<GraphFolder>(
      fetchPort,
      token,
      `/me/mailFolders/${encodeURIComponent(folders[index]!.id)}/childFolders${fields}`,
    );
    for (const folder of children)
      if (!seen.has(folder.id)) {
        seen.add(folder.id);
        folders.push(folder);
      }
  }
  // Reject corrupt cyclic ancestry before callers construct paths.
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    const ancestors = new Set([folder.id]);
    let parent = folder.parentFolderId;
    while (parent && byId.has(parent)) {
      if (ancestors.has(parent)) throw new Error("outlook_inventory_cycle");
      ancestors.add(parent);
      parent = byId.get(parent)?.parentFolderId;
    }
  }
  return folders;
}
