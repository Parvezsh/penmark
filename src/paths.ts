// Where things live on disk. No vscode import, so tests can use it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** ~/.claude, or PENMARK_CLAUDE_DIR (used by tests; the hook honours it too). */
export function claudeDir(): string {
  return process.env.PENMARK_CLAUDE_DIR || path.join(os.homedir(), '.claude');
}

export const pointerFile = () => path.join(claudeDir(), 'penmark.json');
export const defaultStoreDir = () => path.join(claudeDir(), 'penmark');
export const installedHookPath = () => path.join(claudeDir(), 'hooks', 'penmark.js');
export const claudeSettingsPath = () => path.join(claudeDir(), 'settings.json');

/** The storageDir setting as an absolute path; empty means the default. */
export function resolveStoreDir(setting: string | undefined): string {
  const s = (setting || '').trim();
  if (!s) return defaultStoreDir();
  if (s === '~' || s.startsWith('~/')) return path.join(os.homedir(), s.slice(1));
  return path.resolve(s);
}

export function readPointer(): string | undefined {
  try {
    const p = JSON.parse(fs.readFileSync(pointerFile(), 'utf8'));
    return typeof p.storageDir === 'string' ? p.storageDir : undefined;
  } catch {
    return undefined;
  }
}

/** Tell the hook where to store copies. Returns true if the file changed. */
export function writePointer(storeDir: string): boolean {
  if (readPointer() === storeDir) return false;
  fs.mkdirSync(path.dirname(pointerFile()), { recursive: true });
  fs.writeFileSync(pointerFile(), JSON.stringify({ storageDir: storeDir }, null, 2) + '\n');
  return true;
}
