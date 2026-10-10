# Penmark — plan

A VS Code extension for reviewing markdown docs that Claude Code writes: comment on the docs, send all comments to Claude in one batch, then review only what Claude changed.

Status: PoC plan, 2026-10-10. All six build steps done and tested (2026-10-10); ready for hands-on testing. How it works: [how-it-works.md](how-it-works.md). Named **Penmark** on 2026-10-10 (working name "Markdown Redline"; the Marketplace already had several "Redline" extensions, see [competitors.md](competitors.md)).

## The story

You give Claude a batch of instructions across several docs and go do something else, while one or more Claude sessions work. When you come back you don't re-read 40 pages. You see which docs changed, jump straight to the sentences that were added or removed, select text and leave comments without breaking your flow, and send the whole batch back with one action.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Use VS Code's built-in markdown preview and add to it with a markdown-it plugin plus preview script and style. Mermaid stays with `bierner.markdown-mermaid`. The plugin finds which document it's rendering by matching the text (`state.src`) against tracked files. | The built-in preview runs plugins from every extension (spike c: both rendered together). The preview leaves `env.currentDocument` empty. |
| 2 | Baseline = **since last reviewed**, not n-1. | If two prompts or two sessions touch a doc before you look, n-1 would hide the first round. For a single prompt the two are the same. |
| 3 | Claude's edits are recorded with one **PostToolUse** hook on `Edit\|Write\|MultiEdit\|Bash` for `*.md` / `*.markdown`, plus a **PreToolUse** hook on `Bash` that saves the markdown files a shell command names (added 2026-10-10: in real use Claude edited a doc with an inline Python script, which the edit-tool hook never saw). It stores `session_id`, `prompt_id`, `tool_use_id` and `transcript_path`. | Exact attribution, and the Claude session isn't interrupted. File watchers can't tell Claude from you. PostToolUse already carries the "before" text (`tool_response.originalFile`), and a rejected edit never fires it, so nothing is left over (spike a). |
| 4 | Store a copy of the file **before** (`originalFile`) and **after** (read from disk) each Claude edit. Highlight = sentences Claude added or changed that are still in the file; removals = sentences Claude deleted that are still gone. | Your own edits never fall inside a before/after pair, so they're never highlighted. If you rewrite a Claude sentence, its highlight goes away. |
| 5 | Changes are highlighted by sentence, with words inside a changed sentence where feasible. Additions are green. Removals are red strikethrough in place; large removed blocks shrink to "▸ N lines removed". | Sentence level is what you asked for. Shrinking keeps big rewrites readable. |
| 6 | Highlights can be switched on and off (status bar, command, keyboard shortcut), plus a setting to hide removals. | Sometimes you just want to read the doc. |
| 7 | A **To review** panel lists changed docs with session and change count, and has **Mark reviewed**. | Lets you leave while Claude works and come back to several sessions' worth of output. |
| 8 | Comments without clicking: **select text → shortcut → type → Enter**. The comment box opens right under the selected text: in the preview, a box drawn by the preview script (Enter saves), sent through a `vscode://` link; in the editor, VS Code's own inline comment box (⌘Enter saves). Changed 2026-10-10 after testing: a box at the top of the window felt disconnected from the text. | Every click per comment slows you down. The preview can't call our extension directly. The link works; VS Code asks "Allow?" once, then remembers it (spike c). |
| 9 | Comments are collected **across docs** until sent. Sending marks the commented docs reviewed (setting `markReviewedOnSend`, on by default), so Claude's next round is highlighted on its own. One **Send** writes a single notes file and fills in the Claude chat box with one line pointing to it; you press Enter. | You send instructions in batches. Prefill rather than auto-send is safe and costs one keystroke. |
| 10 | Session target: if every doc in the batch came from one session, send to that session; otherwise a menu of the sessions involved plus "New session". Delivery: no session known → the Claude tab already open (empty or ongoing) via @-mention, or a new tab with the prompt filled in if none is open (changed 2026-10-10: it used to always open a new tab); session not open in a tab → open it with the prompt filled in; open in a tab → bring it to the front and @-mention the notes file, but only when it's the only visible Claude tab; otherwise copy the prompt to the clipboard and say so. | You run several sessions; guessing "the latest" would be wrong. Claude Code refuses prompts for an open tab, and an @-mention goes to every visible Claude tab (spike d). Tabs are matched to sessions by the transcript's `aiTitle`. Never close a tab: it can be the wrong one and loses drafts. |
| 11 | Storage location is a setting (default `~/.claude/penmark/`). The extension writes the path to a pointer file (`~/.claude/penmark.json`) that the hook reads, offers to move the data when you change it, and warns about `.gitignore` if it's inside a repo. | Hooks run outside VS Code and can't read its settings. |
| 12 | An **Install hooks** command copies the hook to `~/.claude/hooks/penmark.js` and adds one entry to `~/.claude/settings.json` (absolute `node` path, 5 s timeout). Before writing, it shows the exact diff and keeps a backup. It merges with existing hooks and never replaces them. Also has **Uninstall hooks**. | That file is global and already has your own hooks; you should see the change before it's made. A fixed script path survives extension updates. This follows your existing hook style. |
| 13 | Ship as a `.vsix` for the PoC; don't publish to the Marketplace yet. The README and docs are written so it can be published once a license, publisher ID and repository are set ([development.md](development.md#publish)). | It relies on undocumented Claude Code commands that may change on update. |

## Stack

The goal is a light extension: it loads only when a `.md` file opens, ships one bundled file and has one runtime dependency.

| Part | Choice | Why |
|---|---|---|
| Extension (`src/`) | TypeScript, bundled by esbuild into `dist/extension.js`; activates on `onLanguage:markdown` | Same language as VS Code; type checks against the API; esbuild has no config to maintain. |
| UI | Native VS Code only: Comments API, TreeView, settings, status bar | No React or webview framework. |
| Diff | `diff` (jsdiff): `diffSentences` and `diffWords` | The only runtime dependency (~30 KB). A hand-written diff risks highlights on the wrong sentence. |
| Preview add-on (`media/`) | Plain JS and CSS through `markdown.previewScripts` / `previewStyles`, plus a markdown-it plugin through `extendMarkdownIt` | Runs inside the built-in preview, alongside bierner's Mermaid. |
| Hook (`hooks/`) | Plain Node script with no dependencies; it only reads the event and copies the file | Must finish in milliseconds. All diffing happens later, in the extension. |
| Tests (`test/`) | `node:test` for the diff and storage logic; `@vscode/test-cli` only if editor-level tests are needed | No test framework for the core logic. |
| Packaging | `@vscode/vsce` → `.vsix` | The official tool. Build with Node 20; the system default Node 18 may be too old. |

Not used: webpack, React, our own markdown parser, our own Mermaid rendering.

## Claude Code integration (checked in installed extension v2.1.280)

- `claude-vscode.editor.open(sessionId, prompt)` fills in the chat input and doesn't send. Confirmed live.
- It refuses a prompt for a session already open in a tab. `claude-vscode.insertAtMention` reaches the visible Claude tab(s) instead.
- Undocumented, so an update can break it. Details and evidence: [spike.md](spike.md).

## Build order

1. ~~**Spike.**~~ Done; all checks pass ([spike.md](spike.md)). Original checks:
   - a. Do the hooks fire for edits made from the VS Code Claude panel, with `session_id` and `file_path`?
   - b. Does the `open` link fill in the prompt in an *existing* session?
   - c. Can a preview script open a `vscode://` link that reaches our extension, and is there an "allow?" prompt?
2. ~~**Tracking:**~~ Done: hook script, store layout, pointer file, Install/Uninstall hook commands, plus an interim "Show docs changed by Claude" diff and Mark reviewed.
3. ~~**Highlights:**~~ Done: sentence diff, additions and removals in the preview and the source editor, the toggle.
4. ~~**To review panel**~~ Done, with Mark reviewed.
5. ~~**Comments:**~~ Done: Alt+C in the source editor and the preview, the + in the margin, the Pending comments panel.
6. ~~**Send:**~~ Done: notes file, session pick, the 4-step delivery.

## Out of scope for the PoC

- Highlighting changes inside a Mermaid diagram. A later step could add a "diagram changed" badge, then a before/after toggle.
- Code files; this is for markdown only.
- Shell-command edits whose file name is built at run time (`for f in *.md`) aren't recorded.
- Splitting one comment batch across several sessions.

## Open questions

- Public release: the hook needs `node` installed, but Claude Code no longer needs Node, so a user may not have it. Fine for the PoC.
- Decided before release: published from a personal publisher account; licence 0BSD, free for everyone with no conditions.
- The extension now activates after VS Code starts (`onStartupFinished`), not only when a markdown file opens, so the To review count updates while you're away. Revisit if startup cost shows up.
