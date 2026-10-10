// Penmark: runs inside VS Code's built-in markdown preview.
//
// The markdown-it plugin (src/previewPlugin.ts) tags blocks with data-penmark:
// which sentences Claude added or changed, what it removed, and which text has
// review comments. This script finds that text in the page and highlights it
// with the CSS Custom Highlight API, so the page's own markup is untouched.
//
// Keys (Alt is the Option key, ⌥, on a Mac):
//   Alt+]  / Alt+[   next / previous change
//   Alt+C            comment on the selected text: a box opens right under it
(function () {
  'use strict';

  const HIGHLIGHTS = ['penmark-added', 'penmark-word', 'penmark-comment'];
  let targets = [];
  let current = -1;

  /** All text under el, with a map back to text nodes, whitespace collapsed. */
  function textMap(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && n.parentElement.closest('.penmark-inserted') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let text = '';
    const map = []; // map[i] = [node, offset] for text[i]
    let lastSpace = true;
    for (let n; (n = walker.nextNode()); ) {
      const s = n.nodeValue;
      for (let i = 0; i < s.length; i++) {
        const ch = /\s/.test(s[i]) ? ' ' : s[i];
        if (ch === ' ' && lastSpace) continue;
        text += ch;
        map.push([n, i]);
        lastSpace = ch === ' ';
      }
    }
    return { text, map };
  }

  function rangeOf(tm, needle, from) {
    const q = needle.replace(/\s+/g, ' ').trim();
    if (!q) return null;
    const i = tm.text.indexOf(q, from || 0);
    if (i < 0) return null;
    const [sn, so] = tm.map[i];
    const [en, eo] = tm.map[i + q.length - 1];
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo + 1);
    return { range: r, end: i + q.length };
  }

  function clear() {
    document.querySelectorAll('.penmark-inserted').forEach(e => e.remove());
    if (window.CSS && CSS.highlights) HIGHLIGHTS.forEach(h => CSS.highlights.delete(h));
  }

  function apply() {
    clear();
    const ranges = { 'penmark-added': [], 'penmark-word': [], 'penmark-comment': [] };
    const nav = [];
    for (const el of document.querySelectorAll('[data-penmark]')) {
      let d;
      try { d = JSON.parse(el.getAttribute('data-penmark')); } catch { continue; }
      let tm = textMap(el);
      const before = [];
      for (const s of d.a || []) {
        const hit = rangeOf(tm, s);
        if (hit) { ranges['penmark-added'].push(hit.range); nav.push(hit.range); }
      }
      for (const m of d.m || []) {
        const hit = rangeOf(tm, m.t);
        if (!hit) continue;
        ranges['penmark-added'].push(hit.range);
        nav.push(hit.range);
        let from = hit.end - m.t.replace(/\s+/g, ' ').trim().length;
        for (const w of m.w) {
          const wh = rangeOf(tm, w, from);
          if (wh && wh.end <= hit.end) { ranges['penmark-word'].push(wh.range); from = wh.end; }
        }
        before.push(m.o);
      }
      if (before.length) el.setAttribute('title', 'Before:\n' + before.join('\n'));
      for (const r of d.r || []) {
        const del = document.createElement('del');
        del.className = 'penmark-del penmark-inserted';
        del.textContent = r.o;
        del.title = 'Removed by Claude';
        const hit = r.p ? rangeOf(tm, r.p) : null;
        if (hit) {
          const point = hit.range.cloneRange();
          point.collapse(false);
          point.insertNode(del);
          del.insertAdjacentText('beforebegin', ' ');
        } else {
          el.insertBefore(del, el.firstChild);
        }
        nav.push(del);
        tm = textMap(el);
      }
      for (const c of d.c || []) {
        const hit = rangeOf(tm, c.q);
        if (hit) ranges['penmark-comment'].push(hit.range);
      }
    }
    document.querySelectorAll('[data-penmark-nav]').forEach(e => nav.push(e));
    if (window.CSS && CSS.highlights && window.Highlight) {
      for (const [name, list] of Object.entries(ranges)) if (list.length) CSS.highlights.set(name, new Highlight(...list));
    }
    const top = t => (t.getBoundingClientRect ? t.getBoundingClientRect().top : 0) + window.scrollY;
    targets = nav.sort((a, b) => top(a) - top(b));
    current = -1;
  }

  function go(direction) {
    if (!targets.length) return;
    const y = window.scrollY + window.innerHeight / 3;
    const top = t => t.getBoundingClientRect().top + window.scrollY;
    if (current < 0) current = direction > 0 ? targets.findIndex(t => top(t) > y + 1) : targets.length - 1 - [...targets].reverse().findIndex(t => top(t) < y - 1);
    else current = current + direction;
    if (current < 0 || current >= targets.length || Number.isNaN(current)) current = direction > 0 ? 0 : targets.length - 1;
    const t = targets[current];
    const r = t.getBoundingClientRect();
    window.scrollTo({ top: r.top + window.scrollY - window.innerHeight / 3, behavior: 'smooth' });
    const el = t.nodeType === 1 ? t : (t.startContainer.parentElement);
    if (el) { el.classList.add('penmark-flash'); setTimeout(() => el.classList.remove('penmark-flash'), 900); }
  }

  function lineOf(node) {
    for (let n = node && (node.nodeType === 1 ? node : node.parentElement); n; n = n.parentElement) {
      if (n.hasAttribute && n.hasAttribute('data-line')) return Number(n.getAttribute('data-line'));
    }
    return 0;
  }

  let box = null;

  function closeBox() {
    if (box) box.remove();
    box = null;
    if (window.CSS && CSS.highlights) CSS.highlights.delete('penmark-pending');
  }

  /** Comment box right under the selected text; Enter saves it through a vscode:// link. */
  function comment() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || !sel.rangeCount) return;
    const meta = document.getElementById('penmark-meta');
    let source = '';
    try { source = JSON.parse(document.getElementById('vscode-markdown-preview-data').getAttribute('data-settings')).source; } catch { /* old preview */ }
    if (!meta || !source) return;
    const a = lineOf(sel.anchorNode);
    const b = lineOf(sel.focusNode);
    const range = sel.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();

    closeBox();
    if (window.CSS && CSS.highlights && window.Highlight) CSS.highlights.set('penmark-pending', new Highlight(range));
    box = document.createElement('div');
    box.className = 'penmark-box';
    box.innerHTML = '<textarea rows="3" placeholder="What should Claude change here?"></textarea>' +
      '<div class="penmark-box-hint">Enter to save · Shift+Enter for a new line · Esc to cancel</div>';
    document.body.appendChild(box);
    const width = Math.min(420, document.documentElement.clientWidth - 16);
    box.style.width = width + 'px';
    box.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    box.style.left = Math.max(8, Math.min(rect.left + window.scrollX, document.documentElement.clientWidth - width - 8)) + 'px';
    const input = box.querySelector('textarea');
    input.focus();
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeBox(); }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const body = input.value.trim();
        closeBox();
        if (!body) return;
        const q = new URLSearchParams({ source, line: String(Math.min(a, b)), endLine: String(Math.max(a, b)), text, body });
        const link = document.createElement('a');
        link.href = `vscode://${meta.getAttribute('data-ext')}/comment?${q}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    });
  }

  document.addEventListener('mousedown', e => {
    if (box && !box.contains(e.target)) closeBox();
  }, true);

  document.addEventListener('keydown', e => {
    if (!e.altKey || e.metaKey || e.ctrlKey || (box && box.contains(e.target))) return;
    if (e.code === 'BracketRight') { e.preventDefault(); go(1); }
    else if (e.code === 'BracketLeft') { e.preventDefault(); go(-1); }
    else if (e.code === 'KeyC') { e.preventDefault(); comment(); }
  }, true);

  const later = () => setTimeout(apply, 0);
  window.addEventListener('load', later);
  window.addEventListener('vscode.markdown.updateContent', later);
  later();
})();
