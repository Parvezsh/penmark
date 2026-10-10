# Development

## Prerequisites

- Node.js 20 for building and packaging. The hook itself runs on Node 18 or newer.
- VS Code 1.90 or newer, with the `code` command on your PATH. The integration tests use it.

```sh
npm install
```

## Build and run

```sh
npm run build        # bundle src/ into dist/extension.js
npm run watch        # rebuild on change
npm run typecheck
```

Press **F5** in VS Code to start an Extension Development Host with the extension loaded (`.vscode/launch.json`). To try the hook without touching your real `~/.claude`, run Claude headless with a settings file of its own:

```sh
claude -p --settings ./my-test-settings.json "edit notes.md …"
```

Set `PENMARK_CLAUDE_DIR=/some/folder` in the hook command and in the environment you start VS Code from, and both will use that folder instead of `~/.claude`.

## Tests

```sh
npm test                    # unit tests (node:test), about 1 second
npm run test:integration    # VS Code integration tests in an isolated window, about 30 seconds
```

The integration script makes a temporary folder for the profile, the `~/.claude` stand-in and the docs. It deletes the folder when the tests pass and keeps it when they fail. Your own VS Code, profile and `~/.claude` aren't touched.

## Package

```sh
npm run package             # minified build + penmark-<version>.vsix
code --install-extension penmark-0.1.0.vsix
```

## Publish

Publishing to the Visual Studio Marketplace has no manual review; automated checks run and the listing appears within minutes.

Before the first release:

1. **License:** done. The project is 0BSD (`LICENSE`), so anyone can use it with no conditions. The bundled jsdiff library is BSD-3-Clause, and its notice ships in `THIRD_PARTY_NOTICES.md`; keep that file up to date if you add bundled dependencies.
2. **Create a publisher** at <https://marketplace.visualstudio.com/manage>, signing in with a Microsoft account. Then set `"publisher"` in `package.json` to its ID (it is the placeholder `penmark-dev` now). The extension ID becomes `<publisher>.penmark`; the preview script reads it at runtime, so nothing else needs changing.
3. **Repository:** done. `repository`, `homepage` and `bugs` point at the public GitHub repo, so the README screenshots resolve to its URLs on the Marketplace page. The screenshots aren't packaged into the `.vsix`; the README links to the GitHub copies.
4. **Create a Personal Access Token** in Azure DevOps with the *Marketplace → Manage* scope, then run `npx vsce login <publisher>`.

Each release:

1. Update `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. `npm test && npm run test:integration`
3. `npx vsce publish`

To list it in Cursor and VSCodium as well, publish the same `.vsix` to [Open VSX](https://open-vsx.org) with `npx ovsx publish`.

## Things that can break on a Claude Code update

The send feature uses Claude Code commands that aren't a documented API. Last checked against Claude Code 2.1.280:

- `claude-vscode.editor.open(sessionId?, prompt?)`
- `claude-vscode.insertAtMention`
- the tab view type `claudeVSCodePanel` and tab labels that show the session title
- `ai-title` records in session transcripts
- the PostToolUse `tool_response.originalFile` field the hook relies on

If one changes, Send falls back to putting the prompt on the clipboard. The hook logs an error instead of guessing. [spike.md](spike.md) shows how each one was checked.
