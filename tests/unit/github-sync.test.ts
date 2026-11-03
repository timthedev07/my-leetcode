import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { SubmissionDetail } from '@shared/types'
import type { RepositoryService } from '../../src/main/github/repository'
import { GitHubSyncService, buildCommitMessage, buildSolutionPath } from '../../src/main/github/sync'

const accepted: SubmissionDetail = {
  id: '9001',
  title: 'Minimum Size Subarray Sum',
  titleSlug: 'minimum-size-subarray-sum',
  status: 10,
  statusDisplay: 'Accepted',
  timestamp: 1_700_000_000,
  language: 'cpp',
  languageName: 'C++',
  runtime: '4 ms',
  memory: '10 MB',
  code: 'class Solution { public: int answer = 42; };',
  frontendProblemId: '209'
}

const syncInput = {
  problemSlug: accepted.titleSlug,
  frontendProblemId: accepted.frontendProblemId,
  difficulty: 'Medium' as const
}

function createService(options: {
  remoteCode?: string | null
  remotePath?: string
  fetch?: ReturnType<typeof vi.fn>
}) {
  const remotePath = options.remotePath ?? 'medium/Problem209.cpp'
  const remoteCode = options.remoteCode ?? null
  const fetchMock =
    options.fetch ??
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree:
            remoteCode === null
              ? []
              : [{ path: remotePath, type: 'blob', sha: 'blob-sha' }],
          truncated: false
        })
      }
      if (url.includes('/contents/') && (!init?.method || init.method === 'GET')) {
        return Response.json({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(remoteCode ?? '', 'utf8').toString('base64'),
          sha: 'file-sha',
          html_url: `https://github.com/tim/leetcode/blob/dev/${remotePath}`,
          path: remotePath
        })
      }
      if (url.includes('/contents/') && init?.method === 'PUT') {
        return Response.json({
          content: {
            html_url: `https://github.com/tim/leetcode/blob/dev/${remotePath}`,
            path: remotePath
          },
          commit: {
            sha: 'commit-sha',
            html_url: 'https://github.com/tim/leetcode/commit/commit-sha'
          }
        })
      }
      return new Response(null, { status: 404 })
    })
  const repositoryService = {
    verifyPushPermission: vi.fn(async () => ({
      owner: 'tim',
      name: 'leetcode',
      fullName: 'tim/leetcode',
      private: false,
      defaultBranch: 'dev',
      canPush: true
    }))
  } as unknown as RepositoryService
  const submissionService = {
    findLatestAcceptedCpp: vi.fn(async () => accepted)
  }
  const onSynced = vi.fn()
  const service = new GitHubSyncService({
    getToken: () => 'token',
    repositoryService,
    submissionService: submissionService as never,
    getSettings: async () => ({ repository: 'tim/leetcode', branch: 'dev' }),
    fetch: fetchMock as unknown as (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>,
    onSynced
  })
  return { service, fetchMock, onSynced, repositoryService }
}

describe('GitHub accepted-solution synchronisation', () => {
  it('uses the frontend ID, difficulty path and exact commit format', () => {
    expect(buildSolutionPath('Medium', '209')).toBe('medium/Problem209.cpp')
    expect(buildCommitMessage('209', 'medium/Problem209.cpp', 'minimum-size-subarray-sum')).toBe(
      'Upload problem 209 to medium/Problem209.cpp\n\nhttps://leetcode.com/problems/minimum-size-subarray-sum/'
    )
  })

  it('creates a file from the server-recorded accepted C++ source', async () => {
    const { service, fetchMock, onSynced, repositoryService } = createService({})

    const outcome = await service.execute(syncInput, false)

    expect(repositoryService.verifyPushPermission).toHaveBeenCalledWith('tim/leetcode', 'dev')
    expect(outcome).toMatchObject({
      result: 'created',
      submissionId: '9001',
      commitSha: 'commit-sha',
      path: 'medium/Problem209.cpp'
    })
    expect(onSynced).toHaveBeenCalledWith('9001', 'commit-sha')

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(putCall).toBeDefined()
    const body = JSON.parse(String(putCall?.[1]?.body)) as {
      message: string
      content: string
      branch: string
      sha?: string
    }
    expect(body.message).toBe(
      'Upload problem 209 to medium/Problem209.cpp\n\nhttps://leetcode.com/problems/minimum-size-subarray-sum/'
    )
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe(accepted.code)
    expect(body.branch).toBe('dev')
    expect(body.sha).toBeUndefined()
  })

  it('reports already synchronised without creating a duplicate commit', async () => {
    const { service, fetchMock } = createService({ remoteCode: accepted.code })

    await expect(service.execute(syncInput, false)).resolves.toMatchObject({
      result: 'already-synchronised',
      commitSha: null,
      path: 'medium/Problem209.cpp'
    })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('requires explicit overwrite confirmation and uses the verified file SHA', async () => {
    const { service, fetchMock } = createService({ remoteCode: 'class Solution {};' })

    await expect(service.execute(syncInput, false)).rejects.toMatchObject({
      code: 'GITHUB_CONFLICT'
    })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)

    await expect(service.execute(syncInput, true)).resolves.toMatchObject({
      result: 'updated',
      commitSha: 'commit-sha'
    })
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const body = JSON.parse(String(putCall?.[1]?.body)) as { sha?: string }
    expect(body.sha).toBe('file-sha')
  })

  it('refuses to create a duplicate when only casing differs', async () => {
    const { service } = createService({
      remoteCode: accepted.code,
      remotePath: 'medium/problem209.cpp'
    })

    await expect(service.execute(syncInput, true)).rejects.toMatchObject({
      code: 'GITHUB_CONFLICT',
      message: expect.stringContaining('different casing')
    })
  })
})

