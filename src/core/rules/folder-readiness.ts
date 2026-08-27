import type { AccountProvider } from "../../shared/contracts/accounts";

export interface ProviderContainerPath {
  path: string;
  delimiter?: string;
}

const pathParts = (value: string, delimiter = "/"): string[] => {
  const normalized = delimiter && delimiter !== "/"
    ? value.split(delimiter).join("/")
    : value;
  return normalized
    .split("/")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
};

const matchesTarget = (
  provider: AccountProvider,
  targetPath: string,
  container: ProviderContainerPath,
): boolean => {
  const actual = pathParts(container.path, container.delimiter);
  const target = pathParts(targetPath);
  const expected = provider === "proton" && target[0] !== "folders"
    ? ["folders", ...target]
    : target;
  return actual.length === expected.length &&
    actual.every((part, index) => part === expected[index]);
};

export const providerHasDestinations = (
  provider: AccountProvider,
  targetPaths: readonly string[],
  containers: readonly ProviderContainerPath[],
): boolean => {
  const required = [...new Set(targetPaths.map((path) => path.trim()).filter(Boolean))];
  return required.every((target) =>
    containers.some((container) => matchesTarget(provider, target, container)),
  );
};
