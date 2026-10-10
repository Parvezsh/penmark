// Pending review comments, kept in <store>/comments.json until sent. No vscode import.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface ReviewComment {
  id: string;
  /** Absolute path of the doc. */
  path: string;
  /** 0-based source lines and characters the comment is anchored to. */
  line: number;
  startChar: number;
  endLine: number;
  endChar: number;
  /** The text the comment is about, as selected. */
  quote: string;
  body: string;
  createdAt: string;
}

const file = (storeDir: string) => path.join(storeDir, 'comments.json');

export function loadComments(storeDir: string): ReviewComment[] {
  try {
    const list = JSON.parse(fs.readFileSync(file(storeDir), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveComments(storeDir: string, list: ReviewComment[]): void {
  fs.mkdirSync(storeDir, { recursive: true });
  const tmp = `${file(storeDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  fs.renameSync(tmp, file(storeDir));
}

export function newComment(fields: Omit<ReviewComment, 'id' | 'createdAt'>): ReviewComment {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...fields };
}

/** Move sent comments to <store>/sent/<time>.json and clear the pending list. */
export function archiveComments(storeDir: string, sent: ReviewComment[], notesPath: string): void {
  const dir = path.join(storeDir, 'sent');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ notesPath, comments: sent }, null, 2) + '\n');
  const sentIds = new Set(sent.map(c => c.id));
  saveComments(storeDir, loadComments(storeDir).filter(c => !sentIds.has(c.id)));
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Where the quoted text is now, since the doc may have changed after the
 * comment was made. Searches outward from the original line; falls back to it.
 */
export function locate(c: ReviewComment, text: string): { line: number; endLine: number } {
  const lines = text.split('\n');
  const quote = squash(c.quote);
  if (!quote) return { line: c.line, endLine: c.endLine };
  const span = Math.max(0, c.endLine - c.line);
  const fits = (i: number) => squash(lines.slice(i, i + span + 1).join(' ')).includes(quote);
  for (let d = 0; d < lines.length; d++) {
    for (const i of d ? [c.line - d, c.line + d] : [c.line]) {
      if (i >= 0 && i < lines.length && fits(i)) return { line: i, endLine: Math.min(i + span, lines.length - 1) };
    }
  }
  return { line: c.line, endLine: c.endLine };
}
