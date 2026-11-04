import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { SubmissionDetail } from '@shared/types'
import { GitHubProgressService, type ProgressDocument } from '../../src/main/github/progress'
import type { RepositoryService } from '../../src/main/github/repository'
import { GitHubSyncService } from '../../src/main/github/sync'

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

const initialProgress: ProgressDocument = {
  version: 1,
  target_count: 2,
  phases: [{ number: 1, title: 'Foundations', description: 'Start here.' }],
  problems: [
    {
      id: 209,
      name: 'Minimum Size Subarray Sum',
      slug: 'minimum-size-subarray-sum',
      difficulty: 'Medium',
      phase: 1,
      order: 1,
      done: false,
      solution_path: null
    },
    {
      id: 704,
      name: 'Binary Search',
      slug: 'binary-search',
      difficulty: 'Medium',
      phase: 1,
      order: 2,
      done: false,
      solution_path: null
    }
  ]
}

describe('GitHub progress integration', () => {
  it('loads recommendations, commits solution and JSON atomically, then advances Up Next', async () => {
    let headSha = 'head-0'
    const commits = new Map([
      ['head-0', 'tree-0']
    ])
    const trees = new Map<string, Array<{ path: string; type: string; sha: string }>>([
      ['tree-0', [{ path: 'data/progress.json', type: 'blob', sha: 'progress-0' }]]
    ])
    const progressByTree = new Map<string, ProgressDocument>()
    const blobs = new Map<string, string>()
    const progressDocuments = new Map([[headSha, initialProgress]])
    const filePaths = new Map([['data/progress.json', 'data/progress.json']])
    let blobCount = 0
    let treeCount = 0
    let commitCount = 0

    const fetchGitHub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/git/ref/heads/dev')) {
        return Response.json({ object: { sha: headSha, type: 'commit' } })
      }
      if (url.includes('/git/refs/heads/dev')) {
        const body = JSON.parse(String(init?.body)) as { sha: string; force: boolean }
        expect(body.force).toBe(false)
        headSha = body.sha
        return Response.json({ object: { sha: headSha } })
      }
      if (url.includes('/git/commits/')) {
        const sha = url.split('/git/commits/')[1]!
        return Response.json({ tree: { sha: commits.get(sha) } })
      }
      if (url.endsWith('/git/commits')) {
        const body = JSON.parse(String(init?.body)) as { tree: string; parents: string[] }
        const sha = `commit-${++commitCount}`
        commits.set(sha, body.tree)
        progressDocuments.set(
          sha,
          progressByTree.get(body.tree) ??
            progressDocuments.get(body.parents[0]!) ??
            initialProgress
        )
        return Response.json({ sha })
      }
      if (url.includes('/git/trees/')) {
        const treeSha = url.split('/git/trees/')[1]!.split('?')[0]!
        return Response.json({ tree: trees.get(treeSha), truncated: false })
      }
      if (url.endsWith('/git/trees')) {
        const body = JSON.parse(String(init?.body)) as {
          base_tree: string
          tree: Array<{ path: string; mode: string; type: string; sha: string }>
        }
        const treeSha = `tree-${++treeCount}`
        const files = [...(trees.get(body.base_tree) ?? [])]
        for (const entry of body.tree) {
          const index = files.findIndex((file) => file.path === entry.path)
          if (index === -1) files.push(entry)
          else files[index] = entry
        }
        trees.set(treeSha, files)
        for (const entry of body.tree) {
          if (entry.path === 'data/progress.json') {
            filePaths.set('data/progress.json', entry.sha)
            const content = blobs.get(entry.sha)
            if (content) {
              progressByTree.set(treeSha, JSON.parse(content) as ProgressDocument)
            }
          } else {
            filePaths.set(entry.path, entry.path)
          }
        }
        return Response.json({ sha: treeSha })
      }
      if (url.endsWith('/git/blobs')) {
        const body = JSON.parse(String(init?.body)) as { content: string }
        const sha = `blob-${++blobCount}`
        blobs.set(sha, Buffer.from(body.content, 'base64').toString('utf8'))
        return Response.json({ sha })
      }
      if (url.includes('/contents/data/progress.json')) {
        const document = progressDocuments.get(headSha) ?? initialProgress
        const content = JSON.stringify(document)
        return Response.json({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(content, 'utf8').toString('base64'),
          sha: filePaths.get('data/progress.json') ?? 'progress-0',
          html_url: 'https://github.com/timthedev07/leetcode/blob/dev/data/progress.json',
          path: 'data/progress.json'
        })
      }
      if (url.endsWith('/git/ref/heads/dev')) {
        return Response.json({ object: { sha: headSha, type: 'commit' } })
      }
      return Response.json({ message: 'not found' }, { status: 404 })
    })

    const progressService = new GitHubProgressService({
      getToken: () => 'token',
      getSettings: async () => ({
        repository: 'timthedev07/leetcode',
        branch: 'dev'
      }),
      fetch: fetchGitHub
    })
    const repositoryService = {
      verifyPushPermission: vi.fn(async () => ({
        owner: 'timthedev07',
        name: 'leetcode',
        fullName: 'timthedev07/leetcode',
        private: false,
        defaultBranch: 'dev',
        canPush: true
      }))
    } as unknown as RepositoryService
    const sync = new GitHubSyncService({
      getToken: () => 'token',
      repositoryService,
      submissionService: {
        findLatestAcceptedCpp: vi.fn(async () => accepted)
      } as never,
      getSettings: async () => ({
        repository: 'timthedev07/leetcode',
        branch: 'dev'
      }),
      progressService,
      fetch: fetchGitHub
    })

    const before = await progressService.getOverview()
    expect(before.recommendations.map((problem) => problem.id)).toEqual([209, 704])

    const outcome = await sync.execute(
      {
        problemSlug: accepted.titleSlug,
        frontendProblemId: accepted.frontendProblemId,
        difficulty: 'Medium'
      },
      false,
      accepted.id
    )
    expect(outcome).toMatchObject({
      result: 'created',
      changedFiles: ['medium/Problem209.cpp', 'data/progress.json'],
      readmeStatus: 'pending'
    })

    const after = await progressService.getOverview()
    expect(after.recommendations.map((problem) => problem.id)).toEqual([704])
    expect(after.statistics).toMatchObject({
      completed: 1,
      targetCount: 2,
      percentage: 50
    })
  })
})
