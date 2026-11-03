# Phase 0: Architecture and API Feasibility

Recorded on 4 November 2026.

## Repository audit

- The application repository began with the implementation plan only.
- The active branch was `dev`, tracking `origin/dev` at `https://github.com/timthedev07/my-leetcode`.
- No package manager or application convention existed, so the project uses Yarn 4 through Corepack.
- The development Git repository is separate from the user-selected solutions repository.

## Verified LeetCode contracts

The following unauthenticated operations were called directly against `https://leetcode.com/graphql` and returned the expected data:

- `question(titleSlug: "two-sum")`: internal ID, frontend ID, title, slug, difficulty, paid flag, HTML content, topic tags, hints, example test cases and C++ starter code.
- `questionList(filters: { searchKeywords: "minimum size" })`: total count plus real matching problem summaries.
- `userStatus`: returned `isSignedIn: false` with an empty username for an anonymous request.

The implementation therefore uses authored GraphQL documents, a first-party GraphQL client and Zod-normalised internal models. No LeetCode wrapper package is used.

## Unverified authenticated contracts

No authorised LeetCode account was available during Phase 0. The following remain live-account gates and must not be represented as verified until exercised:

- persistent Playwright session survival across a real restart;
- CSRF requirements for state-changing requests;
- Run payload and case-by-case result fields;
- Submit payload and asynchronous judgement fields;
- C++-only submission-history shape;
- submitted-source retrieval for the logged-in owner;
- remote account statistics.

The application will implement these boundaries with strict validation, bounded polling, honest errors and an **Open on LeetCode** fallback. It will not bypass challenges, anti-bot controls or access restrictions.

## GitHub feasibility

GitHub’s current documentation confirms the OAuth device-authorisation flow and Content API model:

- device polling must respect the returned `interval` and `expires_in`;
- the public client ID is required, while no client secret is stored in a desktop app;
- the token response is polled until authorised, denied or expired;
- repository contents are created or updated with the file SHA on updates.

The default proposed solutions repository, `timthedev07/leetcode`, was not publicly resolvable during the audit. No repository or branch will be written until the user selects and confirms a destination in Settings.

## Compatibility decisions

- Electron, electron-vite, Playwright and Monaco versions are pinned in the lockfile.
- SQLite remains in the Electron main process and is rebuilt for Electron’s ABI during packaging.
- Playwright Chromium is installed into a dedicated local resource path and must be included in packaged builds; a missing browser produces an actionable state.
- The sandboxed renderer receives only a narrow typed preload API.
- All remote network access and secret handling remain in the main process.

