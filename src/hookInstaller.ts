// Adds or removes our entry in Claude Code's settings.json. Pure functions over
// the parsed JSON, so the result can be diffed and tested before it's written.

/** After an edit tool or a shell command: record what changed. */
export const HOOK_MATCHER = 'Edit|Write|MultiEdit|Bash';
/** Before a shell command: save the markdown files it names. */
export const PRE_MATCHER = 'Bash';
const MARKER = 'penmark.js';
/** The hook script's name before the extension was renamed (pre-release builds only). */
const LEGACY_MARKER = 'markdown-redline.js';

interface HookCommand { type: string; command?: string; timeout?: number }
interface HookGroup { matcher?: string; hooks?: HookCommand[] }
type Settings = Record<string, any>;

const isOurs = (h: HookCommand) => typeof h.command === 'string' && (h.command.includes(MARKER) || h.command.includes(LEGACY_MARKER));
const isCurrent = (h: HookCommand) => typeof h.command === 'string' && h.command.includes(MARKER);

/** Shell command Claude Code runs: absolute node path, as the user's other hooks do. */
export function hookCommand(nodePath: string, scriptPath: string): string {
  const q = (s: string) => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return `${q(nodePath)} ${q(scriptPath)}`;
}

/** Settings with our entries in place. Other hooks are left exactly as they were. */
export function withHook(settings: Settings, command: string): Settings {
  const next = structuredClone(withoutHook(settings));
  next.hooks ??= {};
  next.hooks.PreToolUse ??= [];
  next.hooks.PreToolUse.push({ matcher: PRE_MATCHER, hooks: [{ type: 'command', command, timeout: 5 }] });
  next.hooks.PostToolUse ??= [];
  next.hooks.PostToolUse.push({ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command, timeout: 5 }] });
  return next;
}

/** Installed, and in the current shape (an older version only had the PostToolUse entry). */
export function hookIsCurrent(settings: Settings): boolean {
  const has = (event: string, matcher: string) =>
    Array.isArray(settings.hooks?.[event]) &&
    settings.hooks[event].some((g: HookGroup) => g.matcher === matcher && Array.isArray(g.hooks) && g.hooks.some(isCurrent));
  return has('PreToolUse', PRE_MATCHER) && has('PostToolUse', HOOK_MATCHER);
}

/** Settings without our entry. Groups and events are dropped only if removing our entry emptied them. */
export function withoutHook(settings: Settings): Settings {
  const next = structuredClone(settings);
  const events: Record<string, HookGroup[]> | undefined = next.hooks;
  if (!events || typeof events !== 'object') return next;
  let removed = false;
  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) continue;
    const kept: HookGroup[] = [];
    for (const g of groups) {
      if (!Array.isArray(g.hooks) || !g.hooks.some(isOurs)) {
        kept.push(g);
        continue;
      }
      removed = true;
      const rest = g.hooks.filter(h => !isOurs(h));
      if (rest.length) kept.push({ ...g, hooks: rest });
    }
    if (kept.length === groups.length && !groups.some(g => g.hooks?.some(isOurs))) continue;
    if (kept.length) events[event] = kept;
    else delete events[event];
  }
  if (removed && !Object.keys(events).length) delete next.hooks;
  return next;
}

export function hasHook(settings: Settings): boolean {
  const events = settings.hooks;
  if (!events || typeof events !== 'object') return false;
  return Object.values(events).some(
    groups => Array.isArray(groups) && groups.some((g: HookGroup) => Array.isArray(g.hooks) && g.hooks.some(isOurs)),
  );
}

/** Same layout Claude Code writes: 2-space JSON and a trailing newline. */
export const formatSettings = (s: Settings) => JSON.stringify(s, null, 2) + '\n';
