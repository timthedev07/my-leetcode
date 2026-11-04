# LeetCode Authentication

## Sign in

Open **Accounts** and select **Connect**. The application launches a dedicated Playwright Chromium window at `https://leetcode.com/`.

Sign in through the real LeetCode website, including any official multi-factor prompt or challenge. The application does not request your password and does not attempt to bypass challenges.

## Session restoration

After a successful login, the app stores only the dedicated browser profile. On later launches it reopens that profile and validates the session with a small authenticated profile query.

There is no fixed sign-in interval imposed by LeetCode Desktop. The app does not
sign you out when it quits and does not tie authentication to the 30-day draft
retention period. Normally, you remain signed in until LeetCode invalidates or
revokes the session.

You will be asked to authenticate again only when:

- LeetCode expires or revokes the saved session;
- LeetCode requires an official re-authentication challenge;
- the dedicated browser profile is cleared;
- you select **Disconnect**;
- cookies are removed manually from the dedicated browser profile.

The application does not read cookies from your everyday Chrome profile. A
GitHub sign-in completed inside the dedicated LeetCode browser is stored in that
same profile and should be reusable when LeetCode needs to authenticate through
GitHub again. GitHub may still request authentication when it expires its own
session or invalidates its cookies.

If LeetCode expires the session:

- local drafts remain available;
- the connection status changes to **Session expired**;
- authenticated Run, Submit and history actions show a reconnect state;
- selecting **Reconnect** opens the official site again.

## Disconnect

**Disconnect** closes the Playwright browser and, after confirmation, deletes its dedicated profile. This removes the saved LeetCode session. Local drafts are unaffected.

## Privacy and limitations

Cookies and CSRF values remain in the main process and are never exposed through IPC. The app uses no cookie-copying workflow.

LeetCode’s internal GraphQL and judge endpoints are undocumented. Access can be blocked by service changes, rate limits, terms enforcement or browser challenges. When that happens, the app reports the condition and offers **Open LeetCode** instead of simulating success.

