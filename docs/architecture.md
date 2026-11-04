# Architecture

## Process boundaries

The renderer is a sandboxed React application. It has no Node integration, no file system access and no arbitrary IPC. A narrow preload bridge exposes named operations backed by main-process handlers.

The main process owns:

- LeetCode GraphQL and REST requests;
- Playwright browser contexts and cookies;
- C++ judge state and polling;
- submission history and remote statistics;
- GitHub device flow, encrypted access and refresh credentials, progress validation, and REST
  writes;
- SQLite drafts, retention and settings.
- persistent non-secret editor preferences and the `.clang-format` file.

## Data flow

Search and problem-detail responses are validated with Zod before normalisation. Problem HTML is sanitised in the main process. The renderer receives only internal problem models.

Judge operations store immutable snapshots of source and custom input. Polling is bounded and cancellable. A Run result and Submit result remain semantically distinct.

GitHub sync revalidates authentication, destination permission, the latest Accepted C++ submission,
the branch revision, the destination file, and the authoritative progress JSON before writing.

## GitHub progress service

`src/main/github/progress.ts` owns the version 1 `data/progress.json` contract. It parses JSON with
Zod, validates semantic invariants and referenced solution files, calculates curated statistics, and
returns the five earliest incomplete curated problems by `order`.

The main process returns only repository, branch, revision, statistics, and recommendation fields
through IPC. It never returns the access token, refresh token, arbitrary API URLs, or unrestricted
file operations to the renderer.

The renderer uses React Query with a repository-and-branch query key. The Up Next section refreshes
on initial configuration, repository or branch changes, GitHub reconnection, explicit Refresh, and
successful synchronisation.

## Atomic GitHub transactions

A synchronisation preview is rebuilt during execution, so the latest Accepted C++ submission and
branch revision are revalidated. The write uses the GitHub Git Data API:

1. read the branch HEAD commit and tree;
2. read the solution file and progress JSON from that exact tree;
3. build the immutable solution and progress blobs;
4. create one tree and one commit containing both changes;
5. update the branch reference without force;
6. re-read the branch to confirm the new commit.

A rejected reference update causes a full refetch and rebuild within a bounded retry limit. An
ambiguous network response is resolved by checking whether the intended commit is now the branch
HEAD. The app never force-pushes and never reports success from a stale branch snapshot.

For `timthedev07/leetcode` on `dev`, a progress commit triggers the repository's existing
`sync-progress.yml` workflow. The application reports this stage as pending and does not execute or
duplicate the Python README renderer.

The renderer hosts Monaco and a dedicated `monaco-vim` adapter. Disposing Vim
removes its listeners without replacing the model. C++ formatting runs in a
Vite Web Worker containing the locally bundled clang-format WebAssembly engine;
only a version-checked Monaco text edit is returned to the editor.

## Security controls

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- restrictive Content Security Policy
- approved external URL allowlist
- sender validation for every IPC invoke and event
- Zod validation at network and IPC boundaries
- no cookies or tokens in renderer state
- OS-protected GitHub token storage
- restrictive file permissions for persistent secrets

## Persistence

SQLite uses WAL mode, transactional schema migrations, primary keys for account/problem attempts and a shared 30-day cutoff for cleanup and Recent queries.

Playwright uses a dedicated persistent profile below Electron userData. It never reads another browser’s profile.

