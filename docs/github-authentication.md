# GitHub Authentication

## Register an OAuth application

Create a GitHub OAuth App or GitHub App from GitHub’s developer settings and enable device authorisation. The application needs repository contents read/write access for the repositories you choose.

Only the public client ID is entered in LeetCode Desktop. Never place a client secret in the app, an environment file or the solutions repository.

## Device flow

1. Open **Settings**.
2. Enter the public OAuth client ID.
3. Select **Connect**.
4. The app copies the one-time code and opens `https://github.com/login/device`.
5. Enter and approve the code in GitHub.
6. Return to the app; the account status updates after GitHub confirms the token.

Device polling respects GitHub’s required interval and expiry. Denied or expired requests produce a new, actionable error.

## Secure storage

GitHub tokens are encrypted through Electron’s `safeStorage` facility and written to an owner-only file under application data. If operating-system encryption is unavailable, the app refuses to save the token.

## Repository and branch

After connection, choose a repository where the account has push permission. Select a branch and use **Verify destination**. The application confirms branch existence and write access before it stores the configuration.

## Disconnect

**Disconnect** removes the encrypted local token. Use GitHub’s authorised applications settings as well if you want to revoke the OAuth grant at the provider.

