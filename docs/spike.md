# Spike results — 2026-10-10

Three go/no-go checks from [plan.md](plan.md), build order step 1. The spike code and screenshots were kept locally in a `spike/` folder that isn't part of this repository; file names below refer to it.

## Summary

| Check | Result |
|---|---|
| a. Hooks record Claude's edits, with session and file | **Pass** |
| b. Prompt link fills in the Claude chat box | **Pass for a new session or one not open in a tab. Refused for a session already open in a tab.** The workaround is tested and works with safety checks (section d). |
| c. Preview reaches our extension through a `vscode://` link | **Pass**, with a one-time "Allow?" dialog. The two extensions work together. |

## a. Hooks

- Run with `claude -p --settings spike/a-hooks/settings.json` (CLI 2.1.295), using Haiku. Both Edit and Write fired PreToolUse and PostToolUse, with `session_id`, `prompt_id`, `tool_use_id`, `transcript_path` and `tool_input.file_path`.
- **PostToolUse already carries the "before" text:** `tool_response.originalFile`, plus `structuredPatch` and `userModified`. This held for both Edit and Write.
- The VS Code Claude panel runs a bundled copy of the same binary (`resources/native-binary/claude`, 2.1.280). Your existing global `UserPromptSubmit` hook already reaches the panel session every turn, so hooks fire there too.
- **Your `~/.claude/settings.json` already has a PreToolUse hook on `Bash|Edit|Write|MultiEdit|NotebookEdit`.** Install hooks must merge into it, not replace it.

## b. Prompt link

- Ran `vscode://anthropic.claude-code/open?prompt=…` live in your VS Code. A new Claude tab opened with the text **in the input box and not sent**, and no transcript was created. See `spike/b-prefill-not-sent.png`.
- Opening the link from outside VS Code showed "Allow 'Claude Code for VS Code' extension to open this URI?". Our extension will call the command `claude-vscode.editor.open(sessionId, prompt)` directly, so no link and no dialog.
- **The catch** (read in the extension code): if the session is already open in a tab, Claude Code reveals the tab and shows *"Session is already open. Your prompt was not applied — enter it manually."* A session that is closed or only in history opens with the prompt filled in.
- **Workaround (tested in section d):** reveal the session's tab, then run `claude-vscode.insertAtMention` with the notes file as the active editor. Its code delivers the @-mention to the visible Claude chat. Fallback: copy the prompt to the clipboard and reveal the tab (paste, then Enter).

## c. Preview → extension

- A throwaway extension ran in an isolated VS Code window (its own profile, copied bierner Mermaid extension). See `spike/c-preview/`.
- Our markdown-it plugin's highlights and bierner's Mermaid diagram rendered together in the same built-in preview. See `spike/c-preview/c-dialog-and-mermaid.png`.
- A preview script clicking a `vscode://spike.spike-redline/…` link reached our URI handler. It carried query data such as the source line numbers of the preview's blocks (`data-line`) and the highlight and diagram counts.
- **The first link showed "Allow 'spike-redline' extension to open this URI?".** After one Open, later links went straight through, including after reloading the window and after a full restart.
- `env.currentDocument` was empty in the plugin, so the plugin isn't told which file it's rendering. **Workaround:** match the rendered text (`state.src`) against tracked files.
- **Not tested:** pressing a shortcut inside the preview. A script can't reliably bring the second VS Code window to the front. Selection and `data-line` lookup work, so the risk is low. Test it with you present.

## d. Sending to a session that's already open (follow-up, same day)

Run in an isolated VS Code window with your installed Claude Code 2.1.280 linked in and logged in, against a real session. See `spike/d-send/`. Nothing was sent: the session transcript has no test prompts.

| Session state | Method | Result |
|---|---|---|
| Not open (closed tab, history only) | `claude-vscode.editor.open(sessionId, prompt)` | **Works.** The tab opens with the full prompt in its input. (`d-closed-session-prefilled.png`) |
| Open in a tab | Same command | **Refused:** "Session is already open. Your prompt was not applied". (`d-open-session-refused.png`) |
| Open in a tab | Reveal the tab, show the notes file in another group, run `claude-vscode.insertAtMention` | **Works:** `@.redline/notes.md` is inserted, not sent. **But** it goes to *every visible* Claude tab. (`d-mention-goes-to-all-visible.png`) |
| Open, stacked behind another Claude tab | Reveal → wait until the tab whose label matches the session's `aiTitle` is in front → check exactly 1 Claude tab is visible → @-mention | **Works:** only the target got it. (`d-safe-target-works.png`) |

- Session title: the transcript has `{"type":"ai-title","aiTitle":…}` records. The tab label is that title, cut short with "…".
- **Rejected: closing and reopening the tab.** The first try closed the wrong tab, because the reveal hadn't finished when the active tab was read. Closing also loses any unsent draft. Don't close tabs.
- **Known gap:** Claude chat in the **sidebar** is also a "visible" target, and the tabs API can't see it. If you use the sidebar and tabs together, the mention would go to both.

**Send logic for the PoC:**
1. No session yet → `editor.open(undefined, prompt)`, which pre-fills.
2. Target session not open in a tab → `editor.open(sessionId, prompt)`, which pre-fills.
3. Target open in a tab → reveal it; once it's in front and is the only visible Claude tab, @-mention the notes file.
4. Anything else (several Claude tabs visible, target never comes to the front) → copy the prompt to the clipboard, reveal the tab, and show "Prompt copied, paste with ⌘V".

## Changes these results suggest for the plan (applied to plan.md on 2026-10-10)

1. Decision 3: use only **PostToolUse** (`originalFile` gives the "before" text). No PreToolUse and no leftover copies when an edit is rejected.
2. Decision 3: the hook also stores `prompt_id`, so changes can be grouped by prompt later if wanted.
3. Decision 10: send using the 4-step logic in section d.
4. Decision 12: Install hooks merges into existing hook entries.
5. Highlights: the plugin finds the document by matching text, not through `currentDocument`.
