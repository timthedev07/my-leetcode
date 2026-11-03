import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SubmissionSummary } from '@shared/types'
import {
  isAcceptedSubmission,
  isCppSubmission,
  selectLatestAcceptedCpp,
  SubmissionService
} from '../../src/main/leetcode/submissions'

type SessionMock = ConstructorParameters<typeof SubmissionService>[0]

async function fixture(name: string): Promise<Record<string, unknown>> {
  const content = await readFile(
    resolve(process.cwd(), 'tests', 'fixtures', 'leetcode', name),
    'utf8'
  )
  return JSON.parse(content) as Record<string, unknown>
}

function graphqlResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: value }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function createSession(
  handler: (path: string, init?: RequestInit) => Promise<Response>
): {
  session: SessionMock
  request: ReturnType<typeof vi.fn>
} {
  const request = vi.fn(handler)
  return {
    session: {
      request,
      getCsrfToken: vi.fn(async () => 'redacted-csrf-token')
    } as unknown as SessionMock,
    request
  }
}

function requestBody(init?: RequestInit): {
  query: string
  variables: Record<string, unknown>
} {
  return JSON.parse(String(init?.body)) as {
    query: string
    variables: Record<string, unknown>
  }
}

function submission(overrides: Partial<SubmissionSummary>): SubmissionSummary {
  return {
    id: '100',
    title: 'Two Sum',
    titleSlug: 'two-sum',
    status: 10,
    statusDisplay: 'Accepted',
    timestamp: 1_000,
    language: 'cpp',
    languageName: 'C++',
    runtime: '0 ms',
    memory: '7 MB',
    ...overrides
  }
}

describe('Accepted C++ submission selection', () => {
  it('selects the newest Accepted C++ submission and ignores other languages', () => {
    const selected = selectLatestAcceptedCpp([
      submission({ id: '1', timestamp: 100 }),
      submission({
        id: '2',
        timestamp: 300,
        status: 11,
        statusDisplay: 'Wrong Answer'
      }),
      submission({
        id: '3',
        timestamp: 400,
        language: 'python3',
        languageName: 'Python3'
      }),
      submission({ id: '4', timestamp: 200 })
    ])

    expect(selected?.id).toBe('4')
  })

  it('requires both an explicit Accepted status and the cpp language identifier', () => {
    expect(isAcceptedSubmission(submission({ status: null, statusDisplay: 'Accepted' }))).toBe(
      true
    )
    expect(
      isAcceptedSubmission(submission({ status: 11, statusDisplay: 'Wrong Answer' }))
    ).toBe(false)
    expect(
      isAcceptedSubmission(submission({ status: 11, statusDisplay: 'Accepted' }))
    ).toBe(false)
    expect(isCppSubmission(submission({ language: 'cpp' }))).toBe(true)
    expect(
      isCppSubmission(submission({ language: 'python3', languageName: 'C++' }))
    ).toBe(false)
  })

  it('paginates past non-C++ results before loading the exact submitted source', async () => {
    const detailFixture = await fixture('submission-detail.json')
    const { session, request } = createSession(async (_path, init) => {
      const body = requestBody(init)
      if (body.query.includes('submissionDetails')) {
        return graphqlResponse(detailFixture)
      }

      if (body.variables.lastKey === 'page-2') {
        return graphqlResponse({
          submissionList: {
            lastKey: null,
            hasNext: false,
            submissions: [
              {
                id: 24_681_012,
                title: 'Two Sum',
                titleSlug: 'two-sum',
                status: 10,
                statusDisplay: 'Accepted',
                timestamp: 1_762_300_000,
                lang: 'cpp',
                langName: 'C++',
                runtime: '0 ms',
                memory: '7.3 MB'
              }
            ]
          }
        })
      }

      return graphqlResponse({
        submissionList: {
          lastKey: 'page-2',
          hasNext: true,
          submissions: [
            {
              id: 99,
              title: 'Two Sum',
              titleSlug: 'two-sum',
              status: 10,
              statusDisplay: 'Accepted',
              timestamp: 1_762_400_000,
              lang: 'python3',
              langName: 'Python3',
              runtime: '20 ms',
              memory: '17 MB'
            },
            {
              id: 98,
              title: 'Two Sum',
              titleSlug: 'two-sum',
              status: 11,
              statusDisplay: 'Wrong Answer',
              timestamp: 1_762_350_000,
              lang: 'cpp',
              langName: 'C++',
              runtime: null,
              memory: null
            }
          ]
        }
      })
    })
    const service = new SubmissionService(session)

    const result = await service.findLatestAcceptedCpp('two-sum')

    expect(result).toMatchObject({
      id: '24681012',
      titleSlug: 'two-sum',
      language: 'cpp',
      code: expect.stringContaining('twoSum')
    })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('returns null instead of falling back when only a non-C++ submission is Accepted', async () => {
    const { session, request } = createSession(async (_path, init) => {
      const body = requestBody(init)
      if (body.query.includes('submissionDetails')) {
        throw new Error('Submission detail must not be requested for a non-C++ result')
      }
      return graphqlResponse({
        submissionList: {
          lastKey: null,
          hasNext: false,
          submissions: [
            {
              id: 99,
              title: 'Two Sum',
              titleSlug: 'two-sum',
              status: 10,
              statusDisplay: 'Accepted',
              timestamp: 1_762_400_000,
              lang: 'java',
              langName: 'Java',
              runtime: '1 ms',
              memory: '42 MB'
            }
          ]
        }
      })
    })
    const service = new SubmissionService(session)

    await expect(service.findLatestAcceptedCpp('two-sum')).resolves.toBeNull()
    expect(request).toHaveBeenCalledOnce()
  })

  it('maps current-user profile statistics from the authenticated account', async () => {
    const { session } = createSession(async (_path, init) => {
      const body = requestBody(init)
      if (body.query.includes('globalData')) {
        return graphqlResponse({
          userStatus: { isSignedIn: true, username: 'redacted-user' }
        })
      }
      return graphqlResponse({
        matchedUser: {
          profile: {
            ranking: 42_000,
            realName: 'Redacted User',
            userAvatar: 'https://assets.leetcode.com/users/redacted/avatar.png'
          },
          submitStatsGlobal: {
            acSubmissionNum: [
              { difficulty: 'All', count: 120, submissions: 240 },
              { difficulty: 'Medium', count: 70, submissions: 150 },
              { difficulty: 'Easy', count: 50, submissions: 90 }
            ]
          }
        }
      })
    })
    const service = new SubmissionService(session)

    const statistics = await service.getCurrentUserStatistics()

    expect(statistics).toEqual({
      username: 'redacted-user',
      ranking: 42_000,
      realName: 'Redacted User',
      avatarUrl: 'https://assets.leetcode.com/users/redacted/avatar.png',
      byDifficulty: [
        { difficulty: 'All', solved: 120, attempted: 240 },
        { difficulty: 'Easy', solved: 50, attempted: 90 },
        { difficulty: 'Medium', solved: 70, attempted: 150 }
      ]
    })
  })

  it('rejects signed-out profile access with AUTH_EXPIRED', async () => {
    const { session } = createSession(async () =>
      graphqlResponse({
        userStatus: { isSignedIn: false, username: null }
      })
    )
    const service = new SubmissionService(session)

    await expect(service.getCurrentUserStatistics()).rejects.toMatchObject({
      code: 'AUTH_EXPIRED'
    })
  })
})
