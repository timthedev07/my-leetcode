# Implementation Plan — Vim Mode and C++ Formatting

**Status:** Implemented and verified for the unreleased `0.0.0` build. Compatibility limits and verification evidence are recorded in `IMPLEMENTATION_CHECKLIST.md`, `README.md` and `docs/vim-and-formatting.md`.

## Objective

Extend the existing Electron + React + Monaco-based LeetCode desktop application with two fully integrated features:

1. Optional Vim editing using `monaco-vim`.
2. Local, configurable C++ formatting using `clang-format`.

Both must integrate with existing editor persistence, keyboard shortcuts, problem navigation, autosave, run/submit workflows and the application's dark, gold-accented shadcn/ui design.

Do not replace Monaco or rebuild the existing application architecture.

## 1. Technology

| Responsibility           | Technology                           |
| ------------------------ | ------------------------------------ |
| Code editor              | Existing Monaco Editor               |
| Vim emulation            | `monaco-vim`                         |
| C++ formatter            | `@wasm-fmt/clang-format`             |
| Formatting configuration | `.clang-format` YAML                 |
| Persistent preferences   | Existing application settings store  |
| Formatting execution     | Dedicated Web Worker where supported |
| UI                       | Existing shadcn/ui components        |

Use the actual locally bundled `clang-format` engine. Do not invoke a remote formatting API or require a separately installed binary.

## 2. Vim integration

### Editor controls

Add a discreet Standard/Vim toggle to the existing editor toolbar or editor settings.

- Default: Standard editing for new installations.
- Persist the selected mode globally.
- Changing modes must not recreate the Monaco model.
- Preserve the current document, undo history, cursor position, selection and scroll position where possible.
- When Vim is active, display a compact Vim status area at the bottom of the editor.
- Hide this status area entirely in Standard mode.

### Supported functionality

Support the following through `monaco-vim`, subject to compatibility with the installed Monaco version:

- Normal, Insert, Visual and Visual Line modes.
- Motions: `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `$`, `gg`, `G`.
- Editing: `i`, `a`, `o`, `O`, `x`, `dd`, `yy`, `p`, `ciw`, `diw`.
- Repetition using counts, such as `5j`, `3dd`.
- Undo and redo.
- Search using `/`, `?`, `n`, `N`.
- Ex commands where supported.
- Visual selections, indentation and text objects.

Do not implement a custom Vim emulator. Identify and document any unsupported commands rather than claiming complete Neovim compatibility.

### Keyboard interaction

Define explicit shortcut precedence.

| Shortcut  | Behaviour                                              |
| --------- | ------------------------------------------------------ |
| `Esc`     | Return to Normal mode when Vim is active               |
| `⌘K`      | Open problem search                                    |
| `⌘Enter`  | Run code                                               |
| `⌘⇧Enter` | Submit solution                                        |
| `⌥⇧F`     | Format C++ code                                        |
| `⌘⇧P`     | Open application command palette, if implemented       |
| `⌘Z`      | Standard undo, with Vim mappings working appropriately |

Application-level shortcuts must work regardless of whether Vim is enabled, without disrupting normal typing or Vim command sequences.

Ensure keyboard events are intercepted using a mechanism compatible with `monaco-vim`, rather than introducing fragile global event handlers.

### Lifecycle

Create a dedicated Vim integration hook or controller.

It must:

- Initialise Vim only after Monaco is mounted.
- Dispose of Vim bindings on mode changes and unmount.
- Avoid duplicate keyboard handlers.
- Restore editor focus appropriately.
- Work when switching between different problem models.
- Handle editor remounts without losing settings.

## 3. C++ formatting

### Formatting engine

Use `@wasm-fmt/clang-format` to format C++ locally.

The library accepts a C++ source string, filename and style configuration, and returns formatted source.

Run formatting off the main UI thread where feasible. Initialise the WebAssembly formatter lazily, reuse the loaded instance, and verify that its WASM asset is correctly bundled into packaged Electron builds.

The feature must work offline.

### Format action

Add a **Format** button in the existing editor toolbar, using the application's established button styling.

The same operation must be accessible through:

- Toolbar button.
- `⌥⇧F`.
- Monaco's Format Document action via a registered formatting provider.

All entry points must use one shared formatting service.

### Behaviour

When formatting:

1. Read the active problem's current Monaco model.
2. Capture its model identity and version.
3. Read the active formatting configuration.
4. Format the complete C++ document.
5. Confirm the model is still active and has not changed.
6. Apply the formatted text through Monaco's edit mechanism.
7. Preserve undo functionality and editor focus.
8. Let the existing autosave system persist the updated contents.

Do not use `editor.setValue()` to replace the entire document, as this can interfere with editing history.

Use Monaco document formatting providers or edit operations that preserve undo behaviour.

Formatting must be idempotent: formatting already-formatted code should not produce further changes.

If the source changes while formatting is in progress, discard the stale formatting result. Never overwrite newer edits.

Do not automatically format before Run, Submit or GitHub Sync. Formatting is a user-controlled action.

### Errors

If formatting fails:

- Keep the original source unchanged.
- Show a concise actionable error.
- Do not save partially formatted output.
- Do not silently substitute an unrelated formatting style.

## 4. Local formatting configuration

### Configuration file

Store the user's formatting configuration persistently in Electron's user-data directory, using a `.clang-format`-compatible YAML file.

Use a single global configuration by default, shared across all problems.

This configuration must survive application restarts and application updates.

### Default configuration

Start with the following reasonable competitive-programming style:

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

Do not modify or reformat existing solutions automatically when the application starts.

### Configuration interface

Add a **Formatting** section to the application's existing Settings interface.

Provide:

- Preset selector: LLVM, Google, Chromium, Microsoft, Mozilla, WebKit, GNU and Custom.
- Editable indentation width.
- Editable column limit.
- Tab/space selection.
- Brace style configuration.
- Pointer alignment.
- A full YAML configuration editor for advanced users.
- Import `.clang-format`.
- Export `.clang-format`.
- Reset to defaults.

Preset selection should update the effective configuration. A Custom mode should permit the complete clang-format option set supported by the bundled engine.

Do not create a separate configuration abstraction that cannot represent valid clang-format options.

### Validation and preview

Changes must be validated before becoming active.

Provide an interactive before/after C++ preview so users can see the effects of changing formatting settings.

Invalid configuration must:

- Produce an understandable error.
- Preserve the last valid configuration.
- Never corrupt the main editor.
- Never silently fall back to defaults.

Ensure supported configuration options correspond to the version of clang-format actually bundled with the application.

## 5. Integration with the existing application

### Editor persistence

The existing per-problem autosave logic must continue to work.

- Formatting changes trigger normal autosave.
- Switching problems preserves independent drafts.
- Toggling Vim must not reset the draft.
- Formatting one problem cannot modify another problem.
- Existing 30-day retention behaviour remains unchanged.

### Run, Submit and GitHub Sync

No changes to submission semantics:

- Run uses the current editor contents.
- Submit uses the current editor contents.
- GitHub Sync still retrieves the latest accepted C++ submission from LeetCode.
- Formatting the local editor must never cause an unsubmitted draft to be uploaded to GitHub.

### Visual design

Match the existing dark-only, gold-accented design.

Keep the Format button and Vim toggle compact and aligned with other editor actions.

Do not introduce large configuration panels into the main problem interface.

Use the existing Settings page for advanced formatting preferences.

Avoid uppercase eyebrow labels, redundant helper text, decorative cards and unnecessary UI elements.

## 6. Tests

### Vim

Test:

- Switching Standard → Vim → Standard.
- Basic motions and editing commands.
- Entering and leaving Insert mode.
- Visual selections.
- Search.
- Global shortcut precedence.
- Undo/redo behaviour.
- Switching between problems.
- Unmounting and remounting Monaco.
- Persistence across application restarts.

### Formatting

Test:

- Valid C++ formatting.
- Default and custom configurations.
- YAML configuration errors.
- Import/export.
- Undo after formatting.
- Idempotence.
- Formatting partially written C++.
- Stale formatting requests.
- Formatting during problem navigation.
- Autosave following formatting.
- No changes to Run/Submit/GitHub Sync semantics.
- Offline operation.
- Packaged Electron operation.

Include real keyboard interaction tests, not just mocked unit tests.

## 7. Implementation sequence

### Phase 1 — Repository audit and compatibility

Inspect the existing editor, state management, persistence, keyboard handlers and Settings architecture.

Confirm that `monaco-vim` is compatible with the installed Monaco version and that the WASM formatter builds in the current Electron/Vite environment.

**Gate:** Both libraries load successfully in minimal integration tests.

### Phase 2 — Vim

Implement the toggle, lifecycle management, status area, keyboard handling and persistence.

**Gate:** Existing editing workflows and keyboard shortcuts pass automated and manual tests.

Commit the completed phase.

### Phase 3 — Formatting engine

Implement the formatting service, WASM loading, Monaco formatting provider, toolbar action and shortcut.

**Gate:** C++ source formats correctly, without lost edits or broken undo history.

Commit the completed phase.

### Phase 4 — Formatting settings

Implement persistent `.clang-format` configuration, presets, custom YAML, import/export, validation and preview.

**Gate:** Settings persist and invalid configuration cannot damage editor state.

Commit the completed phase.

### Phase 5 — Integration, documentation and QA

Verify both features together across navigation, autosave, Run, Submit and GitHub Sync.

Perform keyboard-only testing, visual inspection and packaged application testing.

Update README and in-app documentation.

**Gate:** All applicable tests pass and outstanding issues are documented accurately.

Commit the completed phase.

## 8. Definition of done

Implementation is complete only when:

- Vim mode is functional and optional.
- The selected editor mode persists.
- Common Vim editing operations work.
- Standard Monaco editing remains unaffected.
- Local C++ formatting works offline.
- Formatting uses the user's valid `.clang-format` configuration.
- Users can configure, import, export and preview formatting styles.
- Formatting preserves undo and autosave.
- Existing problem drafts and submission workflows remain correct.
- The packaged Electron application works.
- Keyboard accessibility and visual quality have been verified.
- Documentation and tests are complete.
- Changes have been committed incrementally to the existing Git repository.
