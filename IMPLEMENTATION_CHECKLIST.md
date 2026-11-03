# Implementation Checklist

The authoritative product specification is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Status

- [x] Phase 0: Repository audit and API feasibility recorded.
- [ ] Phase 1: Secure Electron, React, TypeScript and shadcn foundation.
- [ ] Phase 2: Dark keyboard-first application shell.
- [ ] Phase 3: SQLite attempts, Monaco C++ editor and 30-day retention.
- [ ] Phase 4: Live LeetCode discovery and C++ starter templates.
- [ ] Phase 5: LeetCode login, Run, Submit and submission history.
- [ ] Phase 6: GitHub device login and accepted-C++ synchronisation.
- [ ] Phase 7: Documentation, packaging, visual QA and release validation.

## External gates

- [ ] Authenticated LeetCode judging must be exercised with an authorised user session.
- [ ] GitHub device login requires a registered OAuth/GitHub App client ID.
- [ ] The target solutions repository and branch must be selected and confirmed by the user.
- [ ] macOS code signing and notarisation require an Apple Developer identity.

## Verification gates

- [ ] Typecheck, lint and focused automated tests.
- [ ] Keyboard and accessibility review.
- [ ] Visual review of the rendered application.
- [ ] Development build and packaged application smoke test.
- [ ] Security review of IPC, credentials, navigation and rendered problem HTML.

