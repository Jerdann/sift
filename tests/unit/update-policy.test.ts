import { describe, expect, it } from 'vitest';
import { automaticUpdateDelay } from '../../src/main/updates/update-policy';

describe('automatic update policy', () => {
  it('starts immediately for an installed Windows build', () => {
    expect(automaticUpdateDelay({ argv: [], disabled: false, isPackaged: true, platform: 'win32' })).toBe(0);
  });

  it('waits for the Squirrel first-run lock', () => {
    expect(automaticUpdateDelay({ argv: ['--squirrel-firstrun'], disabled: false, isPackaged: true, platform: 'win32' })).toBe(10_000);
  });

  it.each([
    { disabled: true, isPackaged: true, platform: 'win32' as const },
    { disabled: false, isPackaged: false, platform: 'win32' as const },
    { disabled: false, isPackaged: true, platform: 'linux' as const },
  ])('does not start outside the supported installed runtime', (runtime) => {
    expect(automaticUpdateDelay({ argv: [], ...runtime })).toBeNull();
  });
});
