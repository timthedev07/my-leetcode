# LeetCode Desktop — Full Electron Implementation Plan

**Status:** Implementation specification; no application code has been written or committed by this plan.  
**Platform priority:** macOS (Apple Silicon / M2); keep the architecture portable to Windows and Linux.  
**Language:** British English in all product copy and documentation.  
**Primary requirement:** A polished, keyboard-first, dark-only LeetCode desktop client with a C++ Monaco editor, direct GraphQL access, authenticated execution/submission where permitted, persistent recent attempts, and explicit GitHub synchronisation of accepted code.

## 0. Non-negotiable operating rules

1. Inspect the **existing application repository** first (`pwd`, `git status`, `git branch --show-current`, `git remote -v`, existing files). The remote is already configured: **do not** run `git init`, replace `origin`, rewrite history, force-push, or assume this app belongs inside the separate LeetCode solutions repository.
2. Preserve existing work. Do not overwrite unrelated files. Commit implementation changes incrementally, with a working, testable checkpoint after every phase. Push to the existing remote using the project’s established branch workflow, subject to access and any branch protections.
3. The **target solutions repository** for the in-app GitHub Sync is a separate, user-selected repository and branch; initial defaults may be `timthedev07/leetcode` and `dev`, but must be confirmed visibly in Settings before the first write.
4. Implement **C++ only**. No language selector, Java/Python code paths, or alternative online judge.
5. Integrate with LeetCode using a **first-party GraphQL client library** such as `graphql-request`, authored GraphQL queries, and a small in-house REST transport for judge operations. Do not depend on any third-party *LeetCode API wrapper*.
6. LeetCode does not offer a supported third-party public API for this workflow. Its internal endpoints can change, may block automated requests, and its Terms of Service restrict automated access and scraping. Treat integration as a feasibility gate, keep it user-initiated, do not bypass anti-bot/security controls, and degrade gracefully to a link opening the official LeetCode website if unsupported.
7. Never report a successful Run, Submit, or GitHub Sync unless the respective upstream operation is actually confirmed.
8. All UI must be elegant, dark-only, gold-accented, and operable without a mouse; no decorative uppercase eyebrow labels, gratuitous helper text, noisy cards, placeholder buttons, or fabricated data.

## 1. Technology choices

| Layer | Choice | Rationale |
|---|---|---|
| Desktop shell | Electron + electron-vite | Main/preload/renderer separation, practical development and packaging |
| UI | React + TypeScript + Vite | Strictly typed, fast renderer |
| Components | shadcn/ui, Radix primitives, Tailwind CSS, Lucide icons | Accessible and customisable without stock native selects |
| Editor | `monaco-editor` (direct integration) | Native keyboard support, C++ syntax, editor state models |
| Editor font | CSS `Monaco, Menlo, Consolas, monospace` | Prefers the macOS Monaco typeface; no proprietary font redistribution |
| GraphQL | `graphql-request` and project-owned documents/types | Direct calls to LeetCode rather than a LeetCode SDK |
| Server state | TanStack Query | Query caching, cancellation, status management |
| Lightweight UI state | Zustand or React local state, only where needed | No duplicate server-state store |
| Login/session | Playwright Chromium persistent browser context | User logs into the real website; no manual cookie copy |
| Persistent data | SQLite (`better-sqlite3`, rebuild for Electron ABI) | Reliable per-problem drafts, timestamps, and transactions |
| GitHub | Official GitHub REST API through Octokit or direct HTTPS | Repo selection, file upsert, authenticated commits |
| GitHub sign-in | GitHub App or OAuth App **device authorisation flow** | User-friendly desktop sign-in without a client secret in the app |
| Validation | Zod at network and IPC boundaries | Treat undocumented API responses as untrusted |
| Tests | Vitest + React Testing Library + Playwright Electron smoke tests | Unit, accessibility, integration and packaged-app coverage |
| Packaging | electron-builder (or an equivalent maintained Electron packaging tool) | Signed macOS builds; later Windows/Linux support |

Pin compatible, current releases in the lockfile. Use **Yarn** (via Corepack) if there is no pre-existing package-manager convention. Never replace an existing lockfile without cause. Verify native SQLite module rebuilding and Playwright Chromium installation in both development and packaged builds.

## 2. Repository structure

```text
.
├── README.md
├── package.json
├── yarn.lock
├── components.json
├── electron.vite.config.ts
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts                      # window lifecycle + secure navigation
│   │   ├── ipc/                          # narrowly scoped, validated handlers
│   │   ├── leetcode/
│   │   │   ├── auth.ts                   # persistent Playwright context
│   │   │   ├── transport.ts              # shared cookies, CSRF, headers
│   │   │   ├── graphql.ts                # graphql-request adapter
│   │   │   ├── queries/                  # GraphQL query documents
│   │   │   ├── problems.ts               # metadata/search normalisation
│   │   │   ├── judge.ts                  # run, submit, poll
│   │   │   └── submissions.ts            # history, accepted code
│   │   ├── github/
│   │   │   ├── auth.ts                   # device flow and secure token store
│   │   │   ├── repository.ts             # repo and branch validation
│   │   │   └── sync.ts                   # accepted C++ source -> commit
│   │   ├── storage/
│   │   │   ├── database.ts
│   │   │   ├── migrations/
│   │   │   └── retention.ts
│   │   └── security/                     # CSP, URL allowlists, sanitisation
│   ├── preload/
│   │   └── index.ts                      # typed, minimum-privilege API
│   ├── renderer/
│   │   ├── app/
│   │   ├── components/ui/                # shadcn/ui primitives
│   │   ├── features/
│   │   │   ├── search/
│   │   │   ├── problems/
│   │   │   ├── editor/
│   │   │   ├── execution/
│   │   │   ├── submissions/
│   │   │   ├── github-sync/
│   │   │   ├── recent/
│   │   │   ├── settings/
│   │   │   └── docs/
│   │   ├── hooks/
│   │   ├── styles/
│   │   └── types/
│   └── shared/
│       ├── schemas.ts                    # Zod IPC and domain contracts
│       ├── types.ts
│       └── constants.ts
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   ├── accessibility/
│   └── e2e/
├── docs/
│   ├── getting-started.md
│   ├── leetcode-authentication.md
│   ├── github-authentication.md
│   ├── github-sync.md
│   ├── keyboard-shortcuts.md
│   ├── architecture.md
│   ├── api-compatibility.md
│   ├── troubleshooting.md
│   └── development.md
├── .github/workflows/ci.yml
├── .env.example                     # non-secret configuration ONLY
├── .gitignore
└── IMPLEMENTATION_PLAN.md           # this plan when adopted in the repo
```

Avoid over-engineering: these are boundaries, not an obligation to create every empty folder on day one. Write implementation files only as each feature becomes real.

## 3. Electron process and security model

```
React renderer (untrusted display; no secrets, Node, or arbitrary URLs)
    ⇅ typed preload bridge (limited invoke calls and events)
Electron main process (Zod validation + service orchestration)
    ├── LeetCode GraphQL client + REST judge transport
    │   └── Playwright BrowserContext.request (shared authenticated cookies)
    ├── GitHub API client + OS-protected access token
    └── SQLite database under Electron userData
```

- BrowserWindow: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; use a local bundled renderer, restrictive CSP, and allowlisted external navigation.
- The renderer must **never** receive LeetCode cookies, CSRF tokens, GitHub tokens, raw API credentials, arbitrary network proxies, `fs`, `child_process`, or general-purpose IPC access.
- Validate IPC sender, channel, inputs, output shapes and authorised operations. All file paths and GitHub repository coordinates are validated in main, not trusted from the renderer.
- Render problem content as **sanitised HTML**; block script execution, inline event handlers and untrusted URLs. If images or mathematical expressions are supported, allow only explicitly approved origins and safe rendering paths.
- Logs, error messages and crash reports must redact secrets, submitted code where unnecessary, and browser-profile contents.
- Restrict browser-profile and database permissions. LeetCode’s persistent Chromium profile is sensitive session data; store it in `app.getPath('userData')`, never the Git working tree. GitHub tokens use OS-protected secrets via Electron `safeStorage` or a vetted Keychain adapter. On macOS, signed builds help stable Keychain access.
- Prohibit app self-updates which download executable code without signature verification; implement secure packaging before enabling auto-update.

## 4. LeetCode authentication: Playwright without copying cookies

### User flow

1. In first-run onboarding or Settings, select **Connect LeetCode**.
2. Launch Playwright’s **persistent Chromium context** with a dedicated local profile and a visible browser window at `https://leetcode.com/`.
3. The user signs in normally through the actual LeetCode site, handling any official multi-factor or challenge flow themselves. Do **not** script credentials or bypass a challenge.
4. Detect authenticated status with a minimal authorised profile query. The app displays the verified account username, not a generic ‘Connected’ guess.
5. Keep the persistent context available to the main-process transport (`context.request`) so HTTP calls use that browser’s cookies automatically. If restarting the app, reopen the profile and revalidate the session.
6. On expiry, show **Reconnect LeetCode**. Do not block access to locally saved drafts or cached public problem metadata.
7. **Disconnect** closes the context, clears the stored LeetCode browser profile after confirmation, and resets account status. Provide **Open LeetCode** as a fallback if direct integration is blocked or unsupported.

### Implementation constraints

- Playwright’s `BrowserContext.request` shares the browser context’s cookie jar: prefer that instead of exporting cookies into a JSON file or forwarding them to the React renderer.
- Use a small request-adapter layer for `graphql-request`; for judge calls, use the same authenticated transport with an in-house REST client. If a GraphQL client can’t accept the Playwright transport ergonomically, adapt its `fetch` interface in the main process rather than adopting a third-party LeetCode wrapper.
- For state-changing requests, obtain CSRF information within the trusted main process and include only the headers LeetCode actually requires; never expose session values to UI code.
- Confirm how Chromium is found/installed in a *fresh packaged build*. Pin the browser revision; do not assume a user's Chrome installation is present. Document download size, offline behaviour and update compatibility.
- The persisted profile is separate from the user's ordinary Chrome profile. Do not attempt to read another browser’s cookies or system Keychain entries.

**Gate:** Demonstrate, with a deliberately authorised test account, that the packaged app survives a restart and can perform an authenticated query without manual cookie entry. If blocked, treat that as an upstream restriction—not as an invitation to evade it.

## 5. Direct LeetCode GraphQL and judge integration

### 5.1 GraphQL client

Use `https://leetcode.com/graphql` with **authored and version-controlled operations**, starting with:

- `QuestionDetail(titleSlug)` → internal question ID, displayed/frontend ID, slug, title, difficulty, HTML content, tags, hints, premium flag, examples/test cases, `cpp` snippet, relevant judge metadata.
- `QuestionList(searchKeywords, page, limit)` → paginated search candidates. Validate the current filter schema with live fixtures; LeetCode has changed naming and input shapes.
- `UserProfile(username)` / progress queries → accepted/attempted counts and available per-difficulty statistics.
- `SubmissionHistory(titleSlug, cursorOrOffset)` → prior submissions, timestamps, language, judgement and submission IDs.
- `SubmissionDetail(submissionId)` → the **server-recorded submitted source code** for a chosen accepted C++ submission, when accessible to the logged-in owner.

Maintain strongly typed *internal* `Problem`, `Submission` and `UserStatistics` models and Zod parsers for external fields. Some content may be premium or unavailable; display a genuine locked/unavailable state instead of inventing text. LeetCode’s `questionId` and displayed `questionFrontendId` are not interchangeable, and judge endpoints may need the internal ID.

### 5.2 Judge operations (REST, not GraphQL)

LeetCode’s website has historically used endpoints shaped like:

- `POST /problems/{slug}/interpret_solution/` for **Run** (including user-supplied test cases).
- `POST /problems/{slug}/submit/` for **Submit**.
- `GET /submissions/detail/{id}/check/` for asynchronous judgement polling.

**Do not hard-code historical payloads as a guaranteed contract.** The first integration spike must establish the currently accepted request shape, authentication requirements, result IDs, states, timeout behaviour and errors using legitimate, low-volume, user-initiated operations. Only then implement and fixture-test the adapters. If LeetCode disallows a request, disable the corresponding control with an actionable explanation and an **Open on LeetCode** option. No proxy or anti-bot workaround.

### 5.3 State handling

`idle → requesting → queued/running → accepted | wrong_answer | compile_error | runtime_error | time_limit | other_terminal_error`

- Separate **Run** and **Submit** histories and badges. A passed custom test is **not** an accepted submission.
- Snapshot the editor text on execution; results belong to the snapshot, not to later edits.
- One active judge operation per problem; protect against double-clicks, network retries accidentally re-submitting, stale poll results and navigation during execution.
- Poll with bounded exponential/backoff-aware delays, a maximum duration, and explicit timeout/cancellation; respect `429` and `Retry-After`.
- Parse compile errors and case-by-case output when provided, including expected/actual outputs, runtime and memory, without claiming unavailable fields.
- Fetch submission history lazily, paginate, show C++ source in a read-only Monaco view, and support **Restore to editor** only after confirming replacement of dirty work.
- Statistics reflect *remote* LeetCode account data; recent local attempts are not automatically solved problems.

## 6. Interface and visual system

### 6.1 Visual design

- **Dark-only:** apply `.dark` before the first render; no appearance toggle, no light flash, no automatic OS-theme substitution.
- Prefer near-black charcoal and muted dark grey surfaces, subtle borders, modest rounding, precise spacing and restrained transitions. **Gold** is the sole primary/accent colour for focus, selected state, primary CTA and meaningful highlights; never use it indiscriminately.
- Example design tokens (adjust against contrast checks): `--background: #101012`, `--surface: #18181c`, `--surface-raised: #202024`, `--border: #303036`, `--text: #f2f0ea`, `--muted: #a19e99`, `--accent: #c9a75d`, `--accent-foreground: #101012`.
- Typography: restrained sans-serif UI, **Monaco** for C++ editor and code previews. Do not ship Apple’s proprietary Monaco font; use the installed system face and safe fallbacks.
- Eliminate unnecessary section eyebrow text, uppercase micro-headings, verbose onboarding hints, fake dashboard KPIs and ornamental labels. Every visual element should clarify navigation, action or state.
- Use shadcn `Button`, `Dialog`, `Popover`, `Command`, `Tabs`, `Tooltip`, `ScrollArea`, `Separator`, `Resizable` or equivalent primitives as appropriate. Customise their styling; don't replace interactive accessible components with dead divs.

### 6.2 Main layout

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  LeetCode Desktop     [ Search problems…                  ]  [Accounts] │
├────────────────┬──────────────────────────┬─────────────────────────────┤
│ Recent         │ 209. Minimum Size...     │ Solution.cpp                │
│ 209 ...        │ Medium · Sliding Window  │ Monaco C++ editor           │
│ 1658 ...       │ Description              │                             │
│ 2483 ...       │ Examples                 │                             │
│                │ Constraints              ├─────────────────────────────┤
│                │ Hints                    │ Test cases | Results |      │
│                │                          │ Submissions                 │
│                │                          │ Run  Submit  Sync to GitHub │
├────────────────┴──────────────────────────┴─────────────────────────────┤
│ Docs · Settings                                      Connection status │
└─────────────────────────────────────────────────────────────────────────┘
```

- Sidebar collapsible; hide it at narrow widths. Central statement/editor split should be resizable and persist layout preferences. Below the editor, a collapsible, resizable panel presents test cases, execution results and submission history.
- Problem title uses displayed ID and proper title case. Difficulty can have a meaningful subdued colour; tags are compact interactive chips only if they actually filter/search.
- Tabs within the statement: **Description**, **Hints** if present, **Submissions** (or place submission history in the lower panel—choose one consistent location, not duplicate navigations).
- Code defaults to the remote C++ starter template on first visit; an existing local draft always takes precedence thereafter.
- Primary actions: **Run**, **Submit**, and **Sync to GitHub**. Sync is available only once an accepted C++ server-side submission can be identified, and it visibly reports its source submission ID.
- Every feature has proper loading, empty, blocked, offline, network-error and success states. No fake sample data after live wiring.

### 6.3 Keyboard-first accessibility

| Key (macOS / Windows-Linux equivalent) | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open global problem search/command palette |
| `⌘P` / `Ctrl+P` | Switch among recent attempts |
| `⌘1` / `Ctrl+1` | Focus problem description |
| `⌘2` / `Ctrl+2` | Focus Monaco editor |
| `⌘3` / `Ctrl+3` | Focus test/results panel |
| `⌘Enter` / `Ctrl+Enter` | Run the current code |
| `⌘⇧Enter` / `Ctrl+Shift+Enter` | Submit to LeetCode (only if authenticated and available) |
| `⌘S` / `Ctrl+S` | Flush the current draft to disk immediately |
| `Esc` | Close the active dialog/palette, restore prior focus |
| `Tab` / `Shift+Tab` | Traverse interactive UI; inside Monaco, support its explicit **Tab moves focus** mode |

- Avoid overriding native Monaco text-editing commands (especially undo/redo, find, format, indentation). Register editor-scoped commands through Monaco when its focus owns a shortcut; use a central shortcut registry for the app shell.
- shadcn/Radix components must have visible gold focus rings, correct ARIA roles and labels, roving focus where suitable, predictable arrow-key navigation, and no focus traps outside modal dialogs.
- Search option list: `ArrowUp/ArrowDown` to navigate, `Enter` to select, `Esc` to dismiss; restore focus to trigger. Prevent keyboard handlers from firing twice in nested contexts.
- Test with only a keyboard and VoiceOver on macOS. Respect reduced motion; maintain readable contrast and avoid relying only on colour to distinguish judge results.

## 7. Smart problem search and local attempt creation

- Global search uses shadcn `Command`/combobox with a 250–350 ms debounce and cancellable, paginated GraphQL queries. Prefer small result sets (e.g. 20 per page) and do not crawl the entire LeetCode catalogue.
- Recognise numeric frontend ID, exact title slug, partial title, and free text. Rank exact numeric matches, exact titles, prefix matches and then broader matches. Search results show displayed ID, title, difficulty and optionally concise topic tags and solved status when available.
- For a selected result: resolve/validate full problem detail; **upsert one local attempt by account + problem ID**; initialise code from the C++ starter snippet only if no draft exists; record `createdAt`/`lastActivityAt`; open the problem view; include it in Recent.
- Selecting the *same* problem twice must not create duplicate attempts or wipe its editor state. A search query that returns no result must show a useful empty state.
- Cache metadata by slug and remote account appropriately; protect against stale response races when switching problems quickly.
- Keep public search available in disconnected mode if possible; don't promise authenticated data without a valid LeetCode session.

## 8. Editor and 30-day draft persistence

### 8.1 Monaco behaviour

- C++ is the only registered/exposed editable language (`language: 'cpp'`), with syntax highlighting, line numbers, folding, bracket matching, minimap optional (default off), smart indentation, search and editor accessibility support.
- Set `fontFamily: 'Monaco, Menlo, Consolas, monospace'`, `fontSize: 13` or `14`, `automaticLayout: true`, `tabSize: 4`, `insertSpaces: true`, `wordWrap: 'off'`, and a dark theme derived from the app palette.
- Use one Monaco model per active problem URI such as `leetcode://problem/209/solution.cpp`, and persist/restores the source text plus the editor's selection, cursor position and scroll offset when practical. Dispose models on inactivity/removal to prevent memory leaks.
- Maintain an explicit dirty/saving/saved/error state; do not show a false ‘Saved’ message before SQLite confirms the write.

### 8.2 Data schema (initial proposal)

```sql
CREATE TABLE attempts (
  account_key TEXT NOT NULL,
  problem_id INTEGER NOT NULL,
  title_slug TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  draft_cpp TEXT NOT NULL,
  editor_state_json TEXT,
  created_at_ms INTEGER NOT NULL,
  last_activity_at_ms INTEGER NOT NULL,
  last_saved_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_key, problem_id)
);
CREATE INDEX attempts_recent_idx ON attempts(last_activity_at_ms DESC);
```

Separate metadata cache, app settings, and short-lived execution state if justified. Do not store LeetCode session cookies or GitHub tokens in SQLite. Use schema migrations and transaction-safe upserts.

### 8.3 Save policy

- Debounce editor changes by **500 ms**. Save on blur, problem switch, explicit `⌘S`, and normal app-close; cap waiting time so continuous typing is periodically persisted. Await pending writes before destructive navigation when possible.
- `last_activity_at_ms` changes on selecting/creating an attempt or on meaningful editing/running/submitting; passive metadata refresh must **not** refresh its lifetime. The user’s stated interpretation is that selecting a problem begins an attempt.
- **Retention: 30 × 24 hours since last activity.** On startup, and every 24 hours while running, atomically remove attempts where `last_activity_at_ms < now - 30 days`. The Recent list queries this same cutoff and is ordered descending. A newly selected problem counts immediately.
- Expired drafts and their per-problem editor state are deleted; don't quietly keep an alternative backup cache that contradicts the retention rule. Server-side LeetCode submission history remains accessible separately where authorised.
- Test the boundaries at exactly 30 days, over 30 days, clock changes, offline startup and a forced crash immediately after editing. Ensure app crash or disconnected state cannot silently discard buffered edits.

## 9. Run, Submit, results and submission history

- **Run** reads a snapshot of C++ from Monaco, gathers one or more test inputs in the LeetCode format, uses the validated internal REST interface, and shows each available result with output, expected output, runtime, compile error and diagnostic message.
- **Submit** sends the current snapshot through LeetCode’s official website-backed judging endpoint (only when allowed and authenticated) and polls until a terminal judgement or bounded timeout. Explain that submission is an external action; never treat test passing as accepted.
- After a confirmed **Accepted** judgement, refresh remote submission history/stats and enable Sync. Store accepted submission ID and language as references for the present UI state, but re-verify upstream on sync.
- History includes submitted time, judgement, language, runtime/memory when provided, and actions to view **exact submitted source** or restore to the editor (with overwrite confirmation). Filter display to C++ by default, but do not misidentify an accepted non-C++ submission as valid for C++ sync.
- For an expired or unauthorised session, show sign-in/reconnect without deleting drafts. For unsupported premium problems show an appropriate access restriction.

## 10. GitHub authentication and accepted-solution synchronisation

### 10.1 GitHub sign-in

- Use a registered GitHub App or OAuth App supporting the **device authorisation flow**. In Settings, **Connect GitHub** displays the one-time user code and opens `https://github.com/login/device`; poll according to GitHub's required interval, supporting expiry, cancellation and errors.
- Prefer a GitHub App install restricted to **selected repositories** with minimum necessary **Contents: read/write** permission. Avoid broadly scoped personal access tokens and do not bundle a client secret. Persist token securely in the OS secret facility, not localStorage or the solutions repo.
- Fetch accessible repositories/branches, select a destination and verify write access. Clearly show owner/repository/branch in Settings and the sync confirmation/status. Disconnect revokes or forgets local authorisation appropriately, as supported.

### 10.2 Sync contract

**User presses `Sync to GitHub` → source must be the latest server-verified *Accepted C++ submission* for this exact LeetCode problem, not the current Monaco buffer and not merely code that passed Run.**

1. Validate LeetCode sign-in, GitHub sign-in, target repo and branch; identify the correct internal/displayed problem IDs and title slug.
2. Request submission history (paginate as needed), find the **most recently submitted Accepted C++** solution for the problem (even if more recent attempts failed). Require explicit Accepted status and `cpp` language.
3. Fetch the full code for that *exact submission ID* and verify code exists and belongs to the current logged-in user/problem. If no readable accepted C++ submission exists, report that and stop; never fall back to the editor buffer or another language.
4. Map difficulty to one of `easy`, `medium`, `hard`, and file path to exactly `<difficulty>/Problem<frontendId>.cpp`, e.g. `medium/Problem209.cpp`. Do not use the internal judge ID for the filename. This matches the existing solution naming convention after case standardisation.
5. Inspect the destination branch’s tree for an existing file **case-insensitively**, including legacy `problem209.cpp`. If a casing conflict or competing file exists, offer an explicit rename/update resolution. Never create duplicate paths silently. If overwriting a different accepted solution, show a small source/diff preview and require confirmation.
6. Use GitHub’s Contents API (`GET` for existing SHA; `PUT` for create/update with base64 content, expected SHA on update). Fail safely on changed branch, insufficient scope, protected branch, rate limits, missing repo or conflicting SHA. Do **not** force-push or rewrite unrelated commits.
7. Use the **exact commit message format** (GitHub accepts subject and body as one newline-delimited `message` field):

   ```text
   Upload problem 209 to medium/Problem209.cpp

   https://leetcode.com/problems/minimum-size-subarray-sum/
   ```

   More generally: subject `Upload problem [id] to [difficulty]/[filenamewithextension]` and body consisting of the canonical problem URL.
8. After GitHub confirms success, display the commit SHA and a link to the created/updated file and commit. Store the last synchronised submission ID and commit SHA as *non-secret* metadata for clear status and optional duplicate-upload prevention.
9. If identical code is already present, report **Already synchronised** rather than creating a useless duplicate commit. Never claim success before GitHub confirms it.

A crucial distinction: the in-app GitHub Sync performs a deliberate **remote content commit** to the solutions repository; the development workflow in Section 14 uses **incremental local Git commits** to the *Electron application repository*. These are different operations and should not be conflated.

## 11. In-app documentation and onboarding

Build a real **Docs** area, reachable from navigation and `⌘K`, using the same refined UI and accessible headings/links. Bundle these pages locally so essential setup instructions work offline:

1. **Getting Started** — requirements, launching the app, first problem, editor basics, Run vs Submit vs Sync.
2. **Connect LeetCode** — Playwright opens its own Chromium profile, user logs in on the real site, credentials are not requested by the app, session reuse/reconnect, profile location, logout/clear profile, limitations/Terms.
3. **Connect GitHub** — device flow, visible verification code, permissions, repository/branch selection, how to disconnect/revoke access.
4. **GitHub Sync** — why only latest Accepted C++ submission is used; naming convention and commit format; overwrite behaviour; common permission conflicts.
5. **Keyboard Shortcuts** — searchable table with macOS/Windows keys and Monaco Tab-focus behaviour.
6. **Settings & Storage** — dark-only policy, Monaco font fallback, 500 ms autosave, 30-day deletion, reset and privacy.
7. **Troubleshooting** — not signed in, CAPTCHA/challenge requiring browser interaction, HTTP 403/429, judge stuck, premium access, Chromium missing after packaging, database errors, GitHub authorisation and protected-branch failures.
8. **About / API Compatibility** — direct GraphQL and REST architecture, unofficial/unsupported endpoints, API changes, licence/attribution, upstream site links.

Populate the root README with project purpose, feature checklist (accurately indicating implemented vs planned), screenshots from the real app **only when available**, architecture, prerequisites, install/dev/build/test commands, authentication, security and limitations, and links to the full Docs. Keep README truthful rather than advertising mock buttons as working features.

## 12. Error handling, caching and resilience

- Internal error categories: `OFFLINE`, `AUTH_EXPIRED`, `ACCESS_DENIED`, `PREMIUM_LOCKED`, `RATE_LIMITED`, `API_CHANGED`, `JUDGE_FAILED`, `GITHUB_CONFLICT`, `STORAGE_FAILED`, `UNKNOWN`.
- Use clear end-user messages and **Retry / Reconnect / Open on LeetCode** actions where applicable. Keep diagnostic details available in a copyable, redacted troubleshooting view, not scattered through the interface.
- Cache only necessary problem metadata, with bounded TTL and storage budget. Never treat cached remote profile or acceptance statistics as definitely current.
- Limit GraphQL search frequency, paginate remote responses, avoid aggressive bulk fetching and avoid retry storms.
- Restore local drafts regardless of remote connectivity; a failed judge operation must never erase an editor buffer.
- Ensure the app can be quit cleanly during a pending request, with autosave committed and in-flight results clearly non-final.

## 13. Testing and acceptance criteria

### 13.1 Automated tests

- **Unit:** filename generation; frontend/internal ID distinction; search ranking; C++-only filtering; accepted-submission selection; 500 ms debounce; retention boundary at 30 days; commit subject/body; GitHub duplicate detection; Zod validation; error mapping.
- **Integration (fixtures, no live secrets):** GraphQL normalisation and API field drift; Playwright request adapter; authenticated/unauthenticated state transitions; judge polling and cancellation; submission detail fetching; GitHub `GET`/`PUT` with `sha` and conflicting-file handling; migration/SQLite crash recovery.
- **UI:** keyboard-only search and selection; focus return after dialogs; Monaco Tab focus; navigation without lost drafts; proper disabled states; aria names; screen-reader announcements; dark-only contrast; reduced motion.
- **E2E:** launch packaged Electron build; create/search/reopen attempt; draft persistence across restart; retention cleanup; success and failure flows with mocked upstream services. Perform separate opt-in manual live tests if upstream terms and access permit.
- **Security:** renderer cannot access `process`, `fs`, tokens or arbitrary IPC; malicious HTML in problem descriptions is inert; untrusted links open in the external browser; logs redact sensitive values.

### 13.2 Definition of Done

- [ ] macOS Apple Silicon packaged app launches from a clean installation.
- [ ] Entire UI uses the defined dark/gold design; no stray light theme or unsupported language picker.
- [ ] Search lists real matching problem instances; keyboard selection opens the right problem and creates/reuses one local attempt.
- [ ] Description, difficulty/ID, topic tags, hints, examples, constraints and C++ starter code display correctly when upstream supplies them.
- [ ] C++ Monaco editor preserves text per problem across navigation and restart and offers fully functioning keyboard navigation.
- [ ] Debounced drafts are written reliably; attempts inactive more than 30 days are removed from storage and Recent.
- [ ] LeetCode login works without manual cookie pasting and survives normal app restart when the upstream session remains valid.
- [ ] Run vs Submit yields distinguishable, verified results; results/history/code/statistics are real data when available, otherwise show honest restricted/error states.
- [ ] GitHub device-flow login works; user selects a writeable repository and branch.
- [ ] Sync uploads only the latest **Accepted C++ submission**, with correctly cased path and precisely formatted commit subject/body; GitHub confirms SHA.
- [ ] Existing-file updates, casing conflicts, expired login, 403/429 and offline states are handled without data loss.
- [ ] In-app Docs and root README are complete, accurate and linked.
- [ ] Typecheck, lint, unit/integration tests, keyboard/a11y checks, and packaged smoke test pass.
- [ ] Work is committed in multiple meaningful Git commits and pushed to the existing app repository remote without destructive Git operations.

## 14. Implementation phases and Git checkpoints

**Phase 0 — Existing-repository audit and API feasibility (do this before committing to UI promises).** Examine current app files, Git branch, remote and package convention. Verify source naming in the target solutions repo. Build a minimal authenticated LeetCode GraphQL/read spike and one manually initiated Run/Submit/history/code-read check on a permitted test problem/account; record endpoint payloads as redacted fixtures. Check GitHub device flow and Contents permission model. Document exactly which integrations work or are blocked. **Commit:** `docs: record architecture and API feasibility`.

**Phase 1 — Secure Electron skeleton.** Initialise or adapt electron-vite, React, TypeScript, Yarn, Vite worker loading, shadcn, Tailwind, strict preload bridge, CSP and dark design tokens. Add lint/typecheck/test scripts and launch/build smoke. **Commit:** `chore: scaffold secure Electron application`.

**Phase 2 — Design system and keyboard navigation.** Implement shell, sidebar, command/search palette, resizable panels, tabs, keyboard registry, gold focus states, icons, loading/error UI and accessibility tests. No decorative/fake features. **Commit:** `feat: add keyboard-first dark application shell`.

**Phase 3 — Local persistence and C++ editor.** SQLite migrations, Monaco C++ models, per-problem attempts, debounced autosave, flush-on-navigation, retention cleanup, recents, and persistence tests. **Commit:** `feat: persist C++ drafts and recent attempts`.

**Phase 4 — LeetCode metadata and search.** Implement direct GraphQL client, validated problem detail/search, first-visit starter code, description/hints/topics/examples, caching and incomplete-data fallbacks. **Commit:** `feat: integrate LeetCode problem discovery`.

**Phase 5 — LeetCode login, execution and submissions.** Implement Playwright profile login, authenticated shared-cookie requests, CSRF handling, stateful Run/Submit, polling, results, history/code and statistics—subject to the feasibility gate. Add timeout and failure fixtures. **Commit:** `feat: add authenticated judging and submission history`.

**Phase 6 — GitHub login and accepted-code sync.** Device flow, repository/branch selection, secure token storage, last Accepted C++ source lookup, filename casing resolution, GitHub file upsert, exact commit message and confirmation UI. **Commit:** `feat: sync accepted C++ submissions to GitHub`.

**Phase 7 — Docs, packaging and release quality.** In-app Docs, README, examples, screenshots of actual UI, macOS package/signing checks, release testing, CI, security audit, keyboard/VoiceOver QA and design consistency review. **Commit:** `docs: complete onboarding and release documentation` followed by `chore: package and validate desktop release` if packaging requires a separate checkpoint.

**At every phase:** run `yarn typecheck`, `yarn lint`, `yarn test`, and the relevant smoke/e2e checks; review `git diff`, `git status` and staged files; commit only coherent changes; push the existing branch without changing the linked remote. Never commit `.env`, browser profiles, tokens, databases, build outputs, screenshots containing secrets, or stale test fixtures. If a live integration is blocked, record the blocker and ship honest disabled/fallback behaviour—not a pretend completion.

## 15. Final handover

The coding agent should provide: (1) links/SHAs of incremental commits; (2) working build and run commands; (3) test results and packaged-app status; (4) an implementation checklist distinguishing complete, blocked and unverified integrations; (5) any LeetCode endpoint behaviour requiring revalidation; and (6) confirmation that GitHub Sync acts on accepted server-side C++ code, never the unsaved editor buffer.

### Primary reference material

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage/)
- [Playwright BrowserContext](https://playwright.dev/docs/api/class-browsercontext)
- [Playwright APIRequestContext / shared cookies](https://playwright.dev/docs/api/class-apirequestcontext)
- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [GitHub device authorisation flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [LeetCode Terms of Service](https://leetcode.com/terms/)

**Note:** LeetCode GraphQL and judging endpoint shapes cited in the plan are undocumented and potentially unstable. The implementation must verify them at Phase 0, not assert that every query/operation is currently supported.
