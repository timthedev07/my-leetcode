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
- Panel sizes and the Recent sidebar state persist between launches.
- **Run** tests the current C++ snapshot against your custom test input.
- **Submit** performs an external LeetCode submission after confirmation.
- **Format** applies the saved local clang-format configuration.
- **Standard/Vim** switches keybindings without replacing the Monaco model.
- **Sync to GitHub** is available only when a latest Accepted C++ submission can be verified.

## First setup

1. Open **Accounts** and connect LeetCode.
2. Open **Settings** and configure the public GitHub OAuth client ID.
3. Connect GitHub and verify a writable repository and branch.
4. Open a problem, write C++, and submit until LeetCode records an Accepted result.
5. Use **Sync to GitHub** and review the source and destination before confirming.

See [LeetCode Authentication](leetcode-authentication.md), [GitHub Authentication](github-authentication.md) and [GitHub Synchronisation](github-sync.md).
Editor behaviour is covered in [Vim and C++ Formatting](vim-and-formatting.md).

