# Development

## Prerequisites

- Node.js 22.12 or newer
- Corepack
- macOS arm64 for the packaged target

## Commands

```sh
corepack enable
yarn install
yarn dev
```

Verification:

```sh
yarn typecheck
yarn lint
yarn test
yarn build
yarn test:e2e
```

Packaging:

```sh
yarn package:dir
yarn package
```

`yarn package` installs Playwright Chromium into local resources before producing arm64 DMG and ZIP artefacts.

## Diagnostics

Development builds print structured diagnostics to the terminal and write
JSON-line records to:

```text
~/Library/Application Support/LeetCode Desktop/development.log
```

LeetCode judge entries include the operation, request identifier, poll state,
response field types, validation paths and final judge state. IPC entries include
the channel, error code and safe error details. Cookies, CSRF tokens, source code
and request headers are not logged. Production builds do not write this file.

## Tests

- Unit tests cover search ranking, retention boundaries, autosave debounce, judge state,
  accepted-submission selection, atomic GitHub commit construction, progress validation,
  recommendations, conflict retries, token encryption and refresh, and repository permissions.
- Editor tests cover real clang-format output, stale formatting results, `.clang-format` persistence, Vim mode transitions and shortcut precedence.
- Integration tests cover GraphQL normalisation, auth state transitions, judge polling/cancellation and GitHub REST boundaries.
- Accessibility tests cover keyboard registries and focusable search interactions.
- Playwright Electron tests launch the built app and assert the sandbox boundary.

Live integrations are opt-in and require user-owned credentials. Automated fixtures contain no live tokens, cookies or private source.

## Packaging notes

- `better-sqlite3` is rebuilt for Electron’s ABI.
- Playwright Chromium is copied from `resources/playwright` to application resources.
- The clang-format worker and its WASM asset are emitted under `out/renderer/assets`.
- The build is ad-hoc unsigned unless a Developer ID application identity and notarisation credentials are configured.
- Packaged builds check GitHub for updates shortly after launch and every six hours.
- Updates require explicit download consent and are installed after restart or application exit.
- `yarn release` publishes ad-hoc signed ZIP, DMG, blockmaps and `latest-mac.yml` assets required by the updater.

