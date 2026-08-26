export const hasExplicitUserDataDirectory = (
  argv: readonly string[],
): boolean =>
  argv.some(
    (argument) =>
      argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
  );

export const shouldUseLegacyUserData = ({
  argv,
  legacyDirectoryExists,
}: {
  argv: readonly string[];
  legacyDirectoryExists: boolean;
}): boolean => legacyDirectoryExists && !hasExplicitUserDataDirectory(argv);
