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

- Confirm device flow is enabled on the GitHub App or OAuth App.
- Confirm you entered the public client ID, not a client secret.
- Complete the one-time code before it expires.
- On `slow_down`, wait for the service to poll at GitHub’s requested interval.

## GitHub sync fails

- Verify the destination in Settings.
- Confirm the token can write repository contents.
- Protected branches may require a pull request instead of a direct commit.
- A case-only filename mismatch must be resolved by renaming the existing file.
- A conflict means the branch or file changed; review it in GitHub and retry.

## Database or storage error

Quit and relaunch the application. Local source is never stored in the renderer or browser profile. If the database file is corrupt, preserve a copy before removing it from application data so no diagnostic evidence is lost.

## Diagnostic information

Error messages are intentionally redacted. Do not paste cookies, browser-profile contents, GitHub tokens or unredacted request headers into a public issue.

