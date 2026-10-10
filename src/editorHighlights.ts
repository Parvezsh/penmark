// Highlights Claude's changes in the markdown source editor, plus the status
// bar item and next/previous change navigation.
import * as vscode from 'vscode';
import { Model } from './model';
import { Change, countChanges } from './changes';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class EditorHighlights implements vscode.Disposable {
  private readonly added = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  private readonly word = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    fontWeight: '600',
  });
  private readonly removed = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly model: Model) {
    this.disposables.push(
      this.added, this.word, this.removed, this.status,
      model.onDidChange(() => this.updateAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateStatus()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.languageId !== 'markdown') return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.updateAll(), 250);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('penmark.showRemovals')) this.updateAll();
      }),
    );
    this.updateAll();
  }

  changesIn(doc: vscode.TextDocument): Change[] {
    if (doc.languageId !== 'markdown' || doc.uri.scheme !== 'file') return [];
    const tracked = this.model.docFor(doc.uri.fsPath);
    return tracked ? this.model.changesFor(tracked, doc.getText()) : [];
  }

  private updateAll() {
    for (const editor of vscode.window.visibleTextEditors) this.update(editor);
    this.updateStatus();
  }

  private update(editor: vscode.TextEditor) {
    const on = this.model.showHighlights;
    const changes = on ? this.changesIn(editor.document) : [];
    const showRemovals = vscode.workspace.getConfiguration('penmark').get('showRemovals', true);
    const doc = editor.document;
    const range = (s: number, e: number) => new vscode.Range(doc.positionAt(s), doc.positionAt(e));
    const added: vscode.DecorationOptions[] = [];
    const words: vscode.DecorationOptions[] = [];
    const removed: vscode.DecorationOptions[] = [];
    for (const c of changes) {
      if (c.kind === 'removed') {
        if (!showRemovals) continue;
        const label = (c.oldLines ?? 1) > 1 ? ` ⊖ ${c.oldLines} lines removed ` : ` ⊖ ${clip(c.oldText ?? '', 48)} `;
        removed.push({
          range: range(c.start, c.start),
          hoverMessage: new vscode.MarkdownString().appendMarkdown('**Removed by Claude**\n\n').appendCodeblock(c.oldText ?? '', 'markdown'),
          renderOptions: {
            after: {
              contentText: label,
              color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
              textDecoration: (c.oldLines ?? 1) > 1 ? 'none' : 'line-through',
              fontStyle: 'italic',
              margin: '0 0 0 4px',
            },
          },
        });
        continue;
      }
      const hover = c.kind === 'modified'
        ? new vscode.MarkdownString().appendMarkdown(c.fence ? '**Block changed by Claude.** Before:\n\n' : '**Changed by Claude.** Before:\n\n').appendCodeblock(c.oldText ?? '', 'markdown')
        : new vscode.MarkdownString(c.fence ? '**Block added by Claude**' : '**Added by Claude**');
      added.push({ range: range(c.start, c.end), hoverMessage: hover });
      for (const [s, e] of c.words ?? []) words.push({ range: range(s, e) });
    }
    editor.setDecorations(this.added, added);
    editor.setDecorations(this.word, words);
    editor.setDecorations(this.removed, removed);
  }

  private updateStatus() {
    const editor = vscode.window.activeTextEditor;
    const tracked = editor && editor.document.languageId === 'markdown' && this.model.docFor(editor.document.uri.fsPath);
    if (tracked) {
      const n = countChanges(this.model.changesFor(tracked, editor!.document.getText()));
      this.status.text = this.model.showHighlights ? `$(eye) ${n} change${n === 1 ? '' : 's'}` : `$(eye-closed) ${n} hidden`;
      this.status.tooltip = `Penmark: Claude's changes since you last reviewed this doc. Click to ${this.model.showHighlights ? 'hide' : 'show'} highlights.`;
      this.status.command = 'penmark.toggleHighlights';
      this.status.show();
    } else if (this.model.docs.length) {
      const n = this.model.docs.length;
      this.status.text = `$(diff) ${n} doc${n === 1 ? '' : 's'} to review`;
      this.status.tooltip = 'Penmark: docs Claude changed since you last reviewed them';
      this.status.command = 'penmark.review.focus';
      this.status.show();
    } else {
      this.status.hide();
    }
  }

  /** Move the cursor to the next (or previous) change in the active editor. */
  go(direction: 1 | -1) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const changes = this.changesIn(editor.document);
    if (!changes.length) {
      void vscode.window.setStatusBarMessage('No Claude changes in this doc', 2000);
      return;
    }
    const here = editor.document.offsetAt(editor.selection.active);
    const target = direction === 1
      ? changes.find(c => c.start > here) ?? changes[0]
      : [...changes].reverse().find(c => c.start < here) ?? changes[changes.length - 1];
    const doc = editor.document;
    const r = new vscode.Range(doc.positionAt(target.start), doc.positionAt(target.end));
    editor.selection = new vscode.Selection(r.start, r.start);
    editor.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposables.forEach(d => d.dispose());
  }
}
