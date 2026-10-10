// Sends all pending comments to Claude Code: writes one notes file, picks the
// session, and puts a prompt in that session's chat box (never sends it).
//
// Claude Code (checked against 2.1.280, see docs/spike.md):
// - claude-vscode.editor.open(sessionId?, prompt) fills in the chat box, unless
//   that session is already open in a tab, where it refuses the prompt.
// - claude-vscode.insertAtMention adds an @-mention of the active editor's
//   file to every *visible* Claude tab.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ReviewComment, archiveComments, locate } from './comments';
import { Model } from './model';
import { formatNotes, notesFileName } from './notes';
import { DocSession, sessionTitle, tabMatchesTitle } from './sessions';

const CLAUDE = 'anthropic.claude-code';

type Target =
  | { kind: 'new' }
  | { kind: 'session'; session: DocSession; title?: string }
  /** No session is known for these docs: use the Claude tab that's already open. */
  | { kind: 'open-tab' };
type Outcome = 'prefilled' | 'mentioned' | 'clipboard' | 'no-claude';

const isClaudeTab = (t: vscode.Tab | undefined): t is vscode.Tab =>
  !!t && t.input instanceof vscode.TabInputWebview && t.input.viewType.includes('claudeVSCodePanel');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const claudeTabsOpen = () => vscode.window.tabGroups.all.some(g => g.tabs.some(isClaudeTab));
const FOCUS_GROUP = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'].map(n => `workbench.action.focus${n}EditorGroup`);

export async function sendComments(model: Model): Promise<void> {
  const comments = model.comments;
  if (!comments.length) {
    void vscode.window.showInformationMessage('No pending comments to send.');
    return;
  }
  const target = await chooseTarget(model, comments);
  if (!target) return;

  // Paths in the notes are relative to the folder Claude works in.
  const cwd = (target.kind === 'session' && target.session.cwd) || folderFor(comments[0].path);
  const now = new Date();
  const notesDir = cwd ? path.join(cwd, '.penmark') : path.join(model.storeDir, 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  // Ignore the folder in git without touching the repo's own .gitignore.
  if (cwd && !fs.existsSync(path.join(notesDir, '.gitignore'))) fs.writeFileSync(path.join(notesDir, '.gitignore'), '*\n');
  const notesPath = path.join(notesDir, notesFileName(now));
  const rel = (p: string) => (cwd && p.startsWith(cwd + path.sep) ? path.relative(cwd, p) : p);
  const where = (c: ReviewComment) => {
    const text = model.currentText(c.path);
    return text === undefined ? { line: c.line, endLine: c.endLine } : locate(c, text);
  };
  fs.writeFileSync(notesPath, formatNotes(comments, where, rel, now));

  const prompt = `Please address my review comments in ${rel(notesPath)}. Each comment quotes the text it is about.`;
  await vscode.env.clipboard.writeText(prompt);
  const outcome = await deliver(target, prompt, notesPath);

  archiveComments(model.storeDir, comments, notesPath);
  if (vscode.workspace.getConfiguration('penmark').get('markReviewedOnSend', true)) {
    for (const p of new Set(comments.map(c => c.path))) {
      const doc = model.docFor(p);
      if (doc) model.markReviewed(doc);
    }
  }
  model.refresh();

  const n = comments.length;
  const what = `${n} comment${n === 1 ? '' : 's'}`;
  const messages: Record<Outcome, string> = {
    prefilled: `${what} ready in Claude's chat box. Press Enter to send.`,
    mentioned: `${what} attached to Claude's chat box as @${path.basename(notesPath)}. Press Enter to send.`,
    clipboard: `Couldn't fill in that Claude tab automatically. The prompt is on your clipboard: paste with ⌘V in the Claude chat and press Enter.`,
    'no-claude': `Claude Code for VS Code isn't installed. The prompt is on your clipboard; paste it into Claude Code.`,
  };
  const pick = await vscode.window.showInformationMessage(messages[outcome], 'Open notes');
  if (pick) await vscode.window.showTextDocument(vscode.Uri.file(notesPath), { preview: true });
}

function folderFor(p: string): string | undefined {
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p))?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** The session that edited the docs; asks only when the batch spans several. */
async function chooseTarget(model: Model, comments: ReviewComment[]): Promise<Target | undefined> {
  const byId = new Map<string, { session: DocSession; docs: Set<string> }>();
  for (const p of new Set(comments.map(c => c.path))) {
    const s = model.docSessions[p];
    if (!s) continue;
    const entry = byId.get(s.sessionId) ?? { session: s, docs: new Set<string>() };
    if (s.at > entry.session.at) entry.session = s;
    entry.docs.add(path.basename(p));
    byId.set(s.sessionId, entry);
  }
  const sessions = [...byId.values()].sort((a, b) => b.session.at.localeCompare(a.session.at));
  if (!sessions.length) return claudeTabsOpen() ? { kind: 'open-tab' } : { kind: 'new' };
  if (sessions.length === 1) return { kind: 'session', session: sessions[0].session, title: sessionTitle(sessions[0].session.transcriptPath) };
  const items: Array<vscode.QuickPickItem & { target: Target }> = sessions.map(s => {
    const title = sessionTitle(s.session.transcriptPath);
    return {
      label: title ?? `Session ${s.session.sessionId.slice(0, 8)}`,
      description: `edited ${[...s.docs].join(', ')}`,
      detail: `last edit ${new Date(s.session.at).toLocaleString()}`,
      target: { kind: 'session', session: s.session, title },
    };
  });
  items.push({ label: '$(add) New Claude session', target: { kind: 'new' } });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'These comments cover docs from several Claude sessions. Send to which one?' });
  return pick?.target;
}

async function deliver(target: Target, prompt: string, notesPath: string): Promise<Outcome> {
  if (!vscode.extensions.getExtension(CLAUDE)) return 'no-claude';
  try {
    if (target.kind === 'new') {
      await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, prompt);
      return 'prefilled';
    }
    if (target.kind === 'open-tab') {
      // Empty or ongoing, whichever Claude tab is showing gets the notes.
      const visible = vscode.window.tabGroups.all.filter(g => isClaudeTab(g.activeTab));
      if (visible.length > 1) return 'clipboard';
      await mentionNotes(notesPath, visible[0]?.viewColumn);
      return 'mentioned';
    }
    const { session, title } = target;
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(isClaudeTab);
    const matching = tabs.filter(t => tabMatchesTitle(t.label, title));
    if (!title || matching.length === 0) {
      // Not open in a tab (as far as we can tell): Claude Code opens it with the prompt filled in.
      await vscode.commands.executeCommand('claude-vscode.editor.open', session.sessionId, prompt);
      return 'prefilled';
    }
    if (matching.length > 1) return revealOnly(session);

    // Open in a tab: bring it to the front, then @-mention the notes file,
    // but only if no other Claude tab is visible (it would get the mention too).
    await vscode.commands.executeCommand('claude-vscode.editor.open', session.sessionId);
    let group: vscode.TabGroup | undefined;
    for (let i = 0; i < 20 && !group; i++) {
      group = vscode.window.tabGroups.all.find(g => isClaudeTab(g.activeTab) && tabMatchesTitle(g.activeTab.label, title));
      if (!group) await sleep(150);
    }
    const visibleClaude = vscode.window.tabGroups.all.filter(g => isClaudeTab(g.activeTab)).length;
    if (!group || visibleClaude !== 1) return 'clipboard';
    await mentionNotes(notesPath, group.viewColumn);
    return 'mentioned';
  } catch {
    return 'clipboard';
  }
}

/**
 * insertAtMention mentions the active editor's file in the visible Claude tab
 * (or, if none is visible, the most recent one). So: show the notes file in
 * another column, mention it, close it again, and put the cursor in Claude's
 * chat box.
 */
async function mentionNotes(notesPath: string, claudeColumn: vscode.ViewColumn | undefined) {
  const notesColumn = claudeColumn === undefined ? vscode.ViewColumn.Active : claudeColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
  // Opened as plain text: an open markdown preview follows the active markdown
  // editor and would switch to the notes. And not as a preview-mode tab, which
  // would replace whatever preview-mode tab is showing in that column.
  const notes = await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(notesPath), 'plaintext');
  await vscode.window.showTextDocument(notes, { viewColumn: notesColumn, preview: false });
  try {
    await vscode.commands.executeCommand('claude-vscode.insertAtMention');
  } finally {
    // Closing it brings back the tab that was showing in that column.
    const notesTab = vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .find(t => t.input instanceof vscode.TabInputText && t.input.uri.fsPath === notesPath);
    if (notesTab) await vscode.window.tabGroups.close(notesTab);
  }
  if (claudeColumn !== undefined && claudeColumn <= FOCUS_GROUP.length) {
    // With the Claude tab's group focused there's no active text editor, so
    // claude-vscode.focus only moves the cursor into the chat box.
    await vscode.commands.executeCommand(FOCUS_GROUP[claudeColumn - 1]);
    await vscode.commands.executeCommand('claude-vscode.focus');
  }
}

async function revealOnly(session: DocSession): Promise<Outcome> {
  await vscode.commands.executeCommand('claude-vscode.editor.open', session.sessionId);
  return 'clipboard';
}
