import { extractFile, listPackage } from '@electron/asar';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const packageRoot = process.env.SIFT_PACKAGE_DIR
  ? path.resolve(process.env.SIFT_PACKAGE_DIR)
  : process.env.MAIL_STEWARD_PACKAGE_DIR
    ? path.resolve(process.env.MAIL_STEWARD_PACKAGE_DIR)
    : path.resolve('out', 'Sift-win32-x64');

const requiredFiles = [
  path.join(packageRoot, 'Sift.exe'),
  path.join(packageRoot, 'resources', 'app.asar'),
];

for (const required of requiredFiles) {
  if (!existsSync(required)) throw new Error(`Missing packaged resource: ${required}`);
}

const asarPath = requiredFiles[1];
const entries = listPackage(asarPath);
const packagedEntries = entries.map((entry) => ({
  archivePath: entry,
  normalizedPath: entry.replaceAll('\\', '/'),
}));
const forbiddenEntry = packagedEntries.find(({ normalizedPath }) =>
  /(?:^|\/)(?:tests?|\.planning|playwright-report|test-results)(?:\/|$)|\.map$|\.env(?:\.|$)/i.test(normalizedPath),
);
if (forbiddenEntry) {
  throw new Error(`Development-only file shipped in app.asar: ${forbiddenEntry.normalizedPath}`);
}

const canaries = [
  'canary-provider-password',
  'subject-canary-72b6',
  'body-canary-9db3',
  'mail-canary@example.test',
];
const inspectableEntries = packagedEntries.filter(({ normalizedPath }) =>
  /^\/(?:\.vite|package\.json)/.test(normalizedPath) &&
    /\.(?:c?js|css|html|json)$/.test(normalizedPath),
);
for (const { archivePath, normalizedPath } of inspectableEntries) {
  const content = extractFile(asarPath, archivePath.replace(/^[\\/]/, '')).toString('utf8');
  for (const canary of canaries) {
    if (content.includes(canary)) throw new Error(`Privacy canary shipped in ${normalizedPath}`);
  }
}

const unpackedRoot = path.join(packageRoot, 'resources', 'app.asar.unpacked');
const nativeFiles = existsSync(unpackedRoot)
  ? (readdirSync(unpackedRoot, { recursive: true }) ?? [])
      .map((entry) => path.join(unpackedRoot, String(entry)))
      .filter((entry) => statSync(entry).isFile() && entry.endsWith('.node'))
  : [];
if (nativeFiles.length === 0) throw new Error('No unpacked native SQLite binding was packaged');

const executable = readFileSync(requiredFiles[0]);
if (executable.byteLength < 1_000_000) throw new Error('Packaged executable is unexpectedly small');

console.log(`Verified package: ${packageRoot}`);
console.log(`Checked ${entries.length} asar entries and ${nativeFiles.length} native binding(s).`);
