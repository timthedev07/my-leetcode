# GitHub Authentication

This guide explains how to create a GitHub OAuth App, connect LeetCode Desktop to your GitHub
account, and select the repository used for synchronisation. It does not explain how to create a
solutions repository.

The desktop application uses GitHub's OAuth Device Flow. It never asks for your GitHub password and
does not run a local callback web server.

## Before you begin

You need:

- a GitHub account that can access the destination repository;
- permission to push to the selected repository and branch;
- a browser signed in to the GitHub account you intend to use.

If multiple GitHub accounts are signed in through your browser, GitHub may choose the wrong account.
Use a private browser window or switch accounts before approving the device code.

## Step 1: Open GitHub developer settings

1. Sign in to GitHub in a browser.
2. Open your account menu in the top-right corner.
3. Select **Settings**.
4. In the left sidebar, select **Developer settings**.
5. Select **OAuth Apps**.
6. Select **New OAuth App**.

The direct registration page is [GitHub OAuth Apps](https://github.com/settings/developers).

## Step 2: Register the OAuth application

Complete the form as follows:

- **Application name:** use a recognisable name such as `LeetCode Desktop`.
- **Homepage URL:** use a URL you control. A project repository or project homepage is suitable.
- **Application description:** optional. For example, `Synchronises accepted LeetCode solutions
  and learning progress to my repository.`
- **Authorisation callback URL:** GitHub requires this field to be present. Device Flow does not
  redirect to this address, so use your homepage URL or another HTTPS URL you control. This
  application does not run a callback server on your computer.

Select **Register application**.

## Step 3: Enable Device Flow

Open the new OAuth App's settings and enable **Device Flow**.

Device Flow displays a short one-time code in LeetCode Desktop. You enter that code on GitHub and
approve the requested permissions. The desktop application polls GitHub until approval succeeds,
is denied, or the code expires. This avoids embedding a client secret in the desktop application.

Do not create or enter a client secret. A client secret is confidential server-side configuration
and must never be stored in LeetCode Desktop or committed to a repository.

## Step 4: Find the Client ID

On the OAuth App settings page, copy the **Client ID**.

The Client ID identifies the public application registration. It is not an access token and does
not grant access by itself.

## Step 5: Enter the Client ID in LeetCode Desktop

1. Open LeetCode Desktop.
2. Open **Settings** from the footer.
3. Select the **GitHub** tab.
4. Paste the OAuth App Client ID into **Public OAuth client ID**.
5. Select **Save**.
6. Select **Connect**.

Only the public Client ID is stored in ordinary application settings. Access and refresh tokens are
kept in encrypted main-process credential storage.

## Step 6: Approve authorisation

1. LeetCode Desktop displays a one-time device code and copies it to the clipboard.
2. The app opens `https://github.com/login/device`.
3. Sign in as the intended GitHub account.
4. Enter the displayed device code.
5. Review the requested permissions.
6. Approve access.
7. Return to LeetCode Desktop.

The app requests the `repo` and `read:user` scopes. `repo` can include access to private
repositories, so review the account and repository permissions before approving.

Wait for the GitHub account panel to show **Connected**. If the code expires, start the connection
again to receive a new code.

## Step 7: Verify the account

The GitHub tab displays the connected GitHub username. Confirm that this is the account with access
to your solutions repository.

To change accounts:

1. Select **Disconnect** in LeetCode Desktop.
2. Sign out of the unwanted account, or use a private browser window for the intended account.
3. Connect again and approve a new device code.

## Step 8: Select and verify the destination

After connection, choose an accessible repository and branch in the GitHub tab, then select
**Verify destination**.

For the primary progress repository, use:

```text
Repository: timthedev07/leetcode
Branch: dev
```

The selected repository must contain a compatible `data/progress.json`. The app does not create a
new progress file and does not silently fall back to solution-only synchronisation.

The branch must permit direct Git reference updates. Protected branches that require pull requests
cannot be updated by the synchronisation commit.

## Step 9: Test synchronisation

1. Open a problem that has an Accepted C++ submission recorded by LeetCode.
2. Select **Sync to GitHub**.
3. Review the problem, submission ID, destination, solution path, changed files, and progress
   changes.
4. Confirm the synchronisation.

The app reads the latest Accepted C++ submission from LeetCode. It never uploads the current editor
buffer and never treats a Run result as an accepted submission.

A successful result means the solution file and `data/progress.json` were included in one commit.
For `timthedev07/leetcode` on `dev`, the existing GitHub Actions workflow then regenerates
`README.md`. The application reports README regeneration as pending rather than claiming that it
has already completed.

## Token expiry and refresh

GitHub may return an access-token expiry and a refresh token. When supported by the authorisation
response, LeetCode Desktop stores both credentials securely and refreshes the access token before it
expires. Rotated refresh credentials replace the previous values atomically.

If a refresh token is expired, revoked, or rejected, the app clears the unusable credentials and
asks you to connect GitHub again. Valid non-expiring credentials continue to work.

OAuth Apps and GitHub Apps use different permission models and token options. This guide documents
the OAuth App Device Flow used by the application; it does not imply that the two app types are
interchangeable.

## Disconnect and revoke access

**Disconnect** removes the encrypted GitHub credentials from this computer. It does not revoke the
authorisation on GitHub.

To revoke the grant at GitHub:

1. Open GitHub **Settings**.
2. Open **Applications**.
3. Select the OAuth App used by LeetCode Desktop.
4. Revoke access.

## Security

- Never enter your GitHub password in LeetCode Desktop.
- Never enter a client secret in LeetCode Desktop.
- Never commit access tokens, refresh tokens, client secrets, or credential files.
- Review OAuth scopes carefully. Repository access may include private repositories.
- Keep access and refresh tokens in secure main-process storage.
- Do not expose tokens to the renderer, documentation, screenshots, or logs.
- Disconnect locally when the computer is no longer trusted.

## Troubleshooting

### Invalid Client ID

Confirm that the value is the OAuth App **Client ID**, not the Client Secret and not an access
token. Re-copy it from the OAuth App settings and save it again.

### Device Flow is not enabled

Open the OAuth App settings and enable **Device Flow**. Restart the connection attempt after saving
the change.

### Device code is incorrect or expired

Codes are one-time values and expire. Start the connection again, copy the new code, and approve it
promptly.

### Authorisation was denied

Approve access for the intended account, or ask a repository owner to grant the account access.
Reconnect to obtain a fresh code.

### Token expired or was revoked

Select **Disconnect**, then **Connect** and approve a new device code. If refresh credentials were
present but rejected, the app clears them rather than repeatedly using invalid credentials.

### Repository is missing from the selection list

Confirm that the signed-in GitHub account can access the repository. Private repositories require a
token with suitable repository access. Organisation restrictions can also hide repositories.

### Private repository access is denied

Review the OAuth grant and organisation access policy. An organisation may require approval of the
OAuth App before it can access private repositories.

### Insufficient write permission

The account needs push permission on the selected repository. A read-only collaborator can browse
the repository but cannot synchronise.

### Branch protection prevents writes

The synchronisation uses a normal, non-forced branch reference update. Protected branches that
require pull requests or prohibit the GitHub account from direct pushes will reject it. Choose an
allowed branch or update the repository rules.

### Authentication succeeds but synchronisation fails

Authentication proves who you are; it does not prove that the destination supports the progress
contract or that the branch can be updated. Check repository access, `data/progress.json`, write
permission, branch protection, and workflow permissions separately.

### Network failure or ambiguous response

Retry after checking your connection. If GitHub received a branch update but the response was lost,
the app re-reads the branch and confirms the commit before deciding whether to retry.

### Browser is signed in to multiple GitHub accounts

GitHub may approve the code for the wrong account. Disconnect in LeetCode Desktop, use a private
browser window for the intended account, and approve a new code.
