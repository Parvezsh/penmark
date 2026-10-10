// markdown-it plugin for VS Code's built-in preview. It tags each rendered
// block with what Claude changed in it (data-penmark) and inserts removed
// blocks; media/preview.js then highlights the exact sentences in the page.
import { Model } from './model';
import { Change } from './changes';

/* eslint-disable @typescript-eslint/no-explicit-any -- markdown-it ships no types here */
type MarkdownIt = any;
type Token = any;

/** What one block needs to know; short keys keep the attribute small. */
interface BlockData {
  a?: string[]; // added sentences (rendered text)
  m?: Array<{ t: string; w: string[]; o: string }>; // modified: text, changed words, old text
  r?: Array<{ p: string | null; o: string }>; // removed inline: text before it, removed text
  c?: Array<{ q: string; id: string }>; // review comments: quoted text
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function penmarkPlugin(md: MarkdownIt, model: Model, extensionId: string): MarkdownIt {
  // Sentence source → the text the reader sees, so the page script can find it.
  const plain = (src: string) => decode(md.renderInline(src)).replace(/\s+/g, ' ').trim();

  md.core.ruler.push('penmark', (state: any) => {
    if (state.inlineMode) return;
    const tokens: Token[] = state.tokens;
    // Always tell the page script our extension id, for comment links.
    const meta = new state.Token('html_block', '', 0);
    meta.content = `<div id="penmark-meta" data-ext="${escapeHtml(extensionId)}" data-on="${model.showHighlights ? 1 : 0}" hidden></div>\n`;
    tokens.unshift(meta);

    const docPath = model.pathForText(state.src);
    if (!docPath) return;
    const tracked = model.docFor(docPath);
    const changes = model.showHighlights && tracked ? model.changesFor(tracked, state.src) : [];
    const comments = model.commentsFor(docPath);
    if (!changes.length && !comments.length) return;
    const showRemovals = model.showRemovals;

    const blocks = tokens
      .map((t, i) => ({ t, i }))
      // Tight lists hide their paragraph tags, so attributes there would be lost.
      .filter(({ t }) => t.map && !t.hidden && (t.nesting === 1 || t.type === 'fence' || t.type === 'code_block' || t.type === 'html_block'));
    /** Innermost block whose source lines contain `line`. */
    const blockAt = (line: number) => {
      let best: { t: Token; i: number } | undefined;
      for (const b of blocks) {
        if (b.t.map[0] <= line && line < b.t.map[1] && (!best || b.t.map[1] - b.t.map[0] <= best.t.map[1] - best.t.map[0])) best = b;
      }
      return best;
    };
    const data = new Map<Token, BlockData>();
    const at = (line: number) => {
      const b = blockAt(line);
      if (!b) return undefined;
      if (!data.has(b.t)) data.set(b.t, {});
      return data.get(b.t)!;
    };
    // html_block tokens to insert before the token at a given index.
    const inserts: Array<{ before: number; html: string }> = [];
    const nextBlockIndex = (line: number) => blocks.find(b => b.t.map[0] > line)?.i ?? tokens.length;

    const prevSentence = (c: Change) => {
      const before = state.src.slice(0, c.start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const onLine = before.slice(lineStart).replace(/^\s*(?:(?:[-*+]|\d+[.)])\s+|#{1,6}\s+|>\s?)*/, '');
      const sentences = onLine.split(/(?<=[.!?]["')\]*_`]*)\s+/).filter((s: string) => s.trim());
      return sentences.length ? plain(sentences[sentences.length - 1]) : null;
    };

    for (const c of changes) {
      if (c.fence) {
        const b = blockAt(c.line);
        const label = c.kind === 'removed' ? 'Diagram or code block removed' : c.kind === 'added' ? 'Diagram or code block added' : 'Diagram or code block changed';
        const html = `<div class="penmark-fence penmark-fence-${c.kind}" data-penmark-nav="1" title="${escapeHtml(c.oldText ?? '')}">${label}</div>\n`;
        inserts.push({ before: c.kind === 'removed' ? nextBlockIndex(c.line) : b ? b.i : nextBlockIndex(c.line), html });
        continue;
      }
      if (c.kind === 'removed') {
        if (!showRemovals) continue;
        if (c.block || !blockAt(c.line)) {
          const n = c.oldLines ?? 1;
          const body = `<del>${escapeHtml(c.oldText ?? '')}</del>`;
          const html = n > 3
            ? `<details class="penmark-removed-block" data-penmark-nav="1"><summary>${n} lines removed by Claude</summary>${body}</details>\n`
            : `<div class="penmark-removed-block" data-penmark-nav="1">${body}</div>\n`;
          inserts.push({ before: nextBlockIndex(c.line), html });
        } else {
          const d = at(c.line)!;
          (d.r ??= []).push({ p: prevSentence(c), o: c.oldText ?? '' });
        }
        continue;
      }
      const d = at(c.line);
      if (!d) continue;
      if (c.kind === 'added') (d.a ??= []).push(plain(c.text));
      else {
        const words = (c.words ?? []).map(([s, e]) => plain(state.src.slice(s, e))).filter(Boolean);
        (d.m ??= []).push({ t: plain(c.text), w: words, o: c.oldText ?? '' });
      }
    }
    for (const cm of comments) {
      const d = at(cm.line);
      if (d) (d.c ??= []).push({ q: plain(cm.quote), id: cm.id });
    }
    for (const [t, d] of data) t.attrSet('data-penmark', JSON.stringify(d));
    // Insert from the end so earlier indexes stay valid; at the same spot, keep the order they were added.
    const ordered = inserts.map((ins, n) => ({ ...ins, n })).sort((x, y) => y.before - x.before || y.n - x.n);
    for (const ins of ordered) {
      const tok = new state.Token('html_block', '', 0);
      tok.content = ins.html;
      tokens.splice(ins.before, 0, tok);
    }
  });
  return md;
}
