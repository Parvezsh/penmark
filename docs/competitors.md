# Similar extensions: the landscape, and where Penmark fits

Research from 2026-10-10. Each entry comes from the extension's Visual Studio Marketplace listing and README (ChangeDown's from its GitHub README). Install counts are from that day. The raw listings and READMEs were saved locally during the research and aren't part of this repository. Penmark was developed under the working name "Markdown Redline".

## The short version

Fifteen VS Code extensions sit near this space. All are small: the biggest has 166 installs, so nothing here is established yet. They fall into four groups:

| Group | Extensions | What they do |
|---|---|---|
| **Track changes in markdown** | ChangeDown | Word-style tracked changes, written *into* the markdown file as markup, then accepted or rejected. |
| **Show what an AI changed in files** | Redline for Claude Code, Claude's Changes, Pending Changes Reviewer, Claude Review | Line-by-line or file diffs of changed files, with accept/revert or "reviewed" checklists. Built for code. |
| **Comment on markdown, hand comments to an AI** | Markdown Claude Review, Redline Mark, Claude Plan, Redline — Markdown Comments, Markdown Review Comments, annotron | Comment threads or notes on docs, passed to the AI by MCP, terminal, clipboard or in-file markers. None shows what the AI changed. |
| **Review AI code, other** | Claude Code Redline, Redline-Review, Redline (g3nx89), Claude Plans Reviewer | Pull-request-style code review, or annotation and plan listing. |

**What Penmark adds.** Every other tool does one half: it shows changes (as code diffs, or as markup inside the file), or it collects comments. Penmark does both in one loop, for docs:

- it shows what Claude changed, sentence by sentence, as an overlay on the rendered preview;
- the file itself is never touched, and your own edits are left out;
- you comment in place, and all comments go back to the Claude session that wrote the doc.

## Feature comparison

**Yes** means stated in its README; **Partly** means a limited version; **No** means absent; **?** means the README doesn't say.

| Extension | Installs | Shows what changed | Leaves the file untouched | Per sentence in the rendered preview | Leaves out your own edits | Comments | Sends to Claude |
|---|---|---|---|---|---|---|---|
| **Penmark** | new | Yes | Yes | Yes | Yes | Yes | Yes (fills in the right session's chat) |
| ChangeDown | 11 | Yes | **No** (CriticMarkup in the file) | Partly (markup rendered inline) | Partly (per-author colours) | Yes | Partly (Claude works through its MCP tools) |
| Redline for Claude Code | 2 | Yes | Yes | No (side-by-side diffs) | ? | No | No |
| Claude's Changes | 49 | Yes | Yes | No (gutter, per chunk) | No | No | No |
| Pending Changes Reviewer | 44 | Yes | Yes | No (side-by-side diffs) | No | No | No |
| Claude Review | 166 | Yes (git diffs) | Yes | No | No | No | No |
| Markdown Claude Review | 10 | No | Yes (sidecar file) | No | n/a | Yes (threads) | Partly (live over MCP) |
| Redline Mark | 19 | No | Yes (sidecar file) | No | n/a | Yes | Yes (sent straight to a terminal) |
| Claude Plan | 125 | No | Yes | No | n/a | Yes (lost when the preview closes) | Yes (clipboard paste) |
| Redline — Markdown Comments | 35 | No | **No** (comments in the file) | No | n/a | Yes | Partly (you tell the agent) |
| Markdown Review Comments | 10 | No | **No** (comments in the file) | No | n/a | Yes | Partly (export) |
| annotron | 45 | No | Yes | No | n/a | Yes | Partly (auto-runs the `claude` CLI) |
| Claude Code Redline | 9 | Code diffs | Yes | No | n/a | Yes (on code) | Yes (via a plugin) |
| Redline-Review | 11 | Code diffs | Yes | No | n/a | Yes (with severity) | Partly (chat participant) |
| Redline (g3nx89) | 13 | No | Yes (sidecar files) | No | n/a | Yes (annotations) | No (copy a briefing) |
| Claude Plans Reviewer | 20 | No | Yes | No | n/a | No | No |

## The closest five, in detail

### ChangeDown — the one real neighbour
[Marketplace](https://marketplace.visualstudio.com/items?itemName=changedown.changedown-vscode) · [GitHub](https://github.com/hackerbara/changedown) · 11 installs · v0.5.0, May 2026

- **What it is:** "Track changes in markdown — for humans and AI agents." Word-style tracked changes for markdown.
- **How it works:** every edit is written into the document as [CriticMarkup](https://criticmarkup.com/) (`{++added++}`, `{--removed--}`, `{~~old~>new~~}`), with metadata in markdown footnotes. You accept or reject each change. A tracking mode wraps your own typing in markup too.
- **Features:**
  - accept/reject per change, line or file;
  - per-author colours, comment threads and replies, a review panel;
  - four view modes (all markup, simple, final, original);
  - export to Word, and a git gutter.
- **For AI:**
  - a Claude Code plugin with 6 MCP tools (propose, review, amend, supersede, list, read) and multi-agent editing;
  - hooks that either force agents through its tools ("strict") or wrap raw edits in markup automatically ("safety-net");
  - also supports OpenCode and Cursor.
- **Versus Penmark:** the opposite approach. ChangeDown changes the document, which carries markup until every change is resolved, and agents are configured around its format. Penmark never writes into the doc: the highlights are an overlay worked out from before/after copies, so the file stays clean for git, readers and other tools. ChangeDown is much broader (multi-agent editing, Word export, a benchmarked edit protocol). Penmark is narrower: review what Claude did, comment, and send it back.

### Redline for Claude Code
[Marketplace](https://marketplace.visualstudio.com/items?itemName=grabowskmr.redline-for-claude-code) · 2 installs · v1.0.0, Oct 2026

- **What it is:** see Claude Code's latest changes and work through unreviewed files in VS Code's diff viewer.
- **How it works:** Claude Code hooks (on prompt submit, stop and stop-failure) take git-tree snapshots without touching the real git index.
- **Features:**
  - a "Last run" view (the latest prompt's diff);
  - an "Unreviewed" checklist across prompts and sessions, where files come back if Claude changes them again;
  - tracking per session and per worktree.
- **For AI:** none. It's for reading only.
- **Versus Penmark:** the same hook-based idea and "unreviewed until checked" model. But it shows whole-file side-by-side diffs (made for code) rather than sentence highlights in the rendered doc, and has no comments or send-back.

### Markdown Claude Review
[Marketplace](https://marketplace.visualstudio.com/items?itemName=magicmicky.markdown-claude-review) · 10 installs · v0.1.7, Sep 2026

- **What it is:** Google-Docs-style comment threads on markdown, wired to Claude Code over MCP.
- **How it works:**
  - threads are anchored by quoting the text, not by line numbers, and re-anchored in 5 steps when text is rewritten;
  - they're stored in a JSON sidecar file, and shown in both a custom preview and the editor's comment threads.
- **Features:** thread states (open, answered, resolved, stale) that change on reply. Claude is told never to leave review traces in the document.
- **For AI:** MCP tools (`list_threads`, `reply_thread`, `resolve_thread`, `create_thread`), so Claude reads and answers threads itself.
- **Versus Penmark:** the most polished commenting, but **no view of what Claude changed**. It's a conversation about the doc, not a review of edits. The hand-off is a live MCP link rather than one batch send.

### Redline Mark
[Marketplace](https://marketplace.visualstudio.com/items?itemName=voxnotes.redline-mark) · 19 installs · v0.2.2, Mar 2026

- **What it is:** inline markdown review with Claude Code.
- **How it works:**
  - pull-request-style margin comments, saved as JSON under `.redline/`;
  - "4-tier" anchoring that follows comments through edits (about 85% accurate, per the README).
- **Features:** a sidebar with open and resolved counts, exclude patterns, and a `vscode://` link that opens a file in review mode.
- **For AI:** "Send to Claude" bundles the open comments and sends them straight to a terminal running Claude Code.
- **Versus Penmark:** a similar comment, sidebar and send loop. But no change highlighting, and it sends immediately instead of filling in the right chat for you to check.

### Claude Plan — Annotate & Review AI Plans
[Marketplace](https://marketplace.visualstudio.com/items?itemName=lepasoft-dev.claude-plan) · 125 installs · v0.1.2, Mar 2026

- **What it is:** add notes ("directives") to markdown plans in the built-in preview, then send them to Claude Code with one click.
- **How it works:**
  - select text or hover a line to add a note, shown as a numbered badge;
  - it handles tables, lists and nested structures.
- **For AI:** Alt+Enter or the ✨ button pastes a structured prompt into Claude Code's chat: clipboard plus a simulated keystroke on Windows, clipboard only on macOS and Linux.
- **Versus Penmark:** the closest *send* experience, and it also works in the built-in preview. But no change highlighting and no review list, and notes are lost when the preview closes.

## The others

### Diff-and-revert tools built for code

**Claude's Changes** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=userID503.claudes-changes), 49 installs)
- Tracks changes without git: the first edit to a file, yours or the AI's, saves a baseline in `.claude-changes/`.
- Shows green, yellow and red gutter marks and a changed-files panel. "Revert" and "Accept" buttons sit above each changed chunk.
- Includes your own edits, and works per line in the editor, not in a rendered doc.

**Pending Changes Reviewer** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=BPolyakov.pending-changes-reviewer), 44 installs)
- You snapshot open files *before* asking the AI, then see side-by-side diffs and accept or discard per file.
- You have to remember to snapshot, and it includes any change, not just the AI's.

**Claude Review** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=ljm.claude-review), 166 installs, the largest here)
- Pull-request-style "viewed" tracking for git changes: unreviewed → viewed → outdated when the diff changes.
- Works with staged and unstaged files, can stage reviewed files, opens diffs.
- Based on git, aimed at code, no comments.

### Comment tools that write into the file

**Redline — Markdown Comments** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=alxfain.redline-markdown-comments), 35 installs)
- Comments become hidden HTML tags in the `.md`, added in a GitHub-styled custom preview.
- Comments that lose their text are greyed out but keep the quote. Six themes, export to HTML or PDF.
- You tell the agent to address every marked comment.

**Markdown Review Comments** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=ainova-systems.markdown-review-comments), 10 installs)
- Comments become HTML-comment anchors plus an "Unresolved comments" section added to the file.
- Code lenses to jump to and resolve comments, and an "export review context" command for AI.

### Previews, code review and annotation

**annotron** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=hueanmy.annotron), 45 installs, rated 5.0)
- A browser-based review server (also an npm command-line tool) for `.md` and `.html`, with its own Mermaid rendering.
- Click any element or text to comment.
- An optional "autoAgent" watches for feedback and runs the `claude` CLI automatically.

**Claude Code Redline** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=nikiforovall.redline-extension), 9 installs)
- Claude posts its own code-review comments on a diff, you reply, and submitting wakes Claude to deal with them.
- Uses a localhost link to a Claude Code plugin, with a history of rounds.
- For code, not docs.

**Redline-Review** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=suyashlade.Redline-Review), 11 installs)
- Pull-request-style review of AI code changes, with severity tags (Must fix, Suggestion, Nitpick, Question).
- Exports to TOML, and has an `@redline` chat participant with `/fix`.

**Redline** (g3nx89) ([Marketplace](https://marketplace.visualstudio.com/items?itemName=g3nx89.redline), 13 installs)
- Annotate any file. Notes are stored as JSON sidecars, with git identity and timestamps.
- "Export briefing" uses prompt profiles that you paste into an AI chat.

**Claude Plans Reviewer** ([Marketplace](https://marketplace.visualstudio.com/items?itemName=raorao1011.claude-plan-review), 20 installs)
- A sidebar listing `~/.claude/plans`, with search and preview.
- No review or comments. The README is in Japanese.

## What only Penmark does

- **Highlights what Claude changed, sentence by sentence, in the rendered preview, without writing anything into the document.** Diagrams still render, changed words are emphasised, and removed text stays visible, struck through.
- **Leaves your own edits out**, even if you edited the doc between Claude's turns.
- **Catches Claude's edits however it makes them**: its edit tools, or shell commands such as `sed` and inline scripts. Nothing to snapshot or switch on first.
- **Keeps changes until you've reviewed them**, across several Claude turns and sessions, with a "To review" list.
- **Comments open right under the text** you selected, in the preview or the editor, and stay out of the doc until sent.
- **Sends every comment, across docs, in one go**, to the session that wrote the doc. The prompt is filled in, not sent, so you check it first.

## For the post: what's safe to claim

**Safe:**
- "Shows what Claude changed in your docs, sentence by sentence, right in the markdown preview, without adding any markup to your files."
- "Only Claude's changes are highlighted. Your own edits are left out."
- "Comment in place, then send all your comments back to the Claude session that wrote the doc."
- "Free, open source, no strings attached (0BSD), and everything stays on your machine."

**Don't claim:**
- "The first track-changes tool for markdown": ChangeDown does track changes, with markup in the file.
- "The only tool that tracks Claude's changes": several diff tools do, for code.
- "The only one that sends comments to Claude": Redline Mark, Claude Plan and others do.

**Angles:**
- **The problem:** Claude rewrites a 40-page doc and you either re-read it all or trust it blind. Git diffs show raw markdown line by line, mixed with your own edits.
- **The gap:** comment tools don't show what changed; diff tools are built for code; track-changes tools rewrite your files with markup.
- **The loop:** let Claude work, review only what changed, comment in place, and send it all back.
- **The principle:** your docs stay clean. Review is a layer on top, not markup inside.

## Ideas worth borrowing later

- Comments that follow their text when Claude rewrites the passage (Markdown Claude Review, Redline Mark).
- Comment states (open, answered, resolved) that change when someone replies (Markdown Claude Review).
- Severity tags: must fix, suggestion, nitpick, question (Redline-Review).
- An MCP link so Claude can read and answer comments itself (Markdown Claude Review, ChangeDown).
- Accept or revert a single Claude change in place (Claude's Changes, ChangeDown).
- Export the reviewed doc to Word (ChangeDown).
