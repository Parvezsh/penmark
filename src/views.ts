// The two side panels: "To review" (docs Claude changed) and "Pending comments".
import * as path from 'path';
import * as vscode from 'vscode';
import { ReviewComment } from './comments';
import { Model } from './model';
import { countChanges } from './changes';
import { sessionTitle } from './sessions';
import { TrackedDoc } from './store';

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export class ReviewTree implements vscode.TreeDataProvider<TrackedDoc> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly model: Model) {
    model.onDidChange(() => this.emitter.fire());
  }

  getChildren(): TrackedDoc[] {
    return this.model.docs;
  }

  getTreeItem(doc: TrackedDoc): vscode.TreeItem {
    const item = new vscode.TreeItem(path.basename(doc.path), vscode.TreeItemCollapsibleState.None);
    const text = this.model.currentText(doc.path);
    const n = text === undefined ? 0 : countChanges(this.model.changesFor(doc, text));
    const bySession = new Map(doc.edits.map(e => [e.sessionId, e.transcriptPath]));
    const sessions = [...bySession].map(([id, transcript]) => sessionTitle(transcript) ?? `session ${id.slice(0, 8)}`);
    const last = doc.edits[doc.edits.length - 1];
    item.description = `${n} change${n === 1 ? '' : 's'} · ${clip(sessions.join(', '), 40)}`;
    item.tooltip = new vscode.MarkdownString(
      `**${vscode.workspace.asRelativePath(doc.path)}**\n\n${doc.edits.length} Claude edit${doc.edits.length === 1 ? '' : 's'}, last ${new Date(last.at).toLocaleString()}\n\nSession: ${sessions.join(', ')}`,
    );
    item.resourceUri = vscode.Uri.file(doc.path);
    item.iconPath = new vscode.ThemeIcon('diff-modified');
    item.contextValue = 'trackedDoc';
    item.command = { command: 'penmark.openReview', title: 'Open preview', arguments: [doc] };
    return item;
  }
}

type CommentNode = { doc: string } | { comment: ReviewComment };

export class CommentsTree implements vscode.TreeDataProvider<CommentNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly model: Model) {
    model.onDidChange(() => this.emitter.fire());
  }

  getChildren(node?: CommentNode): CommentNode[] {
    if (!node) return [...new Set(this.model.comments.map(c => c.path))].map(doc => ({ doc }));
    if ('doc' in node) return this.model.comments.filter(c => c.path === node.doc).sort((a, b) => a.line - b.line).map(comment => ({ comment }));
    return [];
  }

  getTreeItem(node: CommentNode): vscode.TreeItem {
    if ('doc' in node) {
      const n = this.model.comments.filter(c => c.path === node.doc).length;
      const item = new vscode.TreeItem(path.basename(node.doc), vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${n} comment${n === 1 ? '' : 's'}`;
      item.resourceUri = vscode.Uri.file(node.doc);
      item.iconPath = vscode.ThemeIcon.File;
      return item;
    }
    const c = node.comment;
    const item = new vscode.TreeItem(clip(c.body, 60), vscode.TreeItemCollapsibleState.None);
    item.description = `line ${c.line + 1} · “${clip(c.quote, 40)}”`;
    item.tooltip = new vscode.MarkdownString().appendMarkdown(`**Line ${c.line + 1}**\n\n> ${clip(c.quote, 300)}\n\n`).appendText(c.body);
    item.iconPath = new vscode.ThemeIcon('comment');
    item.contextValue = 'reviewComment';
    item.command = { command: 'penmark.revealComment', title: 'Show comment', arguments: [c] };
    return item;
  }
}
