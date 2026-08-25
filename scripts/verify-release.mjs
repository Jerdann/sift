import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const version = String(manifest.version ?? '');
const tag = process.env.SIFT_RELEASE_TAG?.trim();
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semverPattern.test(version)) {
  throw new Error(`package.json contains an invalid semantic version: ${version || '<missing>'}`);
}

const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changelogHeading = new RegExp(`^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`, 'm');
if (!changelogHeading.test(changelog)) {
  throw new Error(`CHANGELOG.md has no release heading for ${version}`);
}

if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${version}`);
}

process.stdout.write(`Release metadata verified for v${version}${tag ? ` (${tag})` : ''}.\n`);
