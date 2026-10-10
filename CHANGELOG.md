# Changelog

## 0.1.0 (preview, unreleased)

First version.

- Claude Code hook that records the before and after text of each Claude edit to a markdown file, made with its edit tools or with shell commands that name the file. Install and Uninstall commands show the exact settings change first.
- Sentence-level highlights of Claude's changes since the last review, in the built-in markdown preview and the source editor. Changed words are emphasised, removals are shown in place, and the user's own edits are left out.
- To review panel, Mark reviewed, side-by-side diff, next/previous change, show/hide toggle.
- Review comments from the editor or the preview (⌥C on Mac, Alt+C elsewhere): a comment box opens right under the selected text. Kept until sent.
- Send comments to Claude Code: one notes file, sent to the session that edited the docs, or else the Claude tab already open, with the prompt filled in but not sent.
- Configurable storage folder.
- Licensed 0BSD: free for everyone, no conditions.
