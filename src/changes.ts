// Works out what Claude changed in a doc since it was last reviewed, at
// sentence level, ignoring edits the user made. No vscode import.
//
// baseline  = text before Claude's first unreviewed edit
// pairs     = before/after text of every unreviewed Claude edit
// current   = the doc as it is now (may include the user's own edits)
//
// The sentence diff baseline → current shows every change. A change is kept
// only if Claude made it: an added sentence must have been added by one of
// Claude's edits, a removed one removed by one of them. Anything else is the
// user's own edit and is not highlighted.
import { diffArrays, diffWords } from 'diff';

export interface Token {
  /** Raw source text of the sentence (or of a whole fenced block). */
  text: string;
  start: number;
  end: number;
  /** 0-based line of start and end. */
  line: number;
  endLine: number;
  fence: boolean;
  /** Whitespace-collapsed text used for comparing. */
  norm: string;
}

export type ChangeKind = 'added' | 'modified' | 'removed';

export interface Change {
  kind: ChangeKind;
  /** Offsets in the current text. A removal is a point: start === end. */
  start: number;
  end: number;
  line: number;
  endLine: number;
  /** The current sentence (added/modified); empty for removals. */
  text: string;
  /** Removed text, or the previous version of a modified sentence. */
  oldText?: string;
  /** How many source lines the removed text spanned. */
  oldLines?: number;
  /** Removed only: whole lines went, so show it as its own block rather than inline. */
  block?: boolean;
  /** Modified only: changed word ranges, as offsets in the current text. */
  words?: Array<[number, number]>;
  fence?: boolean;
}

export interface EditPair { before: string; after: string }

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
// List, heading and quote markers are structure, not sentence text.
const LINE_PREFIX = /^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s?)*/;
// A sentence ends at . ! or ? (plus closing quotes, brackets or emphasis) followed by whitespace.
const SENTENCE_END = /[.!?]+["')\]*_`]*(?=\s)/g;

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      // A fenced block (code, Mermaid) is one token: it changes as a whole.
      const marker = fence[1];
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[j])) j++;
      const last = Math.min(j, lines.length - 1);
      let end = lineStart;
      for (let k = i; k <= last; k++) end += lines[k].length + (k < lines.length - 1 ? 1 : 0);
      const text = src.slice(lineStart, end).replace(/\n$/, '');
      tokens.push({ text, start: lineStart, end: lineStart + text.length, line: i, endLine: last, fence: true, norm: normalize(text) });
      offset = end;
      i = last;
      continue;
    }
    offset += line.length + 1;
    const prefix = LINE_PREFIX.exec(line)![0];
    const body = line.slice(prefix.length);
    if (!body.trim()) continue;
    let from = 0;
    const push = (to: number) => {
      const raw = body.slice(from, to);
      const lead = raw.length - raw.trimStart().length;
      const text = raw.trim();
      if (text) {
        const start = lineStart + prefix.length + from + lead;
        tokens.push({ text, start, end: start + text.length, line: i, endLine: i, fence: false, norm: normalize(text) });
      }
      from = to;
    };
    SENTENCE_END.lastIndex = 0;
    for (let m; (m = SENTENCE_END.exec(body)); ) push(m.index + m[0].length);
    push(body.length);
  }
  return tokens;
}

/** Sentences each side of a diff of two texts. */
function sentenceDiff(a: Token[], b: Token[]) {
  return diffArrays(a.map(t => t.norm), b.map(t => t.norm));
}

/** Multiset of sentences Claude added and removed across its edits. */
function claudeChanges(pairs: EditPair[]) {
  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const p of pairs) {
    for (const part of sentenceDiff(tokenize(p.before), tokenize(p.after))) {
      if (part.added) part.value.forEach(v => bump(added, v));
      else if (part.removed) part.value.forEach(v => bump(removed, v));
    }
  }
  return { added, removed };
}

function take(m: Map<string, number>, k: string): boolean {
  const n = m.get(k) ?? 0;
  if (!n) return false;
  m.set(k, n - 1);
  return true;
}

/** Share of words in common: decides whether a removed+added pair is one rewritten sentence. */
function similarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = b.toLowerCase().split(/\W+/).filter(Boolean);
  if (!wa.size || !wb.length) return 0;
  const common = wb.filter(w => wa.has(w)).length;
  return common / Math.max(wa.size, wb.length);
}

function changedWords(oldText: string, cur: Token): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let at = 0;
  for (const part of diffWords(oldText, cur.text)) {
    if (part.removed) continue;
    if (part.added && part.value.trim()) {
      const lead = part.value.length - part.value.trimStart().length;
      ranges.push([cur.start + at + lead, cur.start + at + part.value.trimEnd().length]);
    }
    at += part.value.length;
  }
  return ranges;
}

export function computeChanges(baseline: string, current: string, pairs: EditPair[]): Change[] {
  const base = tokenize(baseline);
  const cur = tokenize(current);
  const claude = claudeChanges(pairs);
  const changes: Change[] = [];
  let bi = 0;
  let ci = 0;

  const anchor = () => {
    // A removal is shown right after the sentence before it, or before the next one.
    const prev = cur[ci - 1];
    const next = cur[ci];
    if (prev) return { at: prev.end, line: prev.endLine };
    if (next) return { at: next.start, line: next.line };
    return { at: 0, line: 0 };
  };
  const pushRemoved = (toks: Token[]) => {
    if (!toks.length) return;
    const a = anchor();
    const oldLines = new Set(toks.flatMap(t => Array.from({ length: t.endLine - t.line + 1 }, (_, k) => t.line + k))).size;
    const first = base.indexOf(toks[0]);
    const last = base.indexOf(toks[toks.length - 1]);
    const block = base[first - 1]?.endLine !== toks[0].line && base[last + 1]?.line !== toks[toks.length - 1].endLine;
    changes.push({
      kind: 'removed', start: a.at, end: a.at, line: a.line, endLine: a.line, text: '',
      oldText: toks.map(t => t.text).join(toks.some(t => t.fence) ? '\n' : ' '), oldLines, block,
      fence: toks.some(t => t.fence) || undefined,
    });
  };

  const parts = sentenceDiff(base, cur);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const n = part.value.length;
    if (!part.added && !part.removed) {
      bi += n;
      ci += n;
      continue;
    }
    if (part.removed) {
      const removedToks = base.slice(bi, bi + n).filter(t => take(claude.removed, t.norm));
      bi += n;
      const next = parts[p + 1];
      if (next && next.added) {
        // Removed then added: pair them as rewritten sentences where they look alike.
        const addedToks = cur.slice(ci, ci + next.value.length).filter(t => take(claude.added, t.norm));
        const rewrites = new Map<Token, Token>();
        // Look ahead for the first unpaired removal that matches, keeping order.
        let r = 0;
        for (const t of addedToks) {
          const k = removedToks.findIndex((old, i) => i >= r && old.fence === t.fence && (t.fence || similarity(old.text, t.text) >= 0.4));
          if (k >= 0) {
            rewrites.set(t, removedToks[k]);
            r = k + 1;
          }
        }
        // Unpaired removals show before the new text that replaced them.
        pushRemoved(removedToks.filter(t => ![...rewrites.values()].includes(t)));
        for (const t of addedToks) {
          const old = rewrites.get(t);
          changes.push(old
            ? { kind: 'modified', start: t.start, end: t.end, line: t.line, endLine: t.endLine, text: t.text,
                oldText: old.text, words: t.fence ? undefined : changedWords(old.text, t), fence: t.fence || undefined }
            : { kind: 'added', start: t.start, end: t.end, line: t.line, endLine: t.endLine, text: t.text, fence: t.fence || undefined });
        }
        ci += next.value.length;
        p++;
      } else {
        pushRemoved(removedToks);
      }
      continue;
    }
    // Added with no removal before it.
    for (const t of cur.slice(ci, ci + n)) {
      if (take(claude.added, t.norm)) {
        changes.push({ kind: 'added', start: t.start, end: t.end, line: t.line, endLine: t.endLine, text: t.text, fence: t.fence || undefined });
      }
      ci++;
    }
  }
  return changes.sort((a, b) => a.start - b.start || (a.kind === 'removed' ? -1 : 1));
}

/** Number of places to review: adjacent changes on the same line count once. */
export function countChanges(changes: Change[]): number {
  let n = 0;
  let lastLine = -1;
  for (const c of changes) {
    if (n === 0 || c.line > lastLine) n++;
    lastLine = Math.max(lastLine, c.endLine);
  }
  return n;
}
