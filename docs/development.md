# Development

## Prerequisites

- Node.js 20 for building and packaging (`.nvmrc` pins it: run `nvm use`). `vsce` fails on Node 18 with `ReferenceError: File is not defined`. The hook itself runs on Node 18 or newer.
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

Penmark is published on the Visual Studio Marketplace as [`brok.penmark`](https://marketplace.visualstudio.com/items?itemName=brok.penmark). Manage it (statistics, versions, unpublish) at the [publisher hub](https://marketplace.visualstudio.com/manage/publishers/brok/extensions/penmark/hub). There is no manual review: automated checks run, and a new version shows up within a few minutes. Installing it can take a few more minutes after the listing appears.

### Releasing a new version

1. **Bump the version** in `package.json` (`0.1.0` → `0.1.1` for fixes, `0.2.0` for features). While `"preview": true` is set, the listing shows a Preview badge.
2. **Add a `CHANGELOG.md` entry** for that version, with the date.
3. **Test, package and publish**, from the project folder:

   ```sh
   nvm use && npm test && npm run test:integration && npm run package && npx vsce publish --packagePath penmark-<version>.vsix
   ```

   - `nvm use` switches to Node 20 from `.nvmrc`. `vsce` fails on Node 18 with `ReferenceError: File is not defined`.
   - `npm run package` makes the minified build and `penmark-<version>.vsix`. Publishing that file means you publish exactly what was tested.
   - Use the project's own `vsce` through `npx` inside the project folder. Run elsewhere, `npx` downloads a separate copy.

4. **Commit, tag and push:**

   ```sh
   git commit -am "Release <version>" && git tag -a v<version> -m "Penmark <version>" && git push && git push origin v<version>
   ```

### Logging in

`vsce` needs a Personal Access Token for the `brok` publisher. If `npx vsce publish` says you aren't logged in, or the token has expired:

1. At <https://dev.azure.com>, open your profile menu → **Personal access tokens** → **New token**.
2. Set **Organization** to *All accessible organizations*, and **Scopes** to *Custom defined* → **Marketplace: Manage**.
3. In the project folder, run `nvm use && npx vsce login brok` and paste the token.

`npx vsce ls-publishers` shows which publishers you're logged in as.

### Set up once (done for 0.1.0)

- **License:** 0BSD (`LICENSE`), so anyone can use it with no conditions. The bundled jsdiff library is BSD-3-Clause, and its notice ships in `THIRD_PARTY_NOTICES.md`; keep that file up to date if you add bundled dependencies.
- **Publisher:** `brok`, so the extension ID is `brok.penmark`. The preview script reads the ID at runtime, so nothing else depends on it.
- **Repository:** `repository`, `homepage` and `bugs` point at the public GitHub repo, so the README screenshots resolve to its URLs on the Marketplace page. The screenshots aren't packaged into the `.vsix`.

### Also listing in Cursor and VSCodium

They use [Open VSX](https://open-vsx.org) rather than the Microsoft Marketplace. Create an account and a token there, then publish the same file: `npx ovsx publish penmark-<version>.vsix -p <token>`.

## Things that can break on a Claude Code update

The send feature uses Claude Code commands that aren't a documented API. Last checked against Claude Code 2.1.280:

- `claude-vscode.editor.open(sessionId?, prompt?)`
- `claude-vscode.insertAtMention`
- the tab view type `claudeVSCodePanel` and tab labels that show the session title
- `ai-title` records in session transcripts
- the PostToolUse `tool_response.originalFile` field the hook relies on

If one changes, Send falls back to putting the prompt on the clipboard. The hook logs an error instead of guessing. [spike.md](spike.md) shows how each one was checked.
