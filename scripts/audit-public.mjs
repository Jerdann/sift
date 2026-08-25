import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const gitPrefix = ['-c', `safe.directory=${process.cwd()}`];
const trackedFiles = execFileSync('git', [...gitPrefix, 'ls-files', '-z'], {
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const forbiddenDirectoryPattern = ['.plan' + 'ning', '.ag' + 'ents', '.co' + 'dex']
  .map((name) => name.replace('.', '\\.'))
  .join('|');
const forbiddenPaths = new RegExp(
  `(?:^|/)(?:${forbiddenDirectoryPattern})(?:/|$)|(?:^|/)AGENTS\\.md$`,
  'i',
);
const localUserPathPattern = new RegExp(
  ['[A-Za-z]:\\\\Users\\\\', 'Documents\\\\Chat' + 'GPT', 'AppData\\\\Local\\\\Temp'].join('|'),
  'i',
);
const forbiddenContent = [
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Google OAuth secret', pattern: /GOCSPX-[0-9A-Za-z_-]{20,}/ },
  { name: 'GitHub token', pattern: /(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'OpenAI-style secret', pattern: /sk-[0-9A-Za-z]{20,}/ },
  { name: 'local user path', pattern: localUserPathPattern },
];
const internalWorkflowPattern = new RegExp(
  `\\b(?:${['co' + 'dex', 'chat' + 'gpt', 'clau' + 'de'].join('|')})\\b|${'impec' + 'cable'}:`,
  'i',
);
const emailPattern = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const allowedEmailDomain = (domain) =>
  domain === 'example.com' ||
  domain.endsWith('.example') ||
  domain.endsWith('.test') ||
  domain === 'forward.protonmail.ch';

const failures = [];
for (const file of trackedFiles) {
  const normalized = file.replaceAll('\\', '/');
  if (forbiddenPaths.test(normalized)) {
    failures.push(`${normalized}: internal-only path is tracked`);
    continue;
  }

  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;
  const content = buffer.toString('utf8');

  for (const rule of forbiddenContent) {
    if (rule.pattern.test(content)) failures.push(`${normalized}: ${rule.name} signature`);
  }

  if (normalized !== '.gitignore' && internalWorkflowPattern.test(content)) {
    failures.push(`${normalized}: internal AI-workflow marker`);
  }

  if (normalized !== 'pnpm-lock.yaml') {
    for (const match of content.matchAll(emailPattern)) {
      if (!allowedEmailDomain(match[1].toLowerCase())) {
        failures.push(`${normalized}: non-synthetic email literal`);
      }
    }
  }
}

const commitEmails = execFileSync('git', [...gitPrefix, 'log', '-1', '--format=%ae%n%ce'], {
  encoding: 'utf8',
}).trim().split(/\r?\n/);
for (const email of commitEmails) {
  if (!email.toLowerCase().endsWith('@users.' + 'noreply.github.com')) {
    failures.push('HEAD: commit metadata contains a non-no-reply email');
  }
}

if (failures.length > 0) {
  console.error('Public-source privacy audit failed:');
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Public-source privacy audit passed for ${trackedFiles.length} tracked files.`);
