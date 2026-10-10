import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommentThreads } from './commentThreads';
import { ReviewComment } from './comments';
import { EditorHighlights } from './editorHighlights';
import { formatSettings, hasHook, hookCommand, hookIsCurrent, withHook, withoutHook } from './hookInstaller';
import { Model } from './model';
import { claudeSettingsPath, installedHookPath, readPointer, resolveStoreDir, writePointer } from './paths';
import { penmarkPlugin } from './previewPlugin';
import { sendComments } from './send';
import { TrackedDoc, moveStore } from './store';
import { CommentsTree, ReviewTree } from './views';

let log: vscode.OutputChannel;
let model: Model;

const storeDir = () => resolveStoreDir(vscode.workspace.getConfiguration('penmark').get<string>('storageDir'));

export function activate(ctx: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel('Penmark');
  model = new Model(ctx);
  const highlights = new EditorHighlights(model);
  const threads = new CommentThreads(model);
  const reviewView = vscode.window.createTreeView('penmark.review', { treeDataProvider: new ReviewTree(model) });
  const commentsView = vscode.window.createTreeView('penmark.comments', { treeDataProvider: new CommentsTree(model) });
  const badges = () => {
    reviewView.badge = model.docs.length ? { value: model.docs.length, tooltip: `${model.docs.length} docs to review` } : undefined;
    commentsView.badge = model.comments.length ? { value: model.comments.length, tooltip: `${model.comments.length} pending comments` } : undefined;
    void vscode.commands.executeCommand('setContext', 'penmark.hasComments', model.comments.length > 0);
    void vscode.commands.executeCommand('setContext', 'penmark.hasDocs', model.docs.length > 0);
  };
  badges();
  void vscode.commands.executeCommand('setContext', 'penmark.highlightsOn', model.showHighlights);
  const refreshPreview = () => vscode.commands.executeCommand('markdown.preview.refresh').then(undefined, () => undefined);

  const setHighlights = async (on: boolean) => {
    await model.setShowHighlights(on);
    void vscode.window.setStatusBarMessage(on ? '$(eye) Penmark highlights on' : '$(eye-closed) Penmark highlights hidden', 2500);
  };
  const cmd = (id: string, fn: (...args: any[]) => unknown) => vscode.commands.registerCommand(`penmark.${id}`, fn);
  ctx.subscriptions.push(
    log, model, highlights, threads, reviewView, commentsView,
    model.onDidChange(() => {
      badges();
      void refreshPreview();
    }),
    cmd('installHooks', () => installHook(ctx)),
    cmd('uninstallHooks', () => uninstallHook(ctx)),
    cmd('toggleHighlights', () => setHighlights(!model.showHighlights)),
    cmd('hideHighlights', () => setHighlights(false)),
    cmd('showHighlights', () => setHighlights(true)),
    cmd('nextChange', () => highlights.go(1)),
    cmd('previousChange', () => highlights.go(-1)),
    cmd('openReview', (doc: TrackedDoc) => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(doc.path))),
    cmd('openSource', (doc: TrackedDoc) => openSourceAtFirstChange(doc, highlights)),
    cmd('openDiff', (doc: TrackedDoc) => openDiff(doc)),
    cmd('showTracked', () => vscode.commands.executeCommand('penmark.review.focus')),
    cmd('markReviewed', (doc?: TrackedDoc) => markDocReviewed(doc)),
    cmd('markAllReviewed', () => markAllReviewed()),
    cmd('refresh', () => model.refresh()),
    cmd('addComment', () => threads.addFromEditor()),
    cmd('saveNativeComment', (reply: vscode.CommentReply) => threads.saveFromReply(reply)),
    cmd('deleteComment', (arg: vscode.CommentThread | { comment: ReviewComment } | ReviewComment) => {
      const id = 'id' in arg && typeof arg.id === 'string' ? arg.id : 'comment' in arg ? arg.comment.id : threads.idOf(arg as vscode.CommentThread);
      if (id) threads.delete(id);
    }),
    cmd('revealComment', (c: ReviewComment) => revealComment(c)),
    cmd('clearComments', () => clearComments()),
    cmd('sendComments', () => sendComments(model)),
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path !== '/comment') return;
        const q = new URLSearchParams(uri.query);
        const source = q.get('source');
        if (!source) return;
        void threads.addFromPreview(vscode.Uri.parse(source), Number(q.get('line') ?? 0), Number(q.get('endLine') ?? 0), q.get('text') ?? '', q.get('body') ?? undefined);
      },
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('penmark.storageDir')) void storageDirChanged();
      if (e.affectsConfiguration('penmark.showRemovals')) void refreshPreview();
    }),
  );
  // The To review panel's empty state depends on whether the hook is installed,
  // including when settings.json is edited by hand.
  updateHookContext();
  const settingsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(claudeSettingsPath())), 'settings.json'));
  ctx.subscriptions.push(settingsWatcher, settingsWatcher.onDidChange(updateHookContext), settingsWatcher.onDidCreate(updateHookContext), settingsWatcher.onDidDelete(updateHookContext));
  void nudgeIfNotInstalled(ctx);
  return {
    extendMarkdownIt: (md: unknown) => penmarkPlugin(md, model, ctx.extension.id),
    /** For the integration tests only. */
    _model: model,
    _threads: threads,
  };
}

export function deactivate() {}

// ---- Hook install / uninstall -------------------------------------------

function readClaudeSettings(): { text: string; json: Record<string, any> } {
  const file = claudeSettingsPath();
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return { text, json: text.trim() ? JSON.parse(text) : {} };
}

/** Show the exact change to settings.json, then write it only if the user agrees. */
async function changeClaudeSettings(
  ctx: vscode.ExtensionContext,
  change: (json: Record<string, any>) => Record<string, any>,
  question: string,
  action: string,
): Promise<boolean> {
  let current: { text: string; json: Record<string, any> };
  try {
    current = readClaudeSettings();
  } catch (err) {
    void vscode.window.showErrorMessage(`Penmark: can't read ${claudeSettingsPath()}: ${err}`);
    return false;
  }
  const proposed = formatSettings(change(current.json));
  if (proposed === current.text) return true;

  const tmp = ctx.globalStorageUri.fsPath;
  fs.mkdirSync(tmp, { recursive: true });
  const left = path.join(tmp, 'settings.current.json');
  const right = path.join(tmp, 'settings.proposed.json');
  fs.writeFileSync(left, current.text);
  fs.writeFileSync(right, proposed);
  await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(left), vscode.Uri.file(right), `~/.claude/settings.json: ${action}`);

  if ((await vscode.window.showInformationMessage(question, action, 'Cancel')) !== action) return false;
  if (readClaudeSettings().text !== current.text) {
    void vscode.window.showWarningMessage('Penmark: settings.json changed while the diff was open. Run the command again.');
    return false;
  }
  const file = claudeSettingsPath();
  if (current.text) fs.copyFileSync(file, `${file}.bak-penmark-${Date.now()}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, proposed);
  log.appendLine(`${action}: wrote ${file} (backup kept next to it)`);
  return true;
}

async function installHook(ctx: vscode.ExtensionContext) {
  const node = await findNode();
  if (!node) {
    void vscode.window.showErrorMessage('Penmark: no `node` found. The hook needs Node 18 or newer.');
    return;
  }
  const command = hookCommand(node, installedHookPath());
  const ok = await changeClaudeSettings(
    ctx,
    json => withHook(json, command),
    'Add the Penmark hook to ~/.claude/settings.json? The diff shows the exact change; a backup is kept.',
    'Install',
  );
  if (!ok) return;
  fs.mkdirSync(path.dirname(installedHookPath()), { recursive: true });
  fs.copyFileSync(ctx.asAbsolutePath('hooks/penmark.js'), installedHookPath());
  // The pre-release build's script, if it's still there.
  fs.rmSync(path.join(path.dirname(installedHookPath()), 'markdown-redline.js'), { force: true });
  writePointer(storeDir());
  model.useStoreDir();
  log.appendLine(`Hook script: ${installedHookPath()} (run by ${node})`);
  updateHookContext();
  void vscode.window.showInformationMessage(
    'Penmark hook installed. New Claude sessions record markdown edits; restart sessions that were already running.',
  );
}

async function uninstallHook(ctx: vscode.ExtensionContext) {
  const ok = await changeClaudeSettings(
    ctx,
    withoutHook,
    'Remove the Penmark hook from ~/.claude/settings.json? Your other hooks stay as they are.',
    'Uninstall',
  );
  if (!ok) return;
  fs.rmSync(installedHookPath(), { force: true });
  updateHookContext();
  void vscode.window.showInformationMessage('Penmark hook removed. Stored copies are kept until you mark docs reviewed.');
}

function updateHookContext() {
  let installed = false;
  try {
    installed = hasHook(readClaudeSettings().json);
  } catch {
    // Unreadable settings.json: show the install button.
  }
  void vscode.commands.executeCommand('setContext', 'penmark.hookInstalled', installed);
}

async function nudgeIfNotInstalled(ctx: vscode.ExtensionContext) {
  let settings: Record<string, any>;
  try {
    settings = readClaudeSettings().json;
  } catch {
    return;
  }
  if (hasHook(settings)) {
    refreshInstalledScript(ctx);
    if (!hookIsCurrent(settings)) {
      const pick = await vscode.window.showInformationMessage(
        'Penmark: update the Claude Code hook to the current version? It also catches edits Claude makes with shell commands.',
        'Update hook…',
      );
      if (pick) await vscode.commands.executeCommand('penmark.installHooks');
    }
    return;
  }
  if (ctx.globalState.get('nudged')) return;
  await ctx.globalState.update('nudged', true);
  const pick = await vscode.window.showInformationMessage(
    'Penmark needs a Claude Code hook to see which changes Claude made.',
    'Install hook…',
  );
  if (pick) await vscode.commands.executeCommand('penmark.installHooks');
}

/** Keep the installed hook script in step with this version of the extension (it's ours; the settings entry isn't touched). */
function refreshInstalledScript(ctx: vscode.ExtensionContext) {
  try {
    const bundled = fs.readFileSync(ctx.asAbsolutePath('hooks/penmark.js'), 'utf8');
    // Also the pre-release build's script: until its settings entry is updated,
    // it keeps running, and should record into the same store.
    const legacy = path.join(path.dirname(installedHookPath()), 'markdown-redline.js');
    for (const script of [installedHookPath(), legacy]) {
      if (fs.existsSync(script) && fs.readFileSync(script, 'utf8') !== bundled) {
        fs.writeFileSync(script, bundled);
        log.appendLine(`Updated hook script: ${script}`);
      }
    }
  } catch (err) {
    log.appendLine(`Couldn't update the hook script: ${err}`);
  }
}

/** An absolute node path; prefers one that survives nvm version changes. */
async function findNode(): Promise<string | undefined> {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  const fromPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, exe));
  const common = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')]
    : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  const found = [...fromPath, ...common].filter(p => fs.existsSync(p));
  if (!found.length && process.platform !== 'win32') {
    const viaShell = await new Promise<string>(resolve =>
      execFile(process.env.SHELL || '/bin/zsh', ['-lic', 'command -v node'], { timeout: 5000 }, (_e, out) => resolve(String(out || ''))),
    );
    const line = viaShell.split('\n').map(s => s.trim()).find(s => s.startsWith('/') && fs.existsSync(s));
    if (line) found.push(line);
  }
  return found.find(p => !/[/\\]\.?nvm[/\\]/.test(p)) ?? found[0];
}

// ---- Storage folder setting -------------------------------------------------

async function storageDirChanged() {
  const to = storeDir();
  const from = readPointer() ?? to;
  if (from !== to && fs.existsSync(path.join(from, 'files'))) {
    const pick = await vscode.window.showInformationMessage(
      `Move the stored Claude edits from ${from} to ${to}?`,
      'Move',
      'Start fresh',
    );
    if (pick === 'Move') moveStore(from, to);
  }
  writePointer(to);
  model.useStoreDir();
  log.appendLine(`Storage folder: ${to}`);
  const inside = vscode.workspace.workspaceFolders?.find(f => to === f.uri.fsPath || to.startsWith(f.uri.fsPath + path.sep));
  if (inside) {
    void vscode.window.showWarningMessage(
      `The Penmark storage folder is inside ${inside.name}. Add ${path.relative(inside.uri.fsPath, to)}/ to .gitignore.`,
    );
  }
}

// ---- Review actions ---------------------------------------------------------

async function openSourceAtFirstChange(doc: TrackedDoc, highlights: EditorHighlights) {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(doc.path));
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  highlights.go(1);
}

async function openDiff(doc: TrackedDoc) {
  // Baseline = the text before Claude's first unreviewed edit.
  const baseline = vscode.Uri.file(path.join(doc.dir, `${doc.edits[0].id}.before.md`));
  await vscode.commands.executeCommand('vscode.diff', baseline, vscode.Uri.file(doc.path), `${path.basename(doc.path)}: Claude's changes since last review`);
}

async function markDocReviewed(doc?: TrackedDoc) {
  if (!doc) {
    const active = vscode.window.activeTextEditor?.document.uri;
    doc = active?.scheme === 'file' ? model.docFor(active.fsPath) : undefined;
  }
  if (!doc) {
    const pick = await vscode.window.showQuickPick(
      model.docs.map(d => ({ label: path.basename(d.path), description: vscode.workspace.asRelativePath(d.path), doc: d })),
      { placeHolder: 'Mark which doc as reviewed?' },
    );
    doc = pick?.doc;
  }
  if (!doc) return;
  model.markReviewed(doc);
  void vscode.window.setStatusBarMessage(`${path.basename(doc.path)} marked as reviewed`, 3000);
}

async function markAllReviewed() {
  const n = model.docs.length;
  if (!n) return;
  const ok = await vscode.window.showWarningMessage(`Mark all ${n} docs as reviewed? Their highlights will clear.`, { modal: true }, 'Mark reviewed');
  if (ok) for (const d of [...model.docs]) model.markReviewed(d);
}

async function revealComment(c: ReviewComment) {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(c.path));
  const r = new vscode.Range(c.line, c.startChar, c.endLine, c.endChar);
  editor.selection = new vscode.Selection(r.start, r.end);
  editor.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function clearComments() {
  const n = model.comments.length;
  if (!n) return;
  const ok = await vscode.window.showWarningMessage(`Delete all ${n} pending comments?`, { modal: true }, 'Delete');
  if (ok) model.saveComments([]);
}

