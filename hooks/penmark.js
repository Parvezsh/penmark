#!/usr/bin/env node
// Penmark: Claude Code hook (PostToolUse on Edit/Write/MultiEdit/Bash,
// PreToolUse on Bash).
//
// After Claude edits a markdown file, store the text before and after the edit
// so the extension can highlight what Claude changed. Edits you make yourself
// never pass through here, so they are never highlighted.
//
// Runs inside every Claude session: it must be fast, print nothing and never
// fail the session. Any error goes to <store>/hook-errors.log and exits 0.
// No dependencies; keep it compatible with Node 18.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MARKDOWN = ['.md', '.markdown'];

function claudeDir() {
  return process.env.PENMARK_CLAUDE_DIR || path.join(os.homedir(), '.claude');
}

// The extension writes the chosen storage folder here; hooks can't read VS Code settings.
function storeDir() {
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(claudeDir(), 'penmark.json'), 'utf8'));
    if (pointer && typeof pointer.storageDir === 'string' && pointer.storageDir) return pointer.storageDir;
  } catch { /* no pointer yet: use the default */ }
  return path.join(claudeDir(), 'penmark');
}

// Same key as src/store.ts keyFor(): one folder per document.
function keyFor(absPath) {
  return crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 16);
}

function canonical(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

function handle(ev, root) {
  if (!ev) return;
  const input = ev.tool_input || {};
  if (ev.tool_name === 'Bash') {
    if (ev.hook_event_name === 'PreToolUse') snapshotBash(ev, root);
    else if (ev.hook_event_name === 'PostToolUse') compareBash(ev, root);
    return;
  }
  if (ev.hook_event_name !== 'PostToolUse' || typeof input.file_path !== 'string') return;
  if (!MARKDOWN.includes(path.extname(input.file_path).toLowerCase())) return;
  const abs = canonical(path.resolve(ev.cwd || process.cwd(), input.file_path));
  if (abs.startsWith(canonical(root) + path.sep)) return;

  // originalFile is the text before the edit; null means Claude created the file.
  const resp = ev.tool_response || {};
  if (!('originalFile' in resp)) throw new Error(`no originalFile in ${ev.tool_name} response for ${abs}`);
  const before = typeof resp.originalFile === 'string' ? resp.originalFile : '';
  saveEdit(root, ev, abs, before, fs.readFileSync(abs, 'utf8'), resp.originalFile === null);
}

function saveEdit(root, ev, abs, before, after, newFile) {
  if (before === after) return;
  const dir = path.join(root, 'files', keyFor(abs));
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${String(ev.tool_use_id || crypto.randomUUID()).slice(-12)}`;
  // Write the copies first, so every edits.jsonl line points at files that exist.
  fs.writeFileSync(path.join(dir, `${id}.before.md`), before);
  fs.writeFileSync(path.join(dir, `${id}.after.md`), after);
  fs.appendFileSync(path.join(dir, 'edits.jsonl'), JSON.stringify({
    v: 1,
    id,
    at: new Date().toISOString(),
    path: abs,
    tool: ev.tool_name,
    newFile,
    sessionId: ev.session_id,
    promptId: ev.prompt_id,
    toolUseId: ev.tool_use_id,
    transcriptPath: ev.transcript_path,
    cwd: ev.cwd,
  }) + '\n');
}

// ---- Edits made through shell commands ------------------------------------
//
// Claude often edits files with sed, a heredoc or an inline script instead of
// its Edit tool. Before a Bash command runs, save the markdown files the
// command names; after it ran, record the ones that changed.

const MAX_FILES = 30;
const MAX_BYTES = 5 * 1024 * 1024;

const expandHome = p => p.replace(/^~(?=\/|$)/, os.homedir()).replace(/^\$\{?HOME\}?(?=\/|$)/, os.homedir());
const unescape = p => p.replace(/\\(.)/g, '$1');

/** Markdown file names in a shell command: quoted, or bare (with \-escaped spaces). */
function markdownNames(command) {
  const names = [];
  const re = /"((?:[^"\\]|\\.)*?\.(?:md|markdown))"|'([^']*?\.(?:md|markdown))'|((?:\\.|[^\s"'`;&|<>()=])+?\.(?:md|markdown))(?![\w.])/gi;
  for (let m; (m = re.exec(command)); ) names.push(m[1] !== undefined ? unescape(m[1]) : m[2] !== undefined ? m[2] : unescape(m[3]));
  return names;
}

/** Folders the command works in: the session's, then each `cd` target in order. */
function commandFolders(command, cwd) {
  const folders = [cwd];
  const re = /(?:^|[;&|\n(]\s*)cd\s+(?:"([^"]+)"|'([^']+)'|((?:\\.|[^\s;&|)])+))/g;
  for (let m; (m = re.exec(command)); ) {
    const target = expandHome(m[1] ?? m[2] ?? unescape(m[3]));
    folders.push(path.resolve(folders[folders.length - 1], target));
  }
  return folders;
}

function snapshotBash(ev, root) {
  const command = (ev.tool_input || {}).command;
  if (typeof command !== 'string' || !/\.(md|markdown)\b/i.test(command)) return;
  const folders = commandFolders(command, ev.cwd || process.cwd());
  const storeRoot = canonical(root) + path.sep;
  const files = new Map();
  for (const name of markdownNames(command)) {
    if (/[*?]/.test(name)) continue; // a glob such as *.md, not a file
    const expanded = expandHome(name);
    const options = path.isAbsolute(expanded) ? [expanded] : [...folders].reverse().map(f => path.join(f, expanded));
    // The file as it exists now; for a file the command will create, the most likely place.
    const found = options.find(o => fs.existsSync(o)) ?? options.find(o => fs.existsSync(path.dirname(o)));
    if (!found) continue;
    const abs = canonical(found);
    if (abs.startsWith(storeRoot) || files.has(abs)) continue;
    let before = null;
    try {
      if (fs.statSync(abs).size > MAX_BYTES) continue;
      before = fs.readFileSync(abs, 'utf8');
    } catch { /* doesn't exist yet */ }
    files.set(abs, before);
    if (files.size >= MAX_FILES) break;
  }
  if (!files.size) return;
  const dir = path.join(root, 'pending');
  fs.mkdirSync(dir, { recursive: true });
  dropStale(dir);
  fs.writeFileSync(path.join(dir, `${pendingId(ev)}.json`), JSON.stringify([...files].map(([p, before]) => ({ path: p, before }))));
}

function compareBash(ev, root) {
  const file = path.join(root, 'pending', `${pendingId(ev)}.json`);
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return; // the command named no markdown files
  }
  fs.rmSync(file, { force: true });
  for (const { path: abs, before } of snapshot) {
    let after;
    try { after = fs.readFileSync(abs, 'utf8'); } catch { continue; } // deleted or never created
    saveEdit(root, ev, abs, before ?? '', after, before === null);
  }
}

const pendingId = ev => String(ev.tool_use_id || 'unknown').replace(/[^\w-]/g, '');

/** Snapshots whose command never finished (session killed) are dropped after a day. */
function dropStale(dir) {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const f of fs.readdirSync(dir)) {
    try { if (fs.statSync(path.join(dir, f)).mtimeMs < dayAgo) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* raced */ }
  }
}

function logError(root, err) {
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(path.join(root, 'hook-errors.log'), `${new Date().toISOString()} ${err && err.stack || err}\n`);
  } catch { /* nothing else we can do */ }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  const root = storeDir();
  try { handle(JSON.parse(raw), root); } catch (err) { logError(root, err); }
  process.exit(0);
});
