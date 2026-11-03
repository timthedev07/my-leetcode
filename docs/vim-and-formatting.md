# Vim and C++ Formatting

## Editor mode

The editor toolbar provides a persistent **Standard / Vim** toggle. New
installations use Standard editing.

When Vim is active, a compact status bar shows Normal, Insert, Visual and Visual
Line modes. Switching back to Standard disposes the Vim listeners without
replacing the Monaco model or clearing its undo history.

Available through `monaco-vim`:

- basic motions including `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `$`, `gg` and `G`;
- editing commands including `i`, `a`, `o`, `O`, `x`, `p`, `dd`, `yy` and text objects;
- character and line selections, indentation, undo and redo;
- `/` and `?` search with `n` and `N`.

`monaco-vim` uses CodeMirror’s Vim implementation under the hood. Some complex
Ex commands and compound text-object sequences can differ from Vim or Neovim.
Advanced automation also showed that `ciw` can leave the final character of a
searched word in place with this library version. The underlying draft is still
preserved, but review compound text-object edits before submitting.

Application shortcuts take precedence while Vim is active:

- `Esc` returns to Normal mode;
- `⌘K` opens problem search;
- `⌘Enter` runs tests;
- `⌘Shift+Enter` submits;
- `Option+Shift+F` formats;
- `⌘Z` and `⌘Shift+Z` undo and redo.

## Formatting

Formatting uses `@wasm-fmt/clang-format` in a dedicated Web Worker. The
WebAssembly binary is bundled locally and works offline. No system
`clang-format` binary or remote service is used.

Formatting:

1. snapshots the active Monaco model and version;
2. formats the complete C++ source;
3. discards the result if the model changed while formatting;
4. applies the change through Monaco’s document formatting provider;
5. lets the normal debounced autosave persist the result.

Formatting edits are undoable with `⌘Z`. Formatting is user-initiated only and
does not run before Run, Submit or GitHub Sync.

## Configuration

The active configuration is stored as `.clang-format` in the Electron user-data
directory. The default style is:

```yaml
BasedOnStyle: LLVM
IndentWidth: 4
TabWidth: 4
UseTab: Never
ColumnLimit: 100
BreakBeforeBraces: Attach
PointerAlignment: Left
SortIncludes: Never
```

Open **Settings → Formatting** to use LLVM, Google, Chromium, Microsoft,
Mozilla, WebKit, GNU or a custom configuration. The panel validates YAML and
the installed formatter engine before saving, and shows a live before/after
preview.

Import and export use native file dialogues. Invalid YAML or unsupported style
values never replace the last valid configuration.

