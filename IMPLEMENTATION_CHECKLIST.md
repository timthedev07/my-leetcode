# Implementation Checklist

The authoritative product specification is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Status

- [x] Phase 0: Repository audit and API feasibility recorded.
- [x] Phase 1: Secure Electron, React, TypeScript and shadcn foundation.
- [x] Phase 2: Dark keyboard-first application shell.
- [x] Phase 3: SQLite attempts, Monaco C++ editor and 30-day retention.
- [x] Phase 4: Live LeetCode discovery and C++ starter templates.
- [x] Phase 5: LeetCode login, Run, Submit and submission history.
- [x] Phase 6: GitHub device login and accepted-C++ synchronisation.
- [x] Phase 7: Documentation, packaging, visual QA and release validation.

## Editor extensions

- [x] Optional Standard/Vim mode with persistent preference and mode status.
- [x] Local C++ formatting through the bundled clang-format WebAssembly engine.
- [x] Monaco Format Document provider, toolbar action and `Option+Shift+F`.
- [x] Persistent `.clang-format` configuration, presets, YAML, import/export and live preview.
- [x] Vim and formatting integration tests, including offline and packaged operation.
- [x] Vim and formatting documentation.

## External gates

- [ ] Authenticated LeetCode judging must be exercised with an authorised user session.
- [ ] GitHub device login requires a registered OAuth/GitHub App client ID.
- [ ] The target solutions repository and branch must be selected and confirmed by the user.
- [ ] macOS code signing and notarisation require an Apple Developer identity.

## Verification gates

- [x] Typecheck, lint and the complete local test suite.
- [x] Keyboard and accessibility review, including focus restoration.
- [x] Visual review of the live problem workspace, docs, dialogs and narrow layout.
- [x] Development build and packaged arm64 application smoke test.
- [x] Security review of IPC, credentials, navigation and rendered problem HTML.

## Verification evidence

- `yarn typecheck`: passed.
- `yarn lint`: passed.
- `yarn test`: 12 files and 66 tests passed.
- `yarn test:e2e`: development and packaged-arm64 launch tests passed.
- `yarn package`: produced unsigned arm64 DMG and ZIP artefacts.
- The DMG checksum verified and the app launched directly from the mounted distribution image.
- Live public LeetCode search and problem detail were verified.
- Authenticated LeetCode judging and GitHub writing remain gated on user-owned accounts and credentials.

