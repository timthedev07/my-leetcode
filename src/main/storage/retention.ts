import type Database from 'better-sqlite3'

export const ATTEMPT_RETENTION_DAYS = 30
export const ATTEMPT_RETENTION_MS = ATTEMPT_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function getAttemptRetentionCutoff(nowMs: number): number {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('The retention timestamp must be a non-negative integer.')
  }

  return nowMs - ATTEMPT_RETENTION_MS
}

export function deleteExpiredAttempts(
  database: Database.Database,
  nowMs: number
): number {
  const cutoffMs = getAttemptRetentionCutoff(nowMs)
  const result = database
    .prepare('DELETE FROM attempts WHERE last_activity_at_ms < ?')
    .run(cutoffMs)

  return result.changes
}
