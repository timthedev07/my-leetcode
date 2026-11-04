# Troubleshooting

## LeetCode does not connect

- Complete login in the Playwright window.
- Handle any official LeetCode challenge directly in that window.
- If the session expired, select **Reconnect LeetCode**.
- Signing in again is normally required only after LeetCode invalidates the
  session, the dedicated profile is cleared, or **Disconnect** is selected.
- A GitHub login made in the dedicated window is stored there; the app does not
  use cookies from your everyday Chrome profile.
- Confirm the dedicated Chromium resource exists by running `yarn install:browser` in development.
- If LeetCode returns 403 or 429, wait and use **Open LeetCode**. The app does not bypass restrictions.

## Problem search fails

Search requires network access to `https://leetcode.com/graphql`. Try a more specific problem number or slug. A schema-change error means LeetCode changed an undocumented response; drafts remain safe.

## Run or Submit is unavailable

The action requires a connected and validated LeetCode account. A passed custom Run is not an Accepted submission.

If judging times out, use the Cancel action and retry once. Repeated requests can trigger rate limits.

For an unexpected judge response in development, inspect:

```text
~/Library/Application Support/LeetCode Desktop/development.log
```

The `leetcode:judge` entries identify the response field and validation path
that changed without recording source code or authentication secrets.

## Vim command behaves differently

`monaco-vim` implements a CodeMirror-compatible subset rather than full
Neovim. Switch to Standard mode if a compound command does not behave as
expected. The current Vim source remains in the draft.

## Formatting is unavailable

- Open **Settings → Formatting** and confirm that the YAML is valid.
- Restore or reset the configuration if the stored file cannot be read.
- A failed formatter leaves the editor unchanged.
- Formatting does not require network access; contact with a remote formatter
  is never attempted.

## Submission source is unavailable

History can list a submission whose source is restricted or no longer available. The app reports that state and does not substitute editor text.

## GitHub sign-in fails

- Confirm Device Flow is enabled on the OAuth App.
- Confirm you entered the public client ID, not a client secret.
- Complete the one-time code before it expires.
- On `slow_down`, wait for the service to poll at GitHub’s requested interval.
- If multiple accounts are signed in through the browser, use a private window for the intended
  account and approve a new code.
- A revoked or rejected refresh credential is cleared; select **Disconnect** and connect again.

## GitHub sync fails

- Verify the destination in Settings.
- Confirm the token can write repository contents.
- Confirm the selected branch contains a compatible `data/progress.json`. The app does not create
  this file automatically.
- Protected branches may require a pull request instead of a direct commit.
- Multiple C++ files for one problem, or a case-only filename mismatch, must be resolved in GitHub
  before retrying.
- A conflict means the branch or files changed. The app refetches and retries safely within a
  bounded limit without force-pushing.
- If the app reports that progress is incompatible, run the solutions repository's validation:

```bash
python3 scripts/update_readme.py --check
```

The Python command belongs to the solutions repository, not the packaged Electron application.

## Up Next does not load

- Connect GitHub and verify a repository and branch in Settings.
- Confirm the branch contains valid `data/progress.json`.
- Confirm the GitHub account can read the repository.
- Use the Refresh action in the Up Next header to retry.
- When existing recommendations remain visible with a stale warning, the latest network request
  failed. Treat the displayed statistics as potentially out of date.
- Up Next and completion statistics come from the configured repository, not local Recent
  attempts and not LeetCode's own completion status.

## README is stale after a successful sync

The solution and progress commit succeeded if the app shows a commit SHA. README regeneration is a
separate GitHub Actions stage.

- Open the repository's **Actions** tab.
- Inspect the `Synchronise LeetCode README` workflow run for the `dev` push.
- Confirm Actions are enabled and allowed to write repository contents.
- Correct any progress validation or README-marker failure shown in the run.
- Rerun the workflow after correcting repository configuration.

Do not rerun the desktop synchronisation merely because README generation failed.

## Database or storage error

Quit and relaunch the application. Local source is never stored in the renderer or browser profile. If the database file is corrupt, preserve a copy before removing it from application data so no diagnostic evidence is lost.

## Diagnostic information

Error messages are intentionally redacted. Development diagnostics are written
to the path shown under **Run or Submit is unavailable**. Do not paste cookies,
browser-profile contents, GitHub tokens or unredacted request headers into a
public issue.

