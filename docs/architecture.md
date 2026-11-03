# Architecture

## Process boundaries

The renderer is a sandboxed React application. It has no Node integration, no file system access and no arbitrary IPC. A narrow preload bridge exposes named operations backed by main-process handlers.

The main process owns:

- LeetCode GraphQL and REST requests;
- Playwright browser contexts and cookies;
- C++ judge state and polling;
- submission history and remote statistics;
- GitHub device flow, tokens and REST writes;
- SQLite drafts, retention and settings.

## Data flow

Search and problem-detail responses are validated with Zod before normalisation. Problem HTML is sanitised in the main process. The renderer receives only internal problem models.

Judge operations store immutable snapshots of source and custom input. Polling is bounded and cancellable. A Run result and Submit result remain semantically distinct.

GitHub sync revalidates authentication, destination permission, the latest Accepted C++ submission and the remote file state before writing.

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

