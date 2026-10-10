import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOOK_MATCHER, PRE_MATCHER, formatSettings, hasHook, hookCommand, hookIsCurrent, withHook, withoutHook } from '../src/hookInstaller';

const CMD = '/opt/homebrew/bin/node /Users/x/.claude/hooks/penmark.js';

// Shaped like the real ~/.claude/settings.json: other hooks on the same events.
const existing = {
  model: 'opus',
  hooks: {
    PreToolUse: [{ matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'python3 guard.py', timeout: 5 }] }],
    PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'log.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'bash turn-notify.sh stop', timeout: 10 }] }],
  },
};

test('adds a PreToolUse (Bash) and a PostToolUse entry and leaves every other hook alone', () => {
  const next = withHook(existing, CMD);
  assert.deepEqual(next.hooks.PreToolUse, [
    existing.hooks.PreToolUse[0],
    { matcher: PRE_MATCHER, hooks: [{ type: 'command', command: CMD, timeout: 5 }] },
  ]);
  assert.deepEqual(next.hooks.Stop, existing.hooks.Stop);
  assert.deepEqual(next.hooks.PostToolUse, [
    existing.hooks.PostToolUse[0],
    { matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: CMD, timeout: 5 }] },
  ]);
  assert.equal(next.model, 'opus');
  assert.equal(existing.hooks.PostToolUse.length, 1, 'input is not mutated');
});

test('installing twice keeps a single entry and picks up a new command', () => {
  const twice = withHook(withHook(existing, CMD), '/usr/local/bin/node /h/penmark.js');
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const ours = twice.hooks[event].filter((g: any) => g.hooks[0].command.includes('penmark.js'));
    assert.equal(ours.length, 1, event);
    assert.equal(ours[0].hooks[0].command, '/usr/local/bin/node /h/penmark.js');
  }
});

test('uninstall returns the settings to exactly what they were', () => {
  assert.equal(formatSettings(withoutHook(withHook(existing, CMD))), formatSettings(existing));
});

test('works on empty settings and cleans up after itself', () => {
  const next = withHook({}, CMD);
  assert.ok(hasHook(next));
  assert.deepEqual(withoutHook(next), {});
});

test('uninstall keeps user groups that were already empty', () => {
  const s = { hooks: { PostToolUse: [] as unknown[], Stop: [{ hooks: [] as unknown[] }] } };
  assert.deepEqual(withoutHook(s), s);
});

test('hasHook only sees our entry', () => {
  assert.equal(hasHook(existing), false);
  assert.equal(hasHook(withHook(existing, CMD)), true);
});

test('hookCommand quotes paths with spaces', () => {
  assert.equal(hookCommand('/usr/bin/node', '/a/b.js'), '/usr/bin/node /a/b.js');
  assert.equal(hookCommand('/My Apps/node', "/it's/b.js"), `'/My Apps/node' '/it'\\''s/b.js'`);
});

test('hookIsCurrent spots an install from the older version (PostToolUse only)', () => {
  const old = { hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: CMD, timeout: 5 }] }] } };
  assert.equal(hasHook(old), true);
  assert.equal(hookIsCurrent(old), false);
  const upgraded = withHook(old, CMD);
  assert.equal(hookIsCurrent(upgraded), true);
  assert.equal(upgraded.hooks.PostToolUse.length, 1, 'old entry replaced, not duplicated');
});

test('an install from before the rename is recognised and replaced', () => {
  const legacy = { hooks: { PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|Bash', hooks: [{ type: 'command', command: '/n/node /h/.claude/hooks/markdown-redline.js', timeout: 5 }] }] } };
  assert.equal(hasHook(legacy), true);
  assert.equal(hookIsCurrent(legacy), false);
  const upgraded = withHook(legacy, CMD);
  assert.equal(JSON.stringify(upgraded).includes('markdown-redline.js'), false, 'old entry removed');
  assert.equal(hookIsCurrent(upgraded), true);
});
