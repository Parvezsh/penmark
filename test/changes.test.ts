import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Change, computeChanges, countChanges, tokenize } from '../src/changes';

const doc = (...lines: string[]) => lines.join('\n') + '\n';
/** One Claude edit: before → after, and the doc is still exactly `after`. */
const oneEdit = (before: string, after: string) => computeChanges(before, after, [{ before, after }]);
const view = (cs: Change[]) => cs.map(c => ({ kind: c.kind, text: c.text, old: c.oldText }));

test('tokenize splits sentences and skips list, heading and quote markers', () => {
  const t = tokenize(doc('# Plan', '', 'We ship in March. The team has four people.', '- Risk one is low.', '> Quoted bit.', '1. First step'));
  assert.deepEqual(t.map(x => x.text), ['Plan', 'We ship in March.', 'The team has four people.', 'Risk one is low.', 'Quoted bit.', 'First step']);
  const src = doc('# Plan', '', 'We ship in March. The team has four people.');
  for (const x of tokenize(src)) assert.equal(src.slice(x.start, x.end), x.text, 'offsets point at the text');
});

test('tokenize keeps a fenced block (Mermaid) as one token', () => {
  const t = tokenize(doc('Intro.', '```mermaid', 'graph TD', '  A --> B', '```', 'After.'));
  assert.deepEqual(t.map(x => [x.text.split('\n')[0], x.fence, x.line, x.endLine]), [
    ['Intro.', false, 0, 0], ['```mermaid', true, 1, 4], ['After.', false, 5, 5],
  ]);
});

test('an added sentence is highlighted', () => {
  const before = doc('We ship in March.');
  const after = doc('We ship in March. QA starts in February.');
  assert.deepEqual(view(oneEdit(before, after)), [{ kind: 'added', text: 'QA starts in February.', old: undefined }]);
});

test('a reworded sentence is "modified", with the changed words marked', () => {
  const after = doc('We ship in April. The team has five people.');
  const cs = oneEdit(doc('We ship in March. The team has four people.'), after);
  assert.deepEqual(view(cs), [
    { kind: 'modified', text: 'We ship in April.', old: 'We ship in March.' },
    { kind: 'modified', text: 'The team has five people.', old: 'The team has four people.' },
  ]);
  assert.deepEqual(cs[0].words!.map(([s, e]) => after.slice(s, e)), ['April']);
  assert.deepEqual(cs[1].words!.map(([s, e]) => after.slice(s, e)), ['five']);
});

test('a removed sentence is a point after the sentence before it', () => {
  const after = doc('Keep this. And this.');
  const cs = oneEdit(doc('Keep this. Drop this one. And this.'), after);
  assert.deepEqual(view(cs), [{ kind: 'removed', text: '', old: 'Drop this one.' }]);
  assert.equal(after.slice(0, cs[0].start), 'Keep this.');
});

test('a removed block reports how many lines it spanned', () => {
  const cs = oneEdit(doc('Title.', 'Line one gone.', 'Line two gone.', 'Line three gone.', 'End.'), doc('Title.', 'End.'));
  assert.equal(cs.length, 1);
  assert.equal(cs[0].kind, 'removed');
  assert.equal(cs[0].oldLines, 3);
});

test("the user's own edits are never highlighted", () => {
  const baseline = doc('Alpha one. Beta two.');
  const claudeAfter = doc('Alpha one. Beta two. Claude added this.');
  // Later, the user adds a sentence and deletes one of their own.
  const current = doc('Alpha one. User wrote this. Claude added this.');
  const cs = computeChanges(baseline, current, [{ before: baseline, after: claudeAfter }]);
  assert.deepEqual(view(cs), [{ kind: 'added', text: 'Claude added this.', old: undefined }]);
});

test('edits from several Claude turns pile up', () => {
  const v1 = doc('One. Two.');
  const v2 = doc('One. Two. Three.');
  const v3 = doc('One. Four. Two. Three.');
  const cs = computeChanges(v1, v3, [{ before: v1, after: v2 }, { before: v2, after: v3 }]);
  assert.deepEqual(view(cs).map(c => c.text), ['Four.', 'Three.']);
});

test('a sentence Claude added and the user then rewrote is no longer highlighted', () => {
  const v1 = doc('One.');
  const v2 = doc('One. Claude sentence here.');
  const current = doc('One. My own wording instead.');
  assert.deepEqual(computeChanges(v1, current, [{ before: v1, after: v2 }]), []);
});

test('an unrelated replacement shows the removal, then the addition', () => {
  const cs = oneEdit(doc('Start. Cats are great pets. End.'), doc('Start. Quarterly revenue grew. End.'));
  assert.deepEqual(view(cs), [
    { kind: 'removed', text: '', old: 'Cats are great pets.' },
    { kind: 'added', text: 'Quarterly revenue grew.', old: undefined },
  ]);
});

test('a changed Mermaid diagram is one modified fence', () => {
  const before = doc('Flow:', '```mermaid', 'graph TD', '  A --> B', '```');
  const after = doc('Flow:', '```mermaid', 'graph TD', '  A --> C', '```');
  const cs = oneEdit(before, after);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].kind, 'modified');
  assert.equal(cs[0].fence, true);
  assert.equal(cs[0].line, 1);
  assert.equal(cs[0].endLine, 4);
});

test('a new file shows everything as added', () => {
  const after = doc('# New doc', '', 'First sentence. Second one.');
  assert.deepEqual(oneEdit('', after).map(c => c.kind), ['added', 'added', 'added']);
});

test('no edits, no changes', () => {
  assert.deepEqual(computeChanges('Same.\n', 'Same.\n', []), []);
});

test('countChanges groups changes on the same line', () => {
  const cs = oneEdit(doc('A one. B two.', 'C three.'), doc('A uno. B dos.', 'C three. D four.'));
  assert.equal(cs.length, 3);
  assert.equal(countChanges(cs), 2);
});

test('removed sentences before a changed diagram stay separate from it', () => {
  const before = doc('Intro.', '', 'Old module stays. It still works.', '', '```mermaid', 'graph TD', '  A --> B', '```');
  const after = doc('Intro.', '', '```mermaid', 'graph TD', '  A --> C', '```');
  const cs = oneEdit(before, after);
  assert.deepEqual(cs.map(c => [c.kind, c.fence ?? false, c.oldLines ?? null]), [['removed', false, 1], ['modified', true, null]]);
});

test('a removed whole paragraph is a block; a removed sentence mid-line is not', () => {
  const para = oneEdit(doc('Keep.', '', 'Whole paragraph goes. All of it.', '', 'End.'), doc('Keep.', '', 'End.'));
  assert.deepEqual(para.map(c => [c.kind, c.block]), [['removed', true]]);
  const mid = oneEdit(doc('Keep this. Drop this one. And this.'), doc('Keep this. And this.'));
  assert.deepEqual(mid.map(c => [c.kind, c.block]), [['removed', false]]);
});
