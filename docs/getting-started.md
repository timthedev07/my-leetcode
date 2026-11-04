# Getting Started

## Install and launch

1. Install Node.js 22.12 or newer and enable Corepack.
2. Run `yarn install`.
3. Run `yarn dev` for development or install the packaged application for normal use.

The first launch creates a SQLite database and a dedicated LeetCode browser profile under Electron’s application data directory.

## Open a problem

Press `⌘K`, or select the search field. Search by displayed problem number, title, slug or topic. Choose a result with the arrow keys and `Enter`.

Selecting a problem creates one local attempt. Reopening the same problem restores its draft and never creates a duplicate.

## Workspace

- The problem statement and editor can be resized horizontally.
- The editor and test panel can be resized vertically.
- Panel sizes and the sidebar state persist between launches.
- **Up Next** shows the five earliest incomplete curated problems from the configured
  repository's `data/progress.json`.
- **Recent** continues to show locally opened attempts; it is not presented as completed progress.
- **Run** tests the current C++ snapshot against your custom test input.
- **Submit** performs an external LeetCode submission after confirmation.
- **Format** applies the saved local clang-format configuration.
- **Standard/Vim** switches keybindings without replacing the Monaco model.
- **Sync to GitHub** is available only when a latest Accepted C++ submission can be verified and
  the selected repository supports the progress JSON contract.

## First setup

1. Open **Accounts** and connect LeetCode.
2. Create a GitHub OAuth App with Device Flow enabled, then copy its public Client ID.
3. Open **Settings → GitHub**, enter the Client ID, and select **Connect**.
4. Approve the one-time device code in GitHub.
5. Verify the connected GitHub account.
6. Select `timthedev07/leetcode` on `dev`, or another compatible repository and branch, then select
   **Verify destination**.
7. Open a problem, write C++, and submit until LeetCode records an Accepted result.
8. Use **Sync to GitHub** and review the solution and progress changes before confirming.

The Up Next list loads from the configured repository when GitHub is connected. A successful
synchronisation refreshes the list, statistics, and completion state. Clicking a recommendation
opens the problem through the normal LeetCode workspace flow.

See [LeetCode Authentication](leetcode-authentication.md), [GitHub Authentication](github-authentication.md) and [GitHub Synchronisation](github-sync.md).
Editor behaviour is covered in [Vim and C++ Formatting](vim-and-formatting.md).

