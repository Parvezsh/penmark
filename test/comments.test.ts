import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ReviewComment, archiveComments, loadComments, locate, newComment, saveComments } from '../src/comments';
import { formatNotes, notesFileName } from '../src/notes';
import { tabMatchesTitle } from '../src/sessions';

const comment = (over: Partial<ReviewComment> = {}): ReviewComment =>
  newComment({ path: '/docs/plan.md', line: 2, startChar: 0, endLine: 2, endChar: 10, quote: 'We ship in March.', body: 'Say April.', ...over });

test('comments round-trip through comments.json and archive moves them out', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'penmark-c-'));
  assert.deepEqual(loadComments(store), []);
  const a = comment();
  const b = comment({ body: 'Second.' });
  saveComments(store, [a, b]);
  assert.deepEqual(loadComments(store).map(c => c.body), ['Say April.', 'Second.']);
  archiveComments(store, [a], '/docs/.penmark/review.md');
  assert.deepEqual(loadComments(store).map(c => c.id), [b.id]);
  const [sent] = fs.readdirSync(path.join(store, 'sent'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(store, 'sent', sent), 'utf8')).comments[0].id, a.id);
});

test('locate follows the quoted text when lines move', () => {
  const c = comment({ line: 2, endLine: 2 });
  assert.deepEqual(locate(c, '# Plan\n\nWe ship in March.\n'), { line: 2, endLine: 2 });
  assert.deepEqual(locate(c, '# Plan\n\nNew intro.\nMore.\n\nWe ship in March.\n'), { line: 5, endLine: 5 });
  assert.deepEqual(locate(c, 'Text is gone.\n'), { line: 2, endLine: 2 }, 'falls back to the original line');
});

test('locate matches a quote across a line break', () => {
  const c = comment({ quote: 'ship in March. The team', line: 0, endLine: 1 });
  assert.deepEqual(locate(c, 'We ship in March.\nThe team has four.\n'), { line: 0, endLine: 1 });
});

test('notes group comments by doc, in line order, with 1-based lines', () => {
  const now = new Date(2026, 9, 10, 21, 5, 9);
  const notes = formatNotes(
    [comment({ line: 9, endLine: 9, body: 'Later one.' }), comment({ line: 2, endLine: 3 }), comment({ path: '/docs/b.md', body: 'Other doc.' })],
    c => ({ line: c.line, endLine: c.endLine }),
    p => path.relative('/docs', p),
    now,
  );
  assert.match(notes, /^# Review comments \(2026-10-10 21:05\)/);
  assert.match(notes, /## plan\.md\n\n1\. \*\*Lines 3-4\*\*\n   > We ship in March\.\n\n   Say April\.\n\n2\. \*\*Line 10\*\*/);
  assert.match(notes, /## b\.md/);
  assert.equal(notesFileName(now), 'review-20261010-210509.md');
});

test('Claude tab labels match the session title, shortened with an ellipsis', () => {
  assert.equal(tabMatchesTitle('doc.md sky and grass col…', 'doc.md sky and grass colour facts'), true);
  assert.equal(tabMatchesTitle('Short title', 'Short title'), true);
  assert.equal(tabMatchesTitle('Short', 'Short title'), false, 'without an ellipsis the whole title must match');
  assert.equal(tabMatchesTitle('Claude Code', undefined), false);
  assert.equal(tabMatchesTitle('…', 'anything'), false);
});
