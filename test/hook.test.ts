// Runs hooks/penmark.js as Claude Code would: event JSON on stdin.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, test } from 'node:test';
import { editText, keyFor, readStore } from '../src/store';

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'penmark.js');

let claude: string; // stands in for ~/.claude
let store: string;
let docs: string;

beforeEach(() => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'penmark-hook-')));
  claude = path.join(tmp, 'claude');
  store = path.join(tmp, 'store');
  docs = path.join(tmp, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, 'penmark.json'), JSON.stringify({ storageDir: store }));
});

function runHook(event: unknown) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof event === 'string' ? event : JSON.stringify(event),
    env: { ...process.env, PENMARK_CLAUDE_DIR: claude },
    encoding: 'utf8',
  });
  return r;
}

function editEvent(file: string, originalFile: string | null, extra: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    session_id: 'sess-1',
    prompt_id: 'prompt-1',
    tool_use_id: 'toolu_0123456789abcdef',
    transcript_path: '/nowhere/sess-1.jsonl',
    cwd: docs,
    tool_input: { file_path: file },
    tool_response: { originalFile },
    ...extra,
  };
}

test('records before and after text for an Edit', () => {
  const file = path.join(docs, 'plan.md');
  fs.writeFileSync(file, 'The sky is blue.\n');
  const r = runHook(editEvent(file, 'The sky is green.\n'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');

  const [doc] = readStore(store);
  assert.equal(doc.path, file);
  assert.equal(doc.key, keyFor(file));
  assert.equal(doc.edits.length, 1);
  assert.deepEqual(
    { sessionId: doc.edits[0].sessionId, promptId: doc.edits[0].promptId, newFile: doc.edits[0].newFile },
    { sessionId: 'sess-1', promptId: 'prompt-1', newFile: false },
  );
  assert.deepEqual(editText(doc, doc.edits[0]), { before: 'The sky is green.\n', after: 'The sky is blue.\n' });
});

test('a new file (originalFile null) has empty before text', () => {
  const file = path.join(docs, 'new.md');
  fs.writeFileSync(file, '# New\n');
  runHook(editEvent(file, null, { tool_name: 'Write' }));
  const [doc] = readStore(store);
  assert.equal(doc.edits[0].newFile, true);
  assert.equal(editText(doc, doc.edits[0]).before, '');
});

test('several edits to one doc pile up until reviewed', () => {
  const file = path.join(docs, 'plan.md');
  fs.writeFileSync(file, 'v2\n');
  runHook(editEvent(file, 'v1\n', { session_id: 'sess-A' }));
  fs.writeFileSync(file, 'v3\n');
  runHook(editEvent(file, 'v2\n', { session_id: 'sess-B', tool_use_id: 'toolu_other_edit_id' }));
  const [doc] = readStore(store);
  assert.deepEqual(doc.edits.map(e => e.sessionId), ['sess-A', 'sess-B']);
  assert.equal(editText(doc, doc.edits[0]).before, 'v1\n');
});

test('relative paths resolve against the event cwd', () => {
  fs.writeFileSync(path.join(docs, 'rel.md'), 'after\n');
  runHook(editEvent('rel.md', 'before\n'));
  assert.equal(readStore(store)[0].path, path.join(docs, 'rel.md'));
});

test('ignores non-markdown files, no-op edits and other events', () => {
  const code = path.join(docs, 'app.ts');
  fs.writeFileSync(code, 'x');
  runHook(editEvent(code, 'y'));
  const same = path.join(docs, 'same.md');
  fs.writeFileSync(same, 'unchanged\n');
  runHook(editEvent(same, 'unchanged\n'));
  runHook({ ...editEvent(same, 'other\n'), hook_event_name: 'PreToolUse' });
  assert.deepEqual(readStore(store), []);
});

test('ignores files inside the store itself', () => {
  const inside = path.join(store, 'note.md');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(inside, 'a\n');
  runHook(editEvent(inside, 'b\n'));
  assert.deepEqual(readStore(store), []);
});

test('bad input never fails the session: exit 0, nothing printed, error logged', () => {
  const r = runHook('{not json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
  assert.match(fs.readFileSync(path.join(store, 'hook-errors.log'), 'utf8'), /JSON/);
});

test('a response without originalFile is logged, not guessed', () => {
  const file = path.join(docs, 'plan.md');
  fs.writeFileSync(file, 'after\n');
  const ev = editEvent(file, null) as any;
  delete ev.tool_response.originalFile;
  assert.equal(runHook(ev).status, 0);
  assert.deepEqual(readStore(store), []);
  assert.match(fs.readFileSync(path.join(store, 'hook-errors.log'), 'utf8'), /no originalFile/);
});

test('without a pointer file it uses <claude dir>/penmark', () => {
  fs.rmSync(path.join(claude, 'penmark.json'));
  const file = path.join(docs, 'plan.md');
  fs.writeFileSync(file, 'after\n');
  runHook(editEvent(file, 'before\n'));
  assert.equal(readStore(path.join(claude, 'penmark')).length, 1);
});

// ---- Edits made through Bash ----------------------------------------------

function bash(phase: 'PreToolUse' | 'PostToolUse', command: string, id = 'toolu_bash_000001') {
  return runHook({
    hook_event_name: phase, tool_name: 'Bash', session_id: 'sess-1', prompt_id: 'p1', tool_use_id: id,
    transcript_path: '/nowhere/sess-1.jsonl', cwd: docs, tool_input: { command },
    ...(phase === 'PostToolUse' ? { tool_response: { stdout: '', stderr: '' } } : {}),
  });
}
/** Run a shell command between the two hook events, as Claude Code does. */
function claudeRuns(command: string, id?: string) {
  bash('PreToolUse', command, id);
  spawnSync('/bin/bash', ['-c', command], { cwd: docs });
  bash('PostToolUse', command, id);
}

test('Bash: an inline script editing a doc after cd, with spaces and brackets in the name', () => {
  fs.mkdirSync(path.join(docs, 'Local docs'));
  const file = path.join(docs, 'Local docs', '[Gaps] App UX.md');
  fs.writeFileSync(file, '# Gaps\n\nFR2 is Partial.\n');
  // Shaped like the command Claude actually ran: cd, then a script naming the file relatively.
  claudeRuns(`cd "${path.join(docs, 'Local docs')}" && ${process.execPath} - <<'EOF'
const fs = require('fs'); const p = "[Gaps] App UX.md";
fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Partial', 'Built'));
EOF`);
  const [doc] = readStore(store);
  assert.equal(doc.path, file);
  assert.equal(doc.edits[0].tool, 'Bash');
  assert.deepEqual(editText(doc, doc.edits[0]), { before: '# Gaps\n\nFR2 is Partial.\n', after: '# Gaps\n\nFR2 is Built.\n' });
  assert.deepEqual(fs.readdirSync(path.join(store, 'pending')), [], 'snapshot cleaned up');
});

test('Bash: sed -i on a bare relative path, and an escaped space', () => {
  fs.writeFileSync(path.join(docs, 'plan.md'), 'old\n');
  fs.writeFileSync(path.join(docs, 'my notes.md'), 'old\n');
  claudeRuns("sed -i '' 's/old/new/' plan.md my\\ notes.md");
  assert.deepEqual(readStore(store).map(d => path.basename(d.path)).sort(), ['my notes.md', 'plan.md']);
});

test('Bash: a file the command creates is recorded as new', () => {
  claudeRuns(`printf '# Fresh\\n' > fresh.md`);
  const [doc] = readStore(store);
  assert.equal(path.basename(doc.path), 'fresh.md');
  assert.equal(doc.edits[0].newFile, true);
  assert.equal(editText(doc, doc.edits[0]).before, '');
});

test('Bash: reading a doc, or a command without markdown, records nothing', () => {
  fs.writeFileSync(path.join(docs, 'plan.md'), 'same\n');
  claudeRuns('cat plan.md && wc -l plan.md');
  claudeRuns('ls -la', 'toolu_bash_000002');
  assert.deepEqual(readStore(store), []);
  assert.equal(fs.existsSync(path.join(store, 'pending')) ? fs.readdirSync(path.join(store, 'pending')).length : 0, 0);
});

test('Bash: only files the command names are checked', () => {
  fs.writeFileSync(path.join(docs, 'named.md'), 'a\n');
  fs.writeFileSync(path.join(docs, 'other.md'), 'a\n');
  claudeRuns('echo b > named.md; echo b > "$(echo other).md"');
  assert.deepEqual(readStore(store).map(d => path.basename(d.path)), ['named.md']);
});

test('Bash: globs like *.md are not treated as files, and leave no snapshot', () => {
  fs.writeFileSync(path.join(docs, 'a.md'), 'x\n');
  bash('PreToolUse', 'ls *.md && grep -rl foo --include=*.md .');
  assert.equal(fs.existsSync(path.join(store, 'pending')) ? fs.readdirSync(path.join(store, 'pending')).length : 0, 0);
});
