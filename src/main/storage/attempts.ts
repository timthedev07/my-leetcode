import {
  attemptSchema,
  persistedEditorStateSchema,
  problemDetailSchema,
  recentAttemptSchema
} from '../../shared/schemas'
import type {
  Attempt,
  PersistedEditorState,
  ProblemDetail
} from '../../shared/types'
import { openDatabase, type AppDatabase } from './database'
import { deleteExpiredAttempts, getAttemptRetentionCutoff } from './retention'
import { getSetting, setSetting } from './settings'

type AttemptRow = {
  account_key: unknown
  problem_id: unknown
  internal_problem_id: unknown
  title_slug: unknown
  title: unknown
  difficulty: unknown
  draft_cpp: unknown
  editor_state_json: unknown
  created_at_ms: unknown
  last_activity_at_ms: unknown
  last_saved_at_ms: unknown
}

type RecentAttemptRow = Omit<AttemptRow, 'draft_cpp' | 'editor_state_json'>

export type RecentAttempt = Omit<Attempt, 'draftCpp' | 'editorState'>

export class AttemptNotFoundError extends Error {
  constructor(accountKey: string, problemId: string) {
    super(`No saved attempt exists for problem ${problemId} and account "${accountKey}".`)
    this.name = 'AttemptNotFoundError'
  }
}

export class CorruptEditorStateError extends Error {
  constructor(problemId: string, cause: unknown) {
    super(`The stored editor state for problem ${problemId} is invalid.`, { cause })
    this.name = 'CorruptEditorStateError'
  }
}

function assertAccountKey(accountKey: string): void {
  if (!accountKey.trim()) {
    throw new Error('An account key is required.')
  }
}

function assertProblemId(problemId: string): void {
  if (!/^\d+$/.test(problemId)) {
    throw new Error('A numeric problem ID is required.')
  }
}

function assertTimestamp(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('The storage timestamp must be a non-negative integer.')
  }
}

function parseEditorState(row: AttemptRow): PersistedEditorState | null {
  if (row.editor_state_json === null) {
    return null
  }

  if (typeof row.editor_state_json !== 'string') {
    throw new CorruptEditorStateError(String(row.problem_id), row.editor_state_json)
  }

  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(row.editor_state_json)
  } catch (error) {
    throw new CorruptEditorStateError(String(row.problem_id), error)
  }

  const parsedState = persistedEditorStateSchema.nullable().safeParse(parsedJson)

  if (!parsedState.success) {
    throw new CorruptEditorStateError(String(row.problem_id), parsedState.error)
  }

  return parsedState.data
}

function rowToAttempt(row: AttemptRow): Attempt {
  return attemptSchema.parse({
    accountKey: row.account_key,
    problemId: row.problem_id,
    internalProblemId: row.internal_problem_id,
    titleSlug: row.title_slug,
    title: row.title,
    difficulty: row.difficulty,
    draftCpp: row.draft_cpp,
    editorState: parseEditorState(row),
    createdAtMs: row.created_at_ms,
    lastActivityAtMs: row.last_activity_at_ms,
    lastSavedAtMs: row.last_saved_at_ms
  })
}

function rowToRecentAttempt(row: RecentAttemptRow): RecentAttempt {
  return recentAttemptSchema.parse({
    accountKey: row.account_key,
    problemId: row.problem_id,
    internalProblemId: row.internal_problem_id,
    titleSlug: row.title_slug,
    title: row.title,
    difficulty: row.difficulty,
    createdAtMs: row.created_at_ms,
    lastActivityAtMs: row.last_activity_at_ms,
    lastSavedAtMs: row.last_saved_at_ms
  })
}

export class AttemptStore {
  private readonly database: AppDatabase
  private closed = false

  constructor(databasePath: string) {
    this.database = openDatabase(databasePath)
  }

  openAttempt(
    accountKey: string,
    problemDetail: ProblemDetail,
    starterCode: string,
    nowMs: number
  ): Attempt {
    assertAccountKey(accountKey)
    assertTimestamp(nowMs)

    const problem = problemDetailSchema.parse(problemDetail)

    this.database
      .prepare(
        `
          INSERT INTO attempts (
            account_key,
            problem_id,
            internal_problem_id,
            title_slug,
            title,
            difficulty,
            draft_cpp,
            editor_state_json,
            created_at_ms,
            last_activity_at_ms,
            last_saved_at_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(account_key, problem_id) DO UPDATE SET
            internal_problem_id = excluded.internal_problem_id,
            title_slug = excluded.title_slug,
            title = excluded.title,
            difficulty = excluded.difficulty,
            last_activity_at_ms = MAX(
              attempts.last_activity_at_ms,
              excluded.last_activity_at_ms
            )
        `
      )
      .run(
        accountKey,
        problem.frontendId,
        problem.internalId,
        problem.titleSlug,
        problem.title,
        problem.difficulty,
        starterCode,
        nowMs,
        nowMs,
        nowMs
      )

    return this.requireAttempt(accountKey, problem.frontendId)
  }

  getAttempt(accountKey: string, problemId: string): Attempt | null {
    assertAccountKey(accountKey)
    assertProblemId(problemId)

    const row = this.database
      .prepare(
        `
          SELECT
            account_key,
            problem_id,
            internal_problem_id,
            title_slug,
            title,
            difficulty,
            draft_cpp,
            editor_state_json,
            created_at_ms,
            last_activity_at_ms,
            last_saved_at_ms
          FROM attempts
          WHERE account_key = ? AND problem_id = ?
        `
      )
      .get(accountKey, problemId) as AttemptRow | undefined

    return row ? rowToAttempt(row) : null
  }

  saveAttempt(
    accountKey: string,
    problemId: string,
    draftCpp: string,
    editorState: PersistedEditorState | null,
    nowMs: number
  ): Attempt {
    assertAccountKey(accountKey)
    assertProblemId(problemId)
    assertTimestamp(nowMs)

    const validatedEditorState = persistedEditorStateSchema
      .nullable()
      .parse(editorState)
    const editorStateJson =
      validatedEditorState === null ? null : JSON.stringify(validatedEditorState)

    this.database
      .prepare(
        `
          UPDATE attempts
          SET
            draft_cpp = ?,
            editor_state_json = ?,
            last_activity_at_ms = MAX(last_activity_at_ms, ?),
            last_saved_at_ms = MAX(last_saved_at_ms, ?)
          WHERE account_key = ? AND problem_id = ?
        `
      )
      .run(
        draftCpp,
        editorStateJson,
        nowMs,
        nowMs,
        accountKey,
        problemId
      )

    return this.requireAttempt(accountKey, problemId)
  }

  listRecent(
    accountKey: string,
    nowMs: number,
    limit: number
  ): RecentAttempt[] {
    assertAccountKey(accountKey)
    assertTimestamp(nowMs)

    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('The recent attempt limit must be a positive integer.')
    }

    const cutoffMs = getAttemptRetentionCutoff(nowMs)
    const rows = this.database
      .prepare(
        `
          SELECT
            account_key,
            problem_id,
            internal_problem_id,
            title_slug,
            title,
            difficulty,
            created_at_ms,
            last_activity_at_ms,
            last_saved_at_ms
          FROM attempts
          WHERE account_key = ? AND last_activity_at_ms >= ?
          ORDER BY last_activity_at_ms DESC, problem_id DESC
          LIMIT ?
        `
      )
      .all(accountKey, cutoffMs, limit) as RecentAttemptRow[]

    return rows.map(rowToRecentAttempt)
  }

  deleteExpired(nowMs: number): number {
    assertTimestamp(nowMs)
    return deleteExpiredAttempts(this.database, nowMs)
  }

  getSetting(key: string): string | null {
    return getSetting(this.database, key)
  }

  setSetting(key: string, value: string): void {
    setSetting(this.database, key, value)
  }

  close(): void {
    if (!this.closed) {
      this.database.close()
      this.closed = true
    }
  }

  private requireAttempt(accountKey: string, problemId: string): Attempt {
    const attempt = this.getAttempt(accountKey, problemId)

    if (!attempt) {
      throw new AttemptNotFoundError(accountKey, problemId)
    }

    return attempt
  }
}
