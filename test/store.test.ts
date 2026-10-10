import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { markReviewed, moveStore, readStore } from '../src/store';
import { sessionTitle } from '../src/sessions';

function fakeStore() {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'penmark-store-'));
  const add = (key: string, id: string, at: string, docPath = `/docs/${key}.md`) => {
    const dir = path.join(store, 'files', key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.before.md`), 'b');
    fs.writeFileSync(path.join(dir, `${id}.after.md`), 'a');
    fs.appendFileSync(path.join(dir, 'edits.jsonl'), JSON.stringify({ v: 1, id, at, path: docPath, tool: 'Edit', newFile: false, sessionId: 's' }) + '\n');
  };
  return { store, add };
}

test('lists docs most recently edited first, edits oldest first', () => {
  const { store, add } = fakeStore();
  add('aaa', '2', '2026-10-10T10:02:00Z');
  add('aaa', '1', '2026-10-10T10:01:00Z');
  add('bbb', '3', '2026-10-10T10:03:00Z');
  const docs = readStore(store);
  assert.deepEqual(docs.map(d => d.key), ['bbb', 'aaa']);
  assert.deepEqual(docs[1].edits.map(e => e.id), ['1', '2']);
});

test('skips torn lines and edits whose copies are missing', () => {
  const { store, add } = fakeStore();
  add('aaa', '1', '2026-10-10T10:01:00Z');
  const dir = path.join(store, 'files', 'aaa');
  fs.appendFileSync(path.join(dir, 'edits.jsonl'), '{"v":1,"id":"torn"');
  fs.appendFileSync(path.join(dir, 'edits.jsonl'), '\n' + JSON.stringify({ v: 1, id: 'ghost', at: 'x', path: '/p', tool: 'Edit', newFile: false, sessionId: 's' }) + '\n');
  assert.deepEqual(readStore(store)[0].edits.map(e => e.id), ['1']);
});

test('an empty or missing store reads as no docs', () => {
  assert.deepEqual(readStore(path.join(os.tmpdir(), 'penmark-does-not-exist')), []);
});

test('markReviewed forgets one doc and leaves the rest', () => {
  const { store, add } = fakeStore();
  add('aaa', '1', '2026-10-10T10:01:00Z');
  add('bbb', '2', '2026-10-10T10:02:00Z');
  markReviewed(store, 'aaa');
  assert.deepEqual(readStore(store).map(d => d.key), ['bbb']);
  assert.deepEqual(fs.readdirSync(store).sort(), ['files']);
});

test('moveStore carries everything to the new folder', () => {
  const { store, add } = fakeStore();
  add('aaa', '1', '2026-10-10T10:01:00Z');
  const to = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'penmark-to-')), 'nested');
  moveStore(store, to);
  assert.equal(fs.existsSync(store), false);
  assert.deepEqual(readStore(to).map(d => d.key), ['aaa']);
});

test('sessionTitle reads the latest aiTitle from a transcript', () => {
  const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'penmark-t-')), 's.jsonl');
  fs.writeFileSync(t, [
    JSON.stringify({ type: 'user', message: 'hi' }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'First title', sessionId: 's' }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'doc.md sky and grass colour facts', sessionId: 's' }),
  ].join('\n'));
  assert.equal(sessionTitle(t), 'doc.md sky and grass colour facts');
  assert.equal(sessionTitle('/nowhere.jsonl'), undefined);
});

test('sessionTitle finds the latest title in the tail of a big transcript', () => {
  const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'penmark-big-')), 's.jsonl');
  const filler = JSON.stringify({ type: 'user', message: 'x'.repeat(1000) }) + '\n';
  fs.writeFileSync(t, JSON.stringify({ type: 'ai-title', aiTitle: 'Old title' }) + '\n' + filler.repeat(700) + JSON.stringify({ type: 'ai-title', aiTitle: 'New title' }) + '\n');
  assert.ok(fs.statSync(t).size > 512 * 1024);
  assert.equal(sessionTitle(t), 'New title');
  fs.writeFileSync(t, JSON.stringify({ type: 'ai-title', aiTitle: 'Only early title' }) + '\n' + filler.repeat(700));
  assert.equal(sessionTitle(t), 'Only early title', 'falls back to reading the whole file');
});
