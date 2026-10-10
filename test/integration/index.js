// VS Code integration test, run inside an Extension Development Host by
// scripts/test-integration.sh. Dialogs are answered by stubbing vscode.window.
// Results go to PENMARK_RESULT as JSON lines (the host's console isn't visible).
const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const claude = process.env.PENMARK_CLAUDE_DIR;
const out = process.env.PENMARK_RESULT;
const docsDir = fs.realpathSync(path.join(claude, '..', 'docs'));
const planPath = path.join(docsDir, 'plan.md');
const report = o => fs.appendFileSync(out, JSON.stringify(o) + '\n');
const settingsFile = path.join(claude, 'settings.json');
const userSettings = {
  hooks: {
    PreToolUse: [{ matcher: 'Bash|Edit', hooks: [{ type: 'command', command: 'guard.sh', timeout: 5 }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }],
  },
};
let api;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function answer(method, pick) {
  const original = vscode.window[method];
  vscode.window[method] = async (...args) => pick(...args);
  return () => { vscode.window[method] = original; };
}

/** Run the installed hook command exactly as Claude Code would after an edit. */
function claudeEdits(file, before, after, extra = {}) {
  fs.writeFileSync(file, after);
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const event = {
    hook_event_name: 'PostToolUse', tool_name: 'Edit', session_id: 'sess-int', prompt_id: 'p1',
    tool_use_id: `toolu_${Math.random().toString(36).slice(2)}`, transcript_path: path.join(claude, 'no-transcript.jsonl'),
    cwd: docsDir, tool_input: { file_path: file }, tool_response: { originalFile: before }, ...extra,
  };
  execSync(s.hooks.PostToolUse[0].hooks[0].command, { input: JSON.stringify(event), env: { ...process.env, PENMARK_CLAUDE_DIR: claude } });
}

const render = async file => vscode.commands.executeCommand('markdown.api.render', await vscode.workspace.openTextDocument(vscode.Uri.file(file)));

const steps = [
  ['activates and writes the pointer', async () => {
    await vscode.window.showTextDocument(vscode.Uri.file(planPath));
    api = await vscode.extensions.getExtension('penmark-dev.penmark').activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['installHooks', 'toggleHighlights', 'addComment', 'sendComments', 'markReviewed']) assert.ok(cmds.includes(`penmark.${c}`), c);
    const pointer = JSON.parse(fs.readFileSync(path.join(claude, 'penmark.json'), 'utf8'));
    assert.equal(pointer.storageDir, path.join(claude, 'penmark'));
  }],
  ['install shows a diff, then merges the hook into existing settings', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify(userSettings, null, 2) + '\n');
    const restore = answer('showInformationMessage', (msg, ...items) => (items.includes('Install') ? 'Install' : undefined));
    try { await vscode.commands.executeCommand('penmark.installHooks'); } finally { restore(); }
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff, 'diff editor was shown');
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.deepEqual(s.hooks.PreToolUse[0], userSettings.hooks.PreToolUse[0], 'user hook untouched');
    assert.equal(s.hooks.PreToolUse[1].matcher, 'Bash', 'our before-Bash entry added after it');
    assert.deepEqual(s.hooks.Stop, userSettings.hooks.Stop);
    assert.equal(s.hooks.PostToolUse[0].matcher, 'Edit|Write|MultiEdit|Bash');
    assert.match(s.hooks.PostToolUse[0].hooks[0].command, /^\/\S+\/node \S+\/hooks\/penmark\.js$/);
    assert.ok(fs.readdirSync(claude).some(f => f.startsWith('settings.json.bak-penmark-')), 'backup kept');
  }],
  ['a Claude edit shows up as a change, in the panel and as a diff', async () => {
    claudeEdits(planPath, '# Plan\n\nWe ship in March. Risks are low.\n', '# Plan\n\nWe ship in April. Risks are low. QA starts in February.\n');
    for (let i = 0; i < 20 && !api._model.docs.length; i++) await sleep(150);
    const doc = api._model.docFor(planPath);
    assert.ok(doc, 'model sees the edit');
    const changes = api._model.changesFor(doc, api._model.currentText(planPath));
    assert.deepEqual(changes.map(c => [c.kind, c.text]), [['modified', 'We ship in April.'], ['added', 'QA starts in February.']]);
    await vscode.commands.executeCommand('penmark.openDiff', doc);
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
    report({ changes: changes.map(c => ({ kind: c.kind, text: c.text, old: c.oldText })) });
  }],
  ['the preview is annotated for highlighting, and the toggle turns it off', async () => {
    const html = await render(planPath);
    const m = /data-penmark="([^"]*)"/.exec(html);
    assert.ok(m, 'a block carries data-penmark');
    const data = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.deepEqual(data.a, ['QA starts in February.']);
    assert.deepEqual(data.m.map(x => [x.t, x.w]), [['We ship in April.', ['April']]]);
    assert.match(html, /id="penmark-meta" data-ext="penmark-dev.penmark" data-on="1"/);
    await vscode.commands.executeCommand('penmark.toggleHighlights');
    const off = await render(planPath);
    assert.ok(!/data-penmark=/.test(off), 'no highlights when toggled off');
    assert.match(off, /data-on="0"/);
    await vscode.commands.executeCommand('penmark.toggleHighlights');
    report({ previewData: data });
  }],
  ['a removed paragraph becomes a removed block in the preview', async () => {
    const other = path.join(docsDir, 'other.md');
    claudeEdits(other, '# Other\n\nKeep this.\n\nDrop line one.\nDrop line two.\n\nEnd.\n', '# Other\n\nKeep this.\n\nEnd.\n');
    for (let i = 0; i < 20 && !api._model.docFor(other); i++) await sleep(150);
    const html = await render(other);
    assert.match(html, /class="penmark-removed-block"[^>]*><del>Drop line one\. Drop line two\.<\/del>/);
  }],
  ['mark reviewed clears one doc', async () => {
    const other = api._model.docFor(path.join(docsDir, 'other.md'));
    await vscode.commands.executeCommand('penmark.markReviewed', other);
    assert.equal(api._model.docFor(path.join(docsDir, 'other.md')), undefined);
    assert.ok(api._model.docFor(planPath), 'other docs untouched');
  }],
  ['changing the storage folder offers to move, then repoints the hook', async () => {
    const to = path.join(claude, '..', 'moved-store');
    const restore = answer('showInformationMessage', (msg, ...items) => (items.includes('Move') ? 'Move' : undefined));
    try {
      await vscode.workspace.getConfiguration('penmark').update('storageDir', to, vscode.ConfigurationTarget.Global);
      await sleep(1000);
    } finally { restore(); }
    assert.equal(JSON.parse(fs.readFileSync(path.join(claude, 'penmark.json'), 'utf8')).storageDir, to);
    assert.equal(api._model.storeDir, to);
    assert.ok(api._model.docFor(planPath), 'tracked doc came along');
  }],
  ['comments: what is typed in the editor comment box is saved as a thread', async () => {
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(planPath));
    const text = editor.document.getText();
    const start = text.indexOf('We ship in April.');
    const range = new vscode.Range(editor.document.positionAt(start), editor.document.positionAt(start + 'We ship in April.'.length));
    // ⌥C opens VS Code's own comment box; submitting it calls saveNativeComment with the reply.
    let disposed = false;
    const reply = { text: 'Say which week in April.', thread: { uri: editor.document.uri, range, dispose: () => { disposed = true; } } };
    await vscode.commands.executeCommand('penmark.saveNativeComment', reply);
    assert.ok(disposed, 'the draft thread is replaced by a saved one');
    assert.equal(api._model.comments.length, 1);
    const c = api._model.comments[0];
    assert.deepEqual([c.quote, c.body, c.line], ['We ship in April.', 'Say which week in April.', 2]);
  }],
  ['comments from the preview find the source text through markup', async () => {
    fs.writeFileSync(path.join(docsDir, 'styled.md'), '# Styled\n\nThis has **bold words** and a [link](https://example.com) inside.\n');
    // The preview's comment box sends the typed text along with the selection.
    await api._threads.addFromPreview(vscode.Uri.file(path.join(docsDir, 'styled.md')), 2, 2, 'bold words and a link', 'Clarify.');
    const c = api._model.comments.find(x => x.body === 'Clarify.');
    assert.deepEqual([c.line, c.startChar, c.endChar], [2, 11, 35]);
    const html = await render(planPath);
    assert.match(html, /&quot;c&quot;:\[\{&quot;q&quot;:&quot;We ship in April\.&quot;/, 'commented text is marked in the preview');
  }],
  ['send writes one notes file, puts the prompt on the clipboard and clears the batch', async () => {
    let message;
    const restore = answer('showInformationMessage', msg => { message = msg; return undefined; });
    try { await vscode.commands.executeCommand('penmark.sendComments'); } finally { restore(); }
    const notesDir = path.join(docsDir, '.penmark');
    const notes = fs.readdirSync(notesDir).filter(f => f.startsWith('review-'));
    assert.equal(notes.length, 1);
    assert.equal(fs.readFileSync(path.join(notesDir, '.gitignore'), 'utf8'), '*\n');
    const body = fs.readFileSync(path.join(notesDir, notes[0]), 'utf8');
    assert.match(body, /## plan\.md\n\n1\. \*\*Line 3\*\*\n   > We ship in April\.\n\n   Say which week in April\./);
    assert.match(body, /## styled\.md/);
    const clip = await vscode.env.clipboard.readText();
    assert.equal(clip, `Please address my review comments in .penmark/${notes[0]}. Each comment quotes the text it is about.`);
    assert.equal(api._model.comments.length, 0, 'batch cleared');
    assert.equal(api._model.docFor(planPath), undefined, 'commented doc marked reviewed');
    assert.match(message, /isn't installed|clipboard|chat box/);
    report({ notesFile: notes[0], message, notes: body });
  }],
  ['uninstall restores settings.json exactly', async () => {
    const restore = answer('showInformationMessage', (msg, ...items) => (items.includes('Uninstall') ? 'Uninstall' : undefined));
    try { await vscode.commands.executeCommand('penmark.uninstallHooks'); } finally { restore(); }
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), JSON.stringify(userSettings, null, 2) + '\n');
    assert.equal(fs.existsSync(path.join(claude, 'hooks', 'penmark.js')), false);
  }],
];

exports.run = async () => {
  let failed = 0;
  for (const [name, fn] of steps) {
    try { await fn(); report({ name, ok: true }); }
    catch (err) { failed++; report({ name, ok: false, error: String(err && err.stack || err) }); }
  }
  report({ done: true, failed });
  if (failed) throw new Error(`${failed} failed`);
};
