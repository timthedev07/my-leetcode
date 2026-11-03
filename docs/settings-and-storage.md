# Settings and Storage

## Appearance

The application is dark-only. It does not follow the operating-system light theme or provide a light-theme flash.

The editor uses the system Monaco typeface when installed, followed by Menlo, Consolas and generic monospace fallbacks.

## Vim preference

The Standard/Vim preference is a non-secret global setting stored in SQLite. It
applies whenever a workspace is reopened and defaults to Standard for new
installations.

## C++ formatting configuration

The active `.clang-format` file is stored in Electron’s user-data directory.
The file is validated as YAML in the main process and against the bundled
clang-format engine in the Formatting settings panel.

Presets, individual controls and the complete YAML editor all update the same
configuration. Import and export use native file dialogues. Invalid changes do
not replace the last valid file.

## Drafts

- Drafts are stored per LeetCode account and displayed problem ID.
- Selecting a problem counts as activity.
- Meaningful editing, running and submitting refresh activity.
- Autosave begins after 500 ms of inactivity and also flushes on blur, `⌘S`, navigation and normal quit.
- Cursor, selection and scroll position are restored when practical.

## Thirty-day retention

An attempt is removed when its last activity is older than exactly 30 × 24 hours. An attempt exactly on the cutoff is retained. Cleanup runs at startup and every 24 hours.

The Recent interface queries the same cutoff, so expired drafts do not linger in an alternative cache.

## Database

The SQLite database is stored under Electron’s application data directory. It contains problem metadata, source drafts, editor state and non-secret settings.

It never contains:

- LeetCode cookies or CSRF values;
- the Playwright browser profile;
- GitHub access tokens;
- OAuth client secrets.

## Layout preferences

Sidebar visibility, resize-panel sizes, and the editor’s Tab-focus preference use renderer local storage. They contain no credentials or source code.

