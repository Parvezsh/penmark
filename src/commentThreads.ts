// Review comments in the source editor, using VS Code's comment threads, and
// the commands that add them (from the editor or from the preview).
import * as vscode from 'vscode';
import { ReviewComment, newComment } from './comments';
import { Model, canonical } from './model';

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export class CommentThreads implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('penmark', 'Review comments for Claude');
  private readonly threads = new Map<string, vscode.CommentThread>();
  private readonly disposables: vscode.Disposable[] = [this.controller];

  constructor(private readonly model: Model) {
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: doc =>
        doc.languageId === 'markdown' && doc.uri.scheme === 'file' ? [new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)] : [],
    };
    this.controller.options = { prompt: 'Comment for Claude', placeHolder: 'What should Claude change here? (⌘Enter to save)' };
    this.disposables.push(model.onDidChange(() => this.sync()));
    this.sync();
  }

  /** One read-only thread per pending comment. */
  private sync() {
    const live = new Set(this.model.comments.map(c => c.id));
    for (const [id, t] of this.threads) {
      if (!live.has(id)) {
        t.dispose();
        this.threads.delete(id);
      }
    }
    for (const c of this.model.comments) {
      if (this.threads.has(c.id)) continue;
      try {
        this.threads.set(c.id, this.createThread(c));
      } catch {
        // A comment on lines that no longer exist: it still shows in the panel and is still sent.
      }
    }
  }

  private createThread(c: ReviewComment): vscode.CommentThread {
    const t = this.controller.createCommentThread(vscode.Uri.file(c.path), new vscode.Range(c.line, c.startChar, c.endLine, c.endChar), [
      {
        body: new vscode.MarkdownString(c.body),
        mode: vscode.CommentMode.Preview,
        author: { name: 'You' },
        contextValue: 'penmarkComment',
      },
    ]);
    t.label = `For Claude · “${clip(c.quote, 50)}”`;
    t.canReply = false;
    t.contextValue = 'penmarkThread';
    t.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    return t;
  }

  idOf(thread: vscode.CommentThread): string | undefined {
    for (const [id, t] of this.threads) if (t === thread) return id;
    return undefined;
  }

  add(c: Omit<ReviewComment, 'id' | 'createdAt'>) {
    this.model.saveComments([...this.model.comments, newComment(c)]);
  }

  delete(id: string) {
    this.model.saveComments(this.model.comments.filter(c => c.id !== id));
  }

  /**
   * Select text → shortcut: VS Code's own comment box opens right under the
   * selection; ⌘Enter (Ctrl+Enter) saves it through saveFromReply.
   */
  async addFromEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') return;
    await vscode.commands.executeCommand('workbench.action.addComment');
  }

  /** Called through the vscode:// link the preview script opens. */
  async addFromPreview(source: vscode.Uri, line: number, endLine: number, text: string, typed?: string) {
    const doc = await vscode.workspace.openTextDocument(source);
    const range = findInLines(doc, text, line, endLine);
    // The preview's own comment box sends the text along; ask only if it didn't.
    const body = typed ?? await vscode.window.showInputBox({ prompt: `Comment on “${clip(text, 60)}”`, placeHolder: 'What should Claude change? Enter to save, Esc to cancel', ignoreFocusOut: true });
    if (!body?.trim()) return;
    void vscode.window.setStatusBarMessage('$(comment) Comment saved for Claude', 3000);
    this.add({ path: canonical(doc.uri.fsPath), line: range.start.line, startChar: range.start.character, endLine: range.end.line, endChar: range.end.character, quote: text, body: body.trim() });
  }

  /** The "+" in the editor margin opens VS Code's own comment box; this saves what's typed there. */
  saveFromReply(reply: vscode.CommentReply) {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === reply.thread.uri.toString());
    const r = reply.thread.range ?? new vscode.Range(0, 0, 0, 0);
    const range = r.isEmpty && doc ? doc.lineAt(r.start.line).range : r;
    const quote = doc ? doc.getText(range) : '';
    reply.thread.dispose();
    if (!reply.text.trim()) return;
    this.add({ path: canonical(reply.thread.uri.fsPath), line: range.start.line, startChar: range.start.character, endLine: range.end.line, endChar: range.end.character, quote, body: reply.text.trim() });
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }
}

/**
 * The preview gives rendered text (markup stripped) and block lines; find
 * the matching source range, or fall back to the whole lines.
 */
export function findInLines(doc: vscode.TextDocument, text: string, line: number, endLine: number): vscode.Range {
  const first = Math.max(0, Math.min(line, doc.lineCount - 1));
  const last = Math.max(first, Math.min(endLine + 3, doc.lineCount - 1));
  const block = new vscode.Range(first, 0, last, doc.lineAt(last).text.length);
  const src = doc.getText(block);
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length) {
    // Allow markup (**, _, links) and line breaks between the words.
    const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(escaped.join('[\\s*_`~\\[\\]()]*(?:\\([^)]*\\))?[\\s*_`~\\[\\]]*'));
    const m = re.exec(src);
    if (m) {
      const start = doc.offsetAt(block.start) + m.index;
      return new vscode.Range(doc.positionAt(start), doc.positionAt(start + m[0].length));
    }
  }
  const end = Math.max(first, Math.min(endLine, doc.lineCount - 1));
  return new vscode.Range(first, 0, end, doc.lineAt(end).text.length);
}
