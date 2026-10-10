// Reads what the hook (hooks/penmark.js) writes. No vscode import.
//
// <store>/files/<key>/edits.jsonl          one line per Claude edit
// <store>/files/<key>/<id>.before.md       text before that edit
// <store>/files/<key>/<id>.after.md        text after that edit
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface Edit {
  id: string;
  at: string;
  path: string;
  tool: string;
  newFile: boolean;
  sessionId: string;
  promptId?: string;
  toolUseId?: string;
  transcriptPath?: string;
  /** Working folder of the Claude session. */
  cwd?: string;
}

export interface TrackedDoc {
  key: string;
  path: string;
  dir: string;
  /** Oldest first. Only edits whose before/after copies exist. */
  edits: Edit[];
}

/** Must match keyFor() in hooks/penmark.js. */
export function keyFor(absPath: string): string {
  return crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 16);
}

export function readDoc(storeDir: string, key: string): TrackedDoc | undefined {
  const dir = path.join(storeDir, 'files', key);
  let lines: string[];
  try {
    lines = fs.readFileSync(path.join(dir, 'edits.jsonl'), 'utf8').split('\n');
  } catch {
    return undefined;
  }
  const edits: Edit[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Edit;
      if (fs.existsSync(path.join(dir, `${e.id}.before.md`)) && fs.existsSync(path.join(dir, `${e.id}.after.md`))) edits.push(e);
    } catch {
      // A torn line from a crashed hook: skip it.
    }
  }
  if (!edits.length) return undefined;
  edits.sort((a, b) => a.at.localeCompare(b.at));
  return { key, path: edits[edits.length - 1].path, dir, edits };
}

/** Every doc with unreviewed Claude edits, most recently edited first. */
export function readStore(storeDir: string): TrackedDoc[] {
  let keys: string[];
  try {
    keys = fs.readdirSync(path.join(storeDir, 'files'));
  } catch {
    return [];
  }
  const docs = keys.map(k => readDoc(storeDir, k)).filter((d): d is TrackedDoc => !!d);
  return docs.sort((a, b) => b.edits[b.edits.length - 1].at.localeCompare(a.edits[a.edits.length - 1].at));
}

export function editText(doc: TrackedDoc, edit: Edit): { before: string; after: string } {
  return {
    before: fs.readFileSync(path.join(doc.dir, `${edit.id}.before.md`), 'utf8'),
    after: fs.readFileSync(path.join(doc.dir, `${edit.id}.after.md`), 'utf8'),
  };
}

/** Forget a doc's edits. Renames first so a hook writing at the same moment starts a fresh folder. */
export function markReviewed(storeDir: string, key: string): void {
  const dir = path.join(storeDir, 'files', key);
  const trash = path.join(storeDir, `.reviewed-${key}-${Date.now()}`);
  try {
    fs.renameSync(dir, trash);
  } catch {
    return;
  }
  fs.rmSync(trash, { recursive: true, force: true });
}

/** Move the whole store when the storageDir setting changes. */
export function moveStore(from: string, to: string): void {
  if (path.resolve(from) === path.resolve(to) || !fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
}
