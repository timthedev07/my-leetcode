# GitHub Synchronisation

## Accepted submissions only

GitHub synchronisation never uploads the current Monaco editor buffer and never treats a successful
Run as an accepted submission.

For every preview and write, LeetCode Desktop:

1. selects the latest server-recorded submission that is both **Accepted** and written in C++;
2. fetches the source attached to that exact submission ID;
3. validates the problem ID, slug, status, and language;
4. refetches progress from the exact GitHub branch revision used for the transaction.

If no readable Accepted C++ submission exists, no GitHub write occurs.

## Authoritative progress

`data/progress.json` on the selected branch is the single source of truth for completion, solution
paths, progressive order, phases, and recommendations.

The application validates:

- schema version `1`;
- unique numerical problem IDs;
- consecutive phases and a complete progressive order;
- one `phase` and `order` for each curated problem;
- `phase: null` and `order: null` for additional problems;
- repository-relative solution paths;
- the existence of referenced solution files;
- completion only when `done` is true.

Unknown metadata is preserved. `README.md` is a generated view and is not read as a second source
of truth.

The app does not create a missing progress file. A repository without a compatible
`data/progress.json` is reported as unsupported instead of receiving a solution-only fallback.

## Preview

The review dialog shows:

- problem name and LeetCode ID;
- Accepted submission ID;
- repository and branch;
- destination solution path;
- whether the solution will be created, updated, or left unchanged;
- previous and new completion state;
- whether the problem belongs to the curated 500;
- whether the progress entry will be updated or added;
- the exact files included in the commit;
- source and existing code when available.

Different existing C++ code is replaced only after explicit confirmation through the review action.
The app does not silently overwrite a conflicting file.

## Atomic solution and JSON commit

The destination path for a new accepted C++ solution is:

```text
easy/Problem<ID>.cpp
medium/Problem<ID>.cpp
hard/Problem<ID>.cpp
```

The app uses the GitHub Git Data API:

1. reads the branch HEAD and commit tree;
2. reads the tree and progress file at that exact revision;
3. builds the solution blob and immutable updated progress document;
4. creates one tree containing both changed paths;
5. creates one commit with the original HEAD as its parent;
6. updates the branch reference without force;
7. confirms that the branch points to the new commit.

The solution file and `data/progress.json` are therefore committed together. If either side cannot
be prepared, neither side is committed.

## Existing entries

Existing problems are located by numerical LeetCode ID, never by title, slug, position, or file
path.

An update changes only:

```json
{
  "done": true,
  "solution_path": "the committed C++ path"
}
```

The problem name, slug, difficulty, phase, order, premium flag, and any unrecognised metadata are
preserved. Other array entries keep their relative order.

If a problem is absent, it is appended as an additional completed problem:

```json
{
  "phase": null,
  "order": null,
  "done": true
}
```

The curated 500 are never renumbered, and `target_count` is never changed for an additional
problem.

## Duplicate and unchanged files

The app checks every C++ file whose filename matches `Problem<ID>.cpp`, case-insensitively.

- No match: create the standard path.
- One match: use and, if required, update that actual C++ path.
- Multiple matches: stop with a conflict and change nothing.
- Case-only path mismatch: stop and ask for the path casing to be corrected.

Existing Java and other legacy solution paths are not deleted. When a new accepted C++ solution is
committed, the progress entry points to the committed C++ file.

The explicit result cases are:

- **New solution, incomplete progress:** commit the solution and progress together.
- **Different existing solution:** require confirmation, then commit the replacement and progress
  together.
- **Identical solution, incomplete progress:** commit the progress correction alone.
- **Identical solution and correct progress:** return `already-synchronised` without a commit.
- **Additional problem absent from progress:** append the additional record and commit it with the
  solution.

## Conflict detection and retries

The branch reference update is non-forced. If another client changes the branch first, GitHub
rejects the update.

The app then:

1. refetches the new HEAD, tree, solution file, and progress JSON;
2. rebuilds the transaction from that new revision;
3. retries within a bounded limit.

It never reuses an outdated tree or progress snapshot and never force-pushes. If changes continue
to conflict, the result is an actionable conflict error and no success is reported.

If the network fails after GitHub may have accepted the reference update, the app rereads the branch
head. The commit is reported as successful only when the new commit is actually present.

The execution request also carries the Accepted submission ID shown in the preview. If LeetCode
records a newer Accepted C++ submission before execution, the app stops and asks for a fresh review
instead of silently committing different source.

## README generation

The solutions repository owns the README workflow in
`.github/workflows/sync-progress.yml`. A push that changes `data/progress.json` on `dev` triggers
the existing workflow, which validates progress data and runs `scripts/update_readme.py`.

LeetCode Desktop does not run Python and does not duplicate the README renderer.

After a commit, the app reports README regeneration as:

- **pending** for the primary `timthedev07/leetcode` repository on `dev`;
- **not applicable** when the repository or branch is not configured for that workflow;
- **not needed** when progress JSON did not change.

A solution-and-progress commit is not described as a completed README update. A failing workflow
remains separate from the successful repository commit.

Branch protection, restricted Actions permissions, or a disabled workflow can prevent README
regeneration. Review the repository's Actions run in that case.

## Troubleshooting

### Progress is unsupported or corrupt

Confirm that the selected branch contains a valid `data/progress.json`. Run the solution
repository's tests and:

```bash
python3 scripts/update_readme.py --check
```

Correct the JSON and validation failure before synchronising again.

### The branch changed during synchronisation

Another client or application instance updated the branch. Retry after reviewing the latest
progress. The app has already attempted bounded safe rebuilds without forcing the branch.

### The branch update is refused

Check write permission and branch protection. The token must be able to push directly to the
selected branch. A pull-request-only rule cannot accept the app's reference update.

### The action fails after the commit

The solution and progress commit still succeeded. Open the repository's Actions run for
`Synchronise LeetCode README`, inspect its logs, and rerun it after correcting repository
configuration. Do not rerun the desktop synchronisation merely because the workflow failed.
