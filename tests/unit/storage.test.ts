import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AttemptStore,
  CorruptEditorStateError
} from '../../src/main/storage/attempts'
import { ATTEMPT_RETENTION_MS } from '../../src/main/storage/retention'
import { UnsafeSettingError } from '../../src/main/storage/settings'
import type {
  PersistedEditorState,
  ProblemDetail
} from '../../src/shared/types'

const EDITOR_STATE: PersistedEditorState = {
  cursor: { lineNumber: 4, column: 7 },
  selection: {
    start: { lineNumber: 2, column: 1 },
    end: { lineNumber: 4, column: 7 }
  },
  scrollTop: 96
}

function problemDetail(overrides: Partial<ProblemDetail> = {}): ProblemDetail {
  return {
    frontendId: '209',
    internalId: '209',
    title: 'Minimum Size Subarray Sum',
    titleSlug: 'minimum-size-subarray-sum',
    difficulty: 'Medium',
    acceptanceRate: 49.2,
    isPaidOnly: false,
    topicTags: [{ name: 'Array', slug: 'array' }],
    contentHtml: '<p>Find the minimum length.</p>',
    hints: [],
    starterCode: 'class Solution {};',
    exampleTestCases: ['7\n[2,3,1,2,4,3]'],
    ...overrides
  }
}

describe('AttemptStore', () => {
  let temporaryDirectory: string
  let databasePath: string
  let store: AttemptStore

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'leetcode-storage-'))
    databasePath = join(temporaryDirectory, 'app.db')
    store = new AttemptStore(databasePath)
  })

  afterEach(() => {
    store.close()
    rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('keeps one attempt and preserves an existing draft when reopened', () => {
    const createdAt = 1_700_000_000_000
    const savedAt = createdAt + 500
    const reopenedAt = createdAt + 1_000

    const created = store.openAttempt(
      'account-a',
      problemDetail(),
      'starter code',
      createdAt
    )
    expect(created.draftCpp).toBe('starter code')
    expect(created.editorState).toBeNull()

    store.saveAttempt(
      'account-a',
      '209',
      'edited code',
      EDITOR_STATE,
      savedAt
    )

    const reopened = store.openAttempt(
      'account-a',
      problemDetail({ title: 'Updated problem title' }),
      'replacement starter code',
      reopenedAt
    )

    expect(reopened).toMatchObject({
      draftCpp: 'edited code',
      editorState: EDITOR_STATE,
      createdAtMs: createdAt,
      lastActivityAtMs: reopenedAt,
      lastSavedAtMs: savedAt,
      title: 'Updated problem title'
    })

    store.close()
    const rawDatabase = new Database(databasePath, { readonly: true })
    const count = rawDatabase
      .prepare(
        'SELECT COUNT(*) AS count FROM attempts WHERE account_key = ? AND problem_id = ?'
      )
      .get('account-a', '209') as { count: number }
    expect(count.count).toBe(1)
    rawDatabase.close()
  })

  it('orders recent attempts by activity while filtering the exact retention cutoff', () => {
    const nowMs = 1_800_000_000_000
    const cutoffMs = nowMs - ATTEMPT_RETENTION_MS

    store.openAttempt(
      'account-a',
      problemDetail({ frontendId: '1', internalId: '1', title: 'Older retained' }),
      'starter one',
      nowMs - 2_000
    )
    store.openAttempt(
      'account-a',
      problemDetail({ frontendId: '2', internalId: '2', title: 'Newest retained' }),
      'starter two',
      nowMs - 1_000
    )
    store.openAttempt(
      'account-a',
      problemDetail({
        frontendId: '3',
        internalId: '3',
        title: 'Exactly at cutoff'
      }),
      'starter three',
      cutoffMs
    )
    store.openAttempt(
      'account-a',
      problemDetail({ frontendId: '4', internalId: '4', title: 'Expired' }),
      'starter four',
      cutoffMs - 1
    )

    const recent = store.listRecent('account-a', nowMs, 10)

    expect(recent.map((attempt) => attempt.problemId)).toEqual(['2', '1', '3'])
    expect(recent.find((attempt) => attempt.problemId === '1')).toMatchObject({
      title: 'Older retained',
      difficulty: 'Medium'
    })
  })

  it('expires attempts older than 30 days but retains the exact boundary', () => {
    const nowMs = 1_800_000_000_000
    const cutoffMs = nowMs - ATTEMPT_RETENTION_MS

    store.openAttempt(
      'account-a',
      problemDetail({ frontendId: '10', internalId: '10' }),
      'boundary starter',
      cutoffMs
    )
    store.openAttempt(
      'account-a',
      problemDetail({ frontendId: '11', internalId: '11' }),
      'expired starter',
      cutoffMs - 1
    )

    expect(store.getAttempt('account-a', '10')?.draftCpp).toBe('boundary starter')
    expect(store.getAttempt('account-a', '11')?.draftCpp).toBe('expired starter')
    expect(store.deleteExpired(nowMs)).toBe(1)
    expect(store.getAttempt('account-a', '10')?.draftCpp).toBe('boundary starter')
    expect(store.getAttempt('account-a', '11')).toBeNull()
  })

  it('reports corrupt editor JSON without discarding the draft', () => {
    const nowMs = 1_800_000_000_000
    store.openAttempt('account-a', problemDetail(), 'safe draft', nowMs)
    store.saveAttempt('account-a', '209', 'safe draft', EDITOR_STATE, nowMs + 1)
    store.close()

    const rawDatabase = new Database(databasePath)
    rawDatabase
      .prepare(
        'UPDATE attempts SET editor_state_json = ? WHERE account_key = ? AND problem_id = ?'
      )
      .run('{invalid json', 'account-a', '209')
    rawDatabase.close()

    store = new AttemptStore(databasePath)

    expect(() => store.getAttempt('account-a', '209')).toThrow(
      CorruptEditorStateError
    )

    store.close()
    const verificationDatabase = new Database(databasePath, { readonly: true })
    const row = verificationDatabase
      .prepare(
        'SELECT draft_cpp FROM attempts WHERE account_key = ? AND problem_id = ?'
      )
      .get('account-a', '209') as { draft_cpp: string }
    expect(row.draft_cpp).toBe('safe draft')
    verificationDatabase.close()
  })

  it('round-trips settings and rejects credential-like keys', () => {
    expect(store.getSetting('layout')).toBeNull()

    store.setSetting('layout', 'split')
    expect(store.getSetting('layout')).toBe('split')

    store.setSetting('layout', 'stacked')
    expect(store.getSetting('layout')).toBe('stacked')
    expect(() => store.setSetting('githubToken', 'not-a-secret')).toThrow(
      UnsafeSettingError
    )
  })

  it('uses WAL, schema versioning and non-credential tables', () => {
    store.close()

    const rawDatabase = new Database(databasePath, { readonly: true })
    expect(rawDatabase.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(rawDatabase.pragma('user_version', { simple: true })).toBe(1)

    const columns = rawDatabase.pragma('table_info(attempts)') as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['token', 'cookie', 'password', 'credentials'])
    )
    rawDatabase.close()
  })
})
