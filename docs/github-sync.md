# GitHub Synchronisation

## Source of truth

GitHub sync never uploads the current Monaco buffer and never uploads a successful Run result.

For every preview and every write, the app:

1. paginates LeetCode submission history for the selected problem;
2. selects the latest submission that is both **Accepted** and written in **C++**;
3. retrieves the source attached to that exact submission ID from LeetCode;
4. verifies its problem, language and status again.

If no readable Accepted C++ submission exists, no GitHub write occurs.

## Path and commit format

The destination path is:

```text
<difficulty>/Problem<frontendId>.cpp
```

For example, problem 209 with difficulty Medium maps to `medium/Problem209.cpp`.

The complete commit message is:

```text
Upload problem 209 to medium/Problem209.cpp

https://leetcode.com/problems/minimum-size-subarray-sum/
```

## Existing files

The app inspects the destination tree case-insensitively. It does not silently create a second file when only casing differs.

- If the existing file contains identical code, the result is **Already synchronised** and no commit is made.
- If differing code exists, the accepted source and remote file are shown before an explicit overwrite confirmation.
- If an existing filename differs only by casing, the app stops and asks you to rename the file in GitHub before retrying.

GitHub’s Contents API verifies the current file SHA. A conflicting branch change fails safely rather than overwriting unrelated work.

Success is displayed only after GitHub returns a commit SHA.

## Common conflicts

- Protected branches require a pull request and reject direct Contents API writes.
- A token without repository contents write permission receives an access error.
- A stale file SHA receives a conflict and no overwrite.
- Repository or branch names must be selected and verified in Settings before syncing.

