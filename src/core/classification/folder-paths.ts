/** The exact parent and leaf folders required by a set of destination paths. */
export function withParentFolders(paths: Iterable<string>): string[] {
  const result = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let n = 1; n <= parts.length; n++)
      result.add(parts.slice(0, n).join("/"));
  }
  return [...result].sort();
}
