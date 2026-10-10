// In-memory view of the store, shared by the editor highlights, the preview
// plugin and the side panels. Refreshes when the hook writes to the store.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ReviewComment, loadComments, saveComments } from './comments';
import { claudeDir, resolveStoreDir, writePointer } from './paths';
import { Change, EditPair, computeChanges } from './changes';
import { DocSession, rememberSessions } from './sessions';
import { TrackedDoc, editText, markReviewed, readStore } from './store';

const canonicalCache = new Map<string, string>();
/** Same canonical form the hook stores (resolves symlinks and letter case on macOS). */
export function canonical(p: string): string {
  const cached = canonicalCache.get(p);
  if (cached) return cached;
  try {
    const c = fs.realpathSync.native(p);
    canonicalCache.set(p, c);
    return c;
  } catch {
    return path.resolve(p); // not on disk (yet): don't cache
  }
}

/** Builds from before the rename kept their data in ~/.claude/markdown-redline: move it over once. */
function adoptPreReleaseStore(storeDir: string) {
  const old = path.join(claudeDir(), 'markdown-redline');
  if (fs.existsSync(old) && !fs.existsSync(storeDir)) {
    try {
      fs.renameSync(old, storeDir);
      fs.rmSync(path.join(claudeDir(), 'markdown-redline.json'), { force: true });
    } catch {
      // Leave it; a fresh store works too.
    }
  }
}

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

export class Model implements vscode.Disposable {
  docs: TrackedDoc[] = [];
  comments: ReviewComment[] = [];
  docSessions: Record<string, DocSession> = {};
  storeDir = '';

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private pairs = new Map<string, { n: number; pairs: EditPair[] }>();
  private changeCache = new Map<string, Change[]>();
  private watcher?: fs.FSWatcher;
  private timer?: NodeJS.Timeout;
  /** What the views show; refresh() only fires when it changes. */
  private signature = '';

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.useStoreDir();
  }

  /** (Re)read the storage folder setting and watch it. */
  useStoreDir() {
    const setting = vscode.workspace.getConfiguration('penmark').get<string>('storageDir');
    this.storeDir = resolveStoreDir(setting);
    this.watcher?.close();
    this.watcher = undefined;
    // Without Claude Code (no ~/.claude) there's nothing to track yet: don't create anything.
    if (fs.existsSync(claudeDir()) || setting?.trim()) {
      if (!setting?.trim()) adoptPreReleaseStore(this.storeDir);
      writePointer(this.storeDir);
      fs.mkdirSync(this.storeDir, { recursive: true });
      try {
        this.watcher = fs.watch(this.storeDir, { recursive: true }, (_event, file) => {
          // The hook's per-command snapshots and the archive don't change what's shown.
          const f = String(file ?? '');
          if (/^(pending|sent)([/\\]|$)|^\.reviewed-|hook-errors\.log$/.test(f)) return;
          this.refreshSoon();
        });
      } catch {
        this.watcher = undefined;
      }
    }
    this.refresh(true);
  }

  refreshSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 200);
  }

  refresh(force = false) {
    this.docs = readStore(this.storeDir);
    this.comments = loadComments(this.storeDir);
    try {
      this.docSessions = rememberSessions(this.storeDir, this.docs);
    } catch {
      // Read-only store: keep what we had.
    }
    // Re-rendering previews and panels for nothing is visible (and can wipe a
    // half-typed comment box), so only tell listeners when something changed.
    const signature = JSON.stringify([this.docs.map(d => [d.key, d.edits.length]), this.comments.map(c => c.id)]);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.changeCache.clear();
    this.changed.fire();
  }

  get showHighlights(): boolean {
    return this.ctx.globalState.get('showHighlights', true);
  }

  async setShowHighlights(on: boolean) {
    await this.ctx.globalState.update('showHighlights', on);
    await vscode.commands.executeCommand('setContext', 'penmark.highlightsOn', on);
    this.changed.fire();
  }

  get showRemovals(): boolean {
    return vscode.workspace.getConfiguration('penmark').get('showRemovals', true);
  }

  docFor(p: string): TrackedDoc | undefined {
    const c = canonical(p);
    return this.docs.find(d => d.path === c);
  }

  /** The doc's text now: the open editor buffer if there is one (it may be unsaved), else the file. */
  currentText(p: string): string | undefined {
    const c = canonical(p);
    const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && canonical(d.uri.fsPath) === c);
    if (open) return open.getText();
    try {
      return fs.readFileSync(c, 'utf8');
    } catch {
      return undefined;
    }
  }

  /** What Claude changed in this doc since it was last reviewed, against the given text. */
  changesFor(doc: TrackedDoc, text: string): Change[] {
    const key = `${doc.key}:${doc.edits.length}:${hash(text)}`;
    let result = this.changeCache.get(key);
    if (!result) {
      let cached = this.pairs.get(doc.key);
      if (!cached || cached.n !== doc.edits.length) {
        cached = { n: doc.edits.length, pairs: doc.edits.map(e => editText(doc, e)) };
        this.pairs.set(doc.key, cached);
      }
      result = computeChanges(cached.pairs[0].before, text, cached.pairs);
      this.changeCache.set(key, result);
    }
    return result;
  }

  /** The preview only gives us the markdown text; find which doc it is. */
  pathForText(src: string): string | undefined {
    const candidates = new Set([...this.docs.map(d => d.path), ...this.comments.map(c => c.path)]);
    for (const p of vscode.workspace.textDocuments) if (p.languageId === 'markdown' && p.uri.scheme === 'file') candidates.add(canonical(p.uri.fsPath));
    for (const p of candidates) if (this.currentText(p) === src) return p;
    return undefined;
  }

  commentsFor(p: string): ReviewComment[] {
    const c = canonical(p);
    return this.comments.filter(x => x.path === c);
  }

  saveComments(list: ReviewComment[]) {
    saveComments(this.storeDir, list);
    this.refresh();
  }

  markReviewed(doc: TrackedDoc) {
    markReviewed(this.storeDir, doc.key);
    this.pairs.delete(doc.key);
    this.refresh();
  }

  dispose() {
    this.watcher?.close();
    clearTimeout(this.timer);
    this.changed.dispose();
  }
}
