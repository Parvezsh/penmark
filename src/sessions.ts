// Claude Code session details read from its transcript. No vscode import.
import * as fs from 'fs';
import * as path from 'path';
import { TrackedDoc } from './store';

export interface DocSession { sessionId: string; transcriptPath?: string; cwd?: string; at: string }

/**
 * Which session last edited each doc. Kept in <store>/doc-sessions.json because
 * marking a doc reviewed deletes its edits, but comments sent later should
 * still go back to the session that wrote it.
 */
export function rememberSessions(storeDir: string, docs: TrackedDoc[]): Record<string, DocSession> {
  const file = path.join(storeDir, 'doc-sessions.json');
  let map: Record<string, DocSession> = {};
  try {
    map = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // First run.
  }
  let changed = false;
  for (const d of docs) {
    const last = d.edits[d.edits.length - 1];
    if (!map[d.path] || map[d.path].at < last.at) {
      map[d.path] = { sessionId: last.sessionId, transcriptPath: last.transcriptPath, cwd: last.cwd, at: last.at };
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
  }
  return map;
}

/** Claude Code shows the session title on its tab, cut short with "…". */
export function tabMatchesTitle(label: string, title: string | undefined): boolean {
  if (!title) return false;
  const shown = label.replace(/…$/, '').trim();
  return shown.length > 0 && (label.endsWith('…') ? title.startsWith(shown) : title === shown);
}

const titles = new Map<string, { mtimeMs: number; title: string | undefined }>();
const TAIL = 512 * 1024;

/**
 * The session's title as Claude Code shows it on the tab: a title you set
 * yourself wins over the generated `aiTitle`. Undefined if the transcript is gone.
 */
export function sessionTitle(transcriptPath: string | undefined): string | undefined {
  if (!transcriptPath) return undefined;
  let mtimeMs: number;
  let size: number;
  try {
    ({ mtimeMs, size } = fs.statSync(transcriptPath));
  } catch {
    return undefined;
  }
  const cached = titles.get(transcriptPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.title;
  // Transcripts can be tens of MB, and the latest title record is near the end.
  let title = size > TAIL ? titleIn(readTail(transcriptPath, size)) : undefined;
  if (title === undefined) title = titleIn(fs.readFileSync(transcriptPath, 'utf8'));
  titles.set(transcriptPath, { mtimeMs, title });
  return title;
}

function readTail(file: string, size: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(TAIL);
    fs.readSync(fd, buf, 0, TAIL, size - TAIL);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function titleIn(text: string): string | undefined {
  let ai: string | undefined;
  let custom: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue;
    try {
      const o = JSON.parse(line);
      if (o.type === 'ai-title' && typeof o.aiTitle === 'string') ai = o.aiTitle;
      // Field name for a user-set title is a best guess; aiTitle is what the spike saw.
      if (o.type === 'custom-title' && typeof (o.customTitle ?? o.title) === 'string') custom = o.customTitle ?? o.title;
    } catch {
      // Ignore lines that aren't complete JSON.
    }
  }
  return custom ?? ai;
}
