// Repository check: node tools/check-repo.js (npm run check), also run before every git push by .githooks/pre-push
// once the hooks are enabled with: git config core.hooksPath .githooks
//
// It checks that:
//  - no tracked file contains a string from the denylist (the author's personal data): PNG and other binary
//    files as raw bytes, text files and file names case-insensitively,
//  - no commit message, author or committer name or e-mail contains a denylisted string (case-insensitively)
//    and no committed file version does either (a later fix does not remove it from the history),
//  - every author and committer e-mail is a GitHub noreply address,
//  - text files and commit messages contain no other e-mail address.
// The history is what a push can publish: local branches, tags and HEAD.
// The list is outside the repository: the path in ALIFA_DENYLIST, otherwise ../ali-faktura-denylist.txt next to
// the extension folder. Without it the denylist checks are skipped and the other checks still run.
// A denylisted string is never printed, only its length and its line in the list.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- denylist

const denyPath = process.env.ALIFA_DENYLIST || path.join(ROOT, '..', 'ali-faktura-denylist.txt');
let deny = [];
if (fs.existsSync(denyPath)) {
  deny = fs.readFileSync(denyPath, 'utf8').split(/\r?\n/)
    .map((s, i) => ({ text: s.trim(), line: i + 1 }))
    .filter((d) => d.text && !d.text.startsWith('#'))
    .map((d) => ({ ...d, lower: d.text.toLowerCase(), raw: rawForms(d.text) }));
} else {
  console.warn('WARNING: denylist not found (' + denyPath + '), personal data check skipped');
}

// byte sequences of a denylisted string in a binary file: UTF-8, plus Latin-1 for accented Latin-1 characters
function rawForms(s) {
  const forms = [Buffer.from(s, 'utf8')];
  if (/[\x80-\xff]/.test(s) && !/[^\x00-\xff]/.test(s)) forms.push(Buffer.from(s, 'latin1'));
  return forms;
}

const hit = (d) => `denylisted string (${d.text.length} characters, line ${d.line} of the denylist)`;

// Every printed line goes through mask(), so a denylisted string never reaches the screen,
// not even as part of a file name.
function mask(line) {
  const lower = line.toLowerCase();
  if (lower.length !== line.length) line = lower; // a few characters change length when lowercased
  for (const d of deny) {
    for (let i = lower.indexOf(d.lower); i !== -1; i = lower.indexOf(d.lower, i + 1)) {
      line = line.slice(0, i) + '*'.repeat(d.lower.length) + line.slice(i + d.lower.length);
    }
  }
  return line;
}

function git(args, input) {
  try {
    return execFileSync('git', args, { cwd: ROOT, input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(mask(`ERROR: git ${args[0]} failed: ${String(e.stderr || e.message).trim()}`));
    process.exit(1);
  }
}

// ---------------------------------------------------------------- checks of one text or file version

const problems = [];

// Allowed e-mail addresses carry no personal data: <id>+<user>@users.noreply.github.com, and the committer
// of merges and edits made on the GitHub website.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const isNoreply = (email) => /@users\.noreply\.github\.com$/i.test(email) || /^noreply@github\.com$/i.test(email);

// line numbers of the other e-mail addresses in a text
function foreignEmails(text) {
  const lines = [];
  text.split('\n').forEach((line, i) => {
    if (line.includes('@') && (line.match(EMAIL) || []).some((e) => !isNoreply(e))) lines.push(i + 1);
  });
  return lines;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// where: '' for the working tree, ' (committed version, blob <id>)' for the history
function checkFile(file, buf, where) {
  if (where === '' || !current.has(file)) {
    for (const d of deny) if (file.toLowerCase().includes(d.lower)) problems.push(`${file}${where}: the file name contains a ${hit(d)}`);
  }
  if (/\.png$/i.test(file) || buf.subarray(0, 8000).includes(0)) {
    for (const d of deny) if (d.raw.some((r) => buf.includes(r))) problems.push(`${file}${where} contains a ${hit(d)}`);
    return;
  }
  const utf8 = buf.toString('utf8');
  const texts = [utf8, buf.toString('latin1')].map((t) => t.toLowerCase());
  for (const d of deny) {
    const t = texts.find((x) => x.includes(d.lower));
    if (t) problems.push(`${file}:${lineOf(t, t.indexOf(d.lower))}${where} contains a ${hit(d)}`);
  }
  for (const n of foreignEmails(utf8)) {
    problems.push(`${file}:${n}${where} contains an e-mail address that is not a GitHub noreply address`);
  }
}

// ---------------------------------------------------------------- tracked files (working tree)

const isFile = (f) => {
  try {
    return fs.lstatSync(path.join(ROOT, f)).isFile();
  } catch {
    return false;
  }
};
const files = [...new Set(git(['ls-files', '-z']).toString('utf8').split('\0'))].filter((f) => f && isFile(f));
const current = new Set(files);
const seen = new Set(); // blob ids of the checked contents, the history check skips them
for (const f of files) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  seen.add(crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex'));
  checkFile(f, buf, '');
}

// ---------------------------------------------------------------- history: local branches, tags and HEAD

const revs = ['--branches', '--tags'];
if (spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: ROOT }).status === 0) revs.push('HEAD');

const FIELDS = ['author name', 'author e-mail', 'committer name', 'committer e-mail', 'message'];
const log = git(['log', '--no-use-mailmap', '--no-show-signature', '--format=%x1e%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B', ...revs]);
const commits = log.toString('utf8').split('\x1e').slice(1).map((c) => c.split('\x1f'));
for (const [sha, ...values] of commits) {
  values.forEach((v, i) => {
    for (const d of deny) if (v.toLowerCase().includes(d.lower)) problems.push(`commit ${sha}: the ${FIELDS[i]} contains a ${hit(d)}`);
  });
  if (!isNoreply(values[1])) problems.push(`commit ${sha}: the author e-mail is not a GitHub noreply address`);
  if (!isNoreply(values[3])) problems.push(`commit ${sha}: the committer e-mail is not a GitHub noreply address`);
  if (foreignEmails(values[4]).length) problems.push(`commit ${sha}: the message contains an e-mail address that is not a GitHub noreply address`);
}

// committed file versions: every blob reachable from these commits whose content was not checked above
const versions = [];
for (const line of git(['rev-list', '--objects', ...revs]).toString('utf8').split('\n')) {
  const sp = line.indexOf(' ');
  // commits come without a name, the root tree with an empty one
  if (sp > 0 && sp < line.length - 1 && !seen.has(line.slice(0, sp))) versions.push([line.slice(0, sp), line.slice(sp + 1)]);
}
if (versions.length) {
  const out = git(['cat-file', '--batch'], versions.map((v) => v[0]).join('\n') + '\n');
  let pos = 0;
  for (const [, file] of versions) {
    const eol = out.indexOf(10, pos);
    const [id, type, size] = out.toString('latin1', pos, eol).split(' ');
    pos = eol + 1;
    if (type === 'missing') continue;
    if (type === 'blob') checkFile(file, out.subarray(pos, pos + Number(size)), ` (committed version, blob ${id.slice(0, 7)})`);
    pos += Number(size) + 1;
  }
}

// ---------------------------------------------------------------- result

if (problems.length) {
  console.error(mask(`ERROR: repository check found ${problems.length} problem${problems.length === 1 ? '' : 's'}:`));
  for (const p of problems) console.error(mask('  ' + p));
  if (problems.some((p) => p.includes('(committed version'))) {
    console.error(mask('A committed version has to be removed from the history (git log --all --find-object=<blob> shows its commits).'));
  }
  process.exitCode = 1;
} else {
  console.log(mask(`repository check: ${files.length} files, ${commits.length} commits, ${deny.length} denylisted strings, OK`));
}
