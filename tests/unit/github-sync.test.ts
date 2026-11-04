import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { SubmissionDetail } from '@shared/types'
import type { GitHubProgressService, ProgressDocument, ProgressSnapshot } from '../../src/main/github/progress'
import type { RepositoryService } from '../../src/main/github/repository'
import {
  GitHubSyncService,
  buildCommitMessage,
  buildSolutionPath
} from '../../src/main/github/sync'

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

type FetchMock = ReturnType<typeof vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>>

function progressDocument(options: {
  done?: boolean
  solutionPath?: string | null
  javaPath?: string | null
  extraProblem?: boolean
} = {}): ProgressDocument {
  return {
    version: 1,
    target_count: 2,
    phases: [
      {
        number: 1,
        title: 'Foundations',
        description: 'Build the foundations.'
      }
    ],
    problems: [
      {
        id: 209,
        name: 'Minimum Size Subarray Sum',
        slug: 'minimum-size-subarray-sum',
        difficulty: 'Medium',
        phase: 1,
        order: 1,
        done: options.done ?? false,
        solution_path: options.solutionPath ?? null
      },
      {
        id: 704,
        name: 'Binary Search',
        slug: 'binary-search',
        difficulty: 'Medium',
        phase: 1,
        order: 2,
        done: true,
        solution_path: options.javaPath ?? 'medium/Problem704.java'
      }
    ],
    ...(options.extraProblem
      ? {
          problems: [
            {
              id: 7,
              name: 'Reverse Integer',
              slug: 'reverse-integer',
              difficulty: 'Medium',
              phase: null,
              order: null,
              done: true,
              solution_path: 'medium/Problem7.java'
            }
          ]
        }
      : {})
  }
}

function snapshot(options: {
  document?: ProgressDocument
  headSha?: string
  treeSha?: string
  remotePath?: string | null
  includeJava?: boolean
} = {}): ProgressSnapshot {
  const document = options.document ?? progressDocument()
  const files = [
    { path: 'data/progress.json', sha: 'progress-blob' },
    { path: 'medium/Problem704.java', sha: 'java-blob' }
  ]
  if (options.remotePath) files.push({ path: options.remotePath, sha: 'solution-blob' })
  if (options.includeJava) files.push({ path: 'medium/Problem209.java', sha: 'legacy-java-blob' })
  return {
    destination: { repository: 'timthedev07/leetcode', branch: 'dev' },
    headSha: options.headSha ?? 'head-1',
    treeSha: options.treeSha ?? 'tree-1',
    progressBlobSha: 'progress-blob',
    document,
    files
  }
}

function createHarness(options: {
  remoteCode?: string | null
  remotePath?: string | null
  document?: ProgressDocument
  snapshots?: ProgressSnapshot[]
  patchStatuses?: number[]
  patchMessages?: string[]
  patchNetworkErrors?: boolean[]
  blobFailure?: boolean
  submission?: SubmissionDetail | null
  pushDenied?: boolean
  maxAttempts?: number
} = {}) {
  const remotePath =
    options.remotePath ?? (options.remoteCode ? 'medium/Problem209.cpp' : null)
  const snapshots = options.snapshots ?? [
    snapshot({
      ...(options.document ? { document: options.document } : {}),
      remotePath
    })
  ]
  let snapshotIndex = 0
  let blobIndex = 0
  let patchIndex = 0
  let currentHead = snapshots.at(-1)?.headSha ?? 'head-1'
  const blobs: Array<{ sha: string; content: string }> = []
  let treeBody: Record<string, unknown> | null = null
  let commitBody: Record<string, unknown> | null = null
  let referenceBody: Record<string, unknown> | null = null

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/contents/')) {
      const path = decodeURIComponent(url.split('/contents/')[1]!.split('?')[0]!)
      const content =
        path === remotePath
          ? options.remoteCode ?? ''
          : 'class Solution {};'
      return Response.json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha: 'file-sha',
        html_url: `https://github.com/tim/leetcode/blob/dev/${path}`,
        path
      })
    }
    if (url.endsWith('/git/blobs')) {
      if (options.blobFailure) {
        return Response.json({ message: 'denied' }, { status: 403 })
      }
      const body = JSON.parse(String(init?.body)) as { content: string }
      const sha = `blob-${++blobIndex}`
      blobs.push({
        sha,
        content: Buffer.from(body.content, 'base64').toString('utf8')
      })
      return Response.json({ sha })
    }
    if (url.endsWith('/git/trees')) {
      treeBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ sha: 'tree-new' })
    }
    if (url.endsWith('/git/commits')) {
      commitBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ sha: 'commit-new' })
    }
    if (url.includes('/git/refs/heads/')) {
      referenceBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (options.patchNetworkErrors?.[patchIndex]) {
        patchIndex += 1
        currentHead = 'commit-new'
        throw new TypeError('network disconnected after write')
      }
      const status = options.patchStatuses?.[patchIndex] ?? 200
      const message = options.patchMessages?.[patchIndex] ?? 'conflict'
      patchIndex += 1
      if (status !== 200) return Response.json({ message }, { status })
      currentHead = 'commit-new'
      return Response.json({ object: { sha: 'commit-new' } })
    }
    if (url.includes('/git/ref/heads/')) {
      return Response.json({ object: { sha: currentHead } })
    }
    return Response.json({ message: 'not found' }, { status: 404 })
  }) as FetchMock

  const loadSnapshot = vi.fn(async () => {
    const selected = snapshots[Math.min(snapshotIndex, snapshots.length - 1)]!
    snapshotIndex += 1
    return selected
  })
  const progressService = { loadSnapshot } as unknown as GitHubProgressService
  const repositoryService = {
    verifyPushPermission: options.pushDenied
      ? vi.fn(async () => {
          throw Object.assign(new Error('denied'), { code: 'ACCESS_DENIED' })
        })
      : vi.fn(async () => ({
          owner: 'tim',
          name: 'leetcode',
          fullName: 'tim/leetcode',
          private: false,
          defaultBranch: 'dev',
          canPush: true
        }))
  } as unknown as RepositoryService
  const submissionService = {
    findLatestAcceptedCpp: vi.fn(async () => options.submission === undefined ? accepted : options.submission)
  }
  const onSynced = vi.fn()
  const service = new GitHubSyncService({
    getToken: () => 'token',
    repositoryService,
    submissionService: submissionService as never,
    getSettings: async () => ({ repository: 'timthedev07/leetcode', branch: 'dev' }),
    progressService,
    fetch: fetchMock,
    onSynced,
    maxAttempts: options.maxAttempts ?? 3
  })
  return {
    service,
    fetchMock,
    loadSnapshot,
    onSynced,
    repositoryService,
    submissionService,
    blobs,
    getTreeBody: () => treeBody,
    getCommitBody: () => commitBody,
    getReferenceBody: () => referenceBody
  }
}

describe('GitHub accepted-solution synchronisation', () => {
  it('uses the frontend ID, difficulty path and exact commit format', () => {
    expect(buildSolutionPath('Medium', '209')).toBe('medium/Problem209.cpp')
    expect(buildCommitMessage('209', 'medium/Problem209.cpp', 'minimum-size-subarray-sum')).toBe(
      'Upload problem 209 to medium/Problem209.cpp\n\nhttps://leetcode.com/problems/minimum-size-subarray-sum/'
    )
  })

  it('commits the solution and progress JSON in one Git Data transaction', async () => {
    const harness = createHarness({ remoteCode: null })

    const preview = await harness.service.prepare(syncInput)
    expect(preview).toMatchObject({
      solutionAction: 'create',
      progressAction: 'update',
      previousDone: false,
      curated: true,
      changedFiles: ['medium/Problem209.cpp', 'data/progress.json']
    })

    const outcome = await harness.service.execute(syncInput, false, accepted.id)

    expect(outcome).toMatchObject({
      result: 'created',
      commitSha: 'commit-new',
      solutionAction: 'create',
      progressAction: 'update',
      readmeStatus: 'pending'
    })
    expect(harness.onSynced).toHaveBeenCalledWith('9001', 'commit-new')
    expect(harness.blobs).toHaveLength(2)
    expect(harness.blobs[0]?.content).toBe(accepted.code)
    const progress = JSON.parse(harness.blobs[1]!.content) as ProgressDocument
    expect(progress.problems[0]).toMatchObject({
      id: 209,
      phase: 1,
      order: 1,
      done: true,
      solution_path: 'medium/Problem209.cpp'
    })
    expect(harness.getTreeBody()).toMatchObject({
      base_tree: 'tree-1',
      tree: [
        { path: 'medium/Problem209.cpp', mode: '100644', type: 'blob', sha: 'blob-1' },
        { path: 'data/progress.json', mode: '100644', type: 'blob', sha: 'blob-2' }
      ]
    })
    expect(harness.getCommitBody()).toMatchObject({
      tree: 'tree-new',
      parents: ['head-1']
    })
    expect(harness.getReferenceBody()).toEqual({ sha: 'commit-new', force: false })
    expect(
      harness.fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')
    ).toBe(false)
  })

  it('repairs progress when the C++ solution already has identical content', async () => {
    const harness = createHarness({ remoteCode: accepted.code })

    const outcome = await harness.service.execute(syncInput, false, accepted.id)

    expect(outcome).toMatchObject({
      result: 'updated',
      solutionAction: 'unchanged',
      progressAction: 'update',
      changedFiles: ['data/progress.json']
    })
    expect(harness.blobs).toHaveLength(1)
    expect(harness.getTreeBody()).toMatchObject({
      tree: [{ path: 'data/progress.json', mode: '100644', type: 'blob', sha: 'blob-1' }]
    })
    expect(harness.getCommitBody()?.message).toContain('Update progress for problem 209')
  })

  it('returns already synchronised when both source and progress are correct', async () => {
    const harness = createHarness({
      remoteCode: accepted.code,
      document: progressDocument({
        done: true,
        solutionPath: 'medium/Problem209.cpp'
      })
    })

    await expect(harness.service.execute(syncInput, false, accepted.id)).resolves.toMatchObject({
      result: 'already-synchronised',
      changedFiles: []
    })
    expect(harness.blobs).toHaveLength(0)
    expect(harness.fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('updates existing differing code only after overwrite confirmation', async () => {
    const harness = createHarness({ remoteCode: 'class Solution { public: int old = 1; };' })

    await expect(harness.service.execute(syncInput, false, accepted.id)).rejects.toMatchObject({
      code: 'GITHUB_CONFLICT'
    })
    expect(harness.blobs).toHaveLength(0)

    await expect(harness.service.execute(syncInput, true, accepted.id)).resolves.toMatchObject({
      solutionAction: 'update'
    })
    expect(harness.blobs).toHaveLength(2)
  })

  it('adds accepted uncurated problems without changing target_count or order', async () => {
    const uncuratedAccepted = {
      ...accepted,
      id: '912',
      title: 'Sort an Array',
      titleSlug: 'sort-an-array',
      frontendProblemId: '912'
    }
    const harness = createHarness({ submission: uncuratedAccepted })

    await harness.service.execute(
      {
        problemSlug: uncuratedAccepted.titleSlug,
        frontendProblemId: uncuratedAccepted.frontendProblemId,
        difficulty: 'Medium'
      },
      false,
      uncuratedAccepted.id
    )

    const progress = JSON.parse(harness.blobs[1]!.content) as ProgressDocument
    expect(progress.target_count).toBe(2)
    expect(progress.problems.at(-1)).toMatchObject({
      id: 912,
      phase: null,
      order: null,
      done: true,
      solution_path: 'medium/Problem912.cpp'
    })
  })

  it('preserves a legacy Java path and creates the accepted C++ path', async () => {
    const harness = createHarness({
      document: progressDocument({ javaPath: 'medium/Problem704.java' }),
      remoteCode: null
    })

    await harness.service.execute(syncInput, false, accepted.id)

    const progress = JSON.parse(harness.blobs[1]!.content) as ProgressDocument
    expect(progress.problems[1]?.solution_path).toBe('medium/Problem704.java')
    expect(progress.problems[0]?.solution_path).toBe('medium/Problem209.cpp')
  })

  it('rejects duplicate C++ files without making any write', async () => {
    const base = snapshot()
    const harness = createHarness({
      snapshots: [
        {
          ...base,
          files: [
            ...base.files,
            { path: 'medium/Problem209.cpp', sha: 'first' },
            { path: 'easy/Problem209.cpp', sha: 'second' }
          ]
        }
      ]
    })

    await expect(harness.service.prepare(syncInput)).rejects.toMatchObject({
      code: 'GITHUB_CONFLICT'
    })
    expect(harness.blobs).toHaveLength(0)
  })

  it('refuses a case-only path conflict', async () => {
    const harness = createHarness({ remotePath: 'medium/problem209.cpp', remoteCode: accepted.code })

    await expect(harness.service.prepare(syncInput)).rejects.toMatchObject({
      message: expect.stringContaining('different casing')
    })
  })

  it('refetches the branch and retries after a rejected reference update', async () => {
    const first = snapshot()
    const second = snapshot({ headSha: 'head-2', treeSha: 'tree-2' })
    const harness = createHarness({
      snapshots: [first, second],
      patchStatuses: [422, 200]
    })

    await expect(harness.service.execute(syncInput, false, accepted.id)).resolves.toMatchObject({
      commitSha: 'commit-new'
    })
    expect(harness.loadSnapshot).toHaveBeenCalledTimes(2)
  })

  it('stops after the bounded conflict retry limit', async () => {
    const harness = createHarness({
      patchStatuses: [422, 422],
      maxAttempts: 2
    })

    await expect(harness.service.execute(syncInput, false, accepted.id)).rejects.toMatchObject({
      code: 'GITHUB_CONFLICT',
      message: expect.stringContaining('changed repeatedly')
    })
  })

  it('reports protected-branch rejection as a permission problem', async () => {
    const harness = createHarness({
      patchStatuses: [422],
      patchMessages: ['Protected branch hook declined']
    })

    await expect(harness.service.execute(syncInput, false, accepted.id)).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      message: expect.stringContaining('repository rules')
    })
    expect(harness.loadSnapshot).toHaveBeenCalledTimes(1)
  })

  it('handles a lost network response by confirming the branch head', async () => {
    const harness = createHarness({ patchNetworkErrors: [true] })

    await expect(harness.service.execute(syncInput, false, accepted.id)).resolves.toMatchObject({
      commitSha: 'commit-new'
    })
    expect(harness.loadSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not mutate the repository when blob creation fails', async () => {
    const harness = createHarness({ blobFailure: true })

    await expect(harness.service.execute(syncInput, false, accepted.id)).rejects.toMatchObject({
      code: 'ACCESS_DENIED'
    })
    expect(harness.getTreeBody()).toBeNull()
    expect(harness.getCommitBody()).toBeNull()
    expect(harness.getReferenceBody()).toBeNull()
  })

  it('rejects missing accepted submissions and mismatched metadata', async () => {
    const missing = createHarness({ submission: null })
    await expect(missing.service.prepare(syncInput)).rejects.toMatchObject({
      code: 'ACCESS_DENIED'
    })

    const rejected = createHarness({
      submission: { ...accepted, statusDisplay: 'Wrong Answer' }
    })
    await expect(rejected.service.prepare(syncInput)).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      message: expect.stringContaining('does not match')
    })
  })

  it('stops if a newer accepted submission replaces the reviewed source', async () => {
    const harness = createHarness({
      submission: { ...accepted, id: '9002' }
    })

    await expect(
      harness.service.execute(syncInput, false, '9001')
    ).rejects.toMatchObject({
      code: 'GITHUB_CONFLICT',
      message: expect.stringContaining('submission changed')
    })
    expect(harness.blobs).toHaveLength(0)
  })

  it('reports denied push permission before reading progress or writing', async () => {
    const harness = createHarness({ pushDenied: true })

    await expect(harness.service.prepare(syncInput)).rejects.toMatchObject({
      code: 'ACCESS_DENIED'
    })
    expect(harness.loadSnapshot).not.toHaveBeenCalled()
  })
})
