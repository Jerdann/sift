export interface UpdatePolicyInput {
  argv: string[];
  disabled: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}

export const automaticUpdateDelay = ({
  argv,
  disabled,
  isPackaged,
  platform,
}: UpdatePolicyInput): number | null => {
  if (disabled || !isPackaged || platform !== 'win32') return null;
  return argv.includes('--squirrel-firstrun') ? 10_000 : 0;
};
