# API Compatibility and Limitations

## LeetCode

LeetCode does not provide a supported public API for this workflow. The application uses:

- authored GraphQL documents at `https://leetcode.com/graphql/`;
- the website-backed Run endpoint shaped as `/problems/{slug}/interpret_solution/`;
- the website-backed Submit endpoint shaped as `/problems/{slug}/submit/`;
- submission polling at `/submissions/detail/{id}/check/`.

These operations are undocumented and can change. Public problem search and detail were verified on 4 November 2026. Authenticated judge, submission-source and statistics contracts require a real authorised account and must be revalidated after upstream changes or failed live tests.

The app does not use a proxy, scrape the catalogue in bulk, copy cookies, borrow another browser profile or bypass anti-bot controls.

## GitHub

GitHub authentication uses the official device authorisation flow. Repository discovery and file writes use the official REST API with `X-GitHub-Api-Version: 2022-11-28`.

Writes use:

- branch tree inspection for case-insensitive conflicts;
- Contents API reads;
- Contents API writes with an expected file SHA on updates.

Direct writes can be rejected by protected branches, repository rules or insufficient token permissions.

## Browser runtime

Playwright Chromium is pinned by the lockfile and installed into `resources/playwright/`. Packaged builds copy that directory into application resources. An update to Playwright can require reinstalling Chromium with `yarn install:browser`.

`monaco-vim` 0.4.4 is pinned against Monaco 0.57. Its older
`monaco-editor/esm/vs/editor/editor.api` import is mapped to the current Monaco
API module. The CodeMirror-derived keymap supports the documented common
commands, but complex Ex and compound text-object behaviour can vary.

`@wasm-fmt/clang-format` 23.1.1 supplies the formatter and its `.wasm` asset.
Both the worker JavaScript and WASM binary are emitted by Vite into the packaged
renderer output.

## External gates

- Authorised LeetCode account for live judge verification.
- Registered GitHub OAuth/GitHub App client ID for device sign-in.
- User-selected solutions repository and branch with write permission.
- Apple Developer identity for signed and notarised distribution.

