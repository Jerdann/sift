export const protonFolderPath = (
  logicalPath: string,
  delimiter = '/',
): string => {
  const parts = logicalPath
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('proton_folder_path_required');
  const providerParts = parts[0]!.toLowerCase() === 'folders'
    ? parts
    : ['Folders', ...parts];
  return providerParts.join(delimiter);
};

export const isSameProtonFolder = (
  providerPath: string,
  logicalPath: string,
  delimiter = '/',
): boolean => providerPath.toLowerCase() === protonFolderPath(logicalPath, delimiter).toLowerCase();
