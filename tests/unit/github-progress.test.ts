import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  GitHubProgressService,
  calculateProgressStatistics,
  getNextProblems,
  parseProgressDocument,
  prepareProgressUpdate,
  serialiseProgressDocument,
  type ProgressDocument
} from '../../src/main/github/progress'
import type { FetchTransport } from '../../src/main/github/repository'

function document(): ProgressDocument {
  return {
    version: 1,
    target_count: 2,
    phases: [
      { number: 1, title: 'First', description: 'Start here.' },
      { number: 2, title: 'Second', description: 'Continue here.' }
    ],
    problems: [
      {
        id: 128,
        name: 'Longest Consecutive Sequence',
        slug: 'longest-consecutive-sequence',
        difficulty: 'Medium',
        phase: 1,
        order: 1,
        done: true,
        solution_path: 'medium/Problem128.cpp',
        custom_label: 'preserved'
      },
      {
        id: 42,
        name: 'Trapping Rain Water',
        slug: 'trapping-rain-water',
        difficulty: 'Hard',
        phase: 2,
        order: 2,
        done: false,
        solution_path: null,
        premium: true
      },
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
}

const paths = new Set([
  'medium/Problem128.cpp',
  'medium/Problem7.java'
])

function progressTransport(options: {
  document?: unknown
  includeProgress?: boolean
  rawContent?: string
  refStatus?: number
} = {}): ReturnType<typeof vi.fn<FetchTransport>> {
  const files = [
    { path: 'medium/Problem128.cpp', type: 'blob', sha: 'solution-blob' },
    { path: 'medium/Problem7.java', type: 'blob', sha: 'java-blob' },
    ...(options.includeProgress === false
      ? []
      : [{ path: 'data/progress.json', type: 'blob', sha: 'progress-blob' }])
  ]
  return vi.fn<FetchTransport>(async (input) => {
    const url = String(input)
    if (url.includes('/git/ref/heads/')) {
      if (options.refStatus) {
        return Response.json({ message: 'denied' }, { status: options.refStatus })
      }
      return Response.json({ object: { sha: 'head-sha', type: 'commit' } })
    }
    if (url.includes('/git/commits/')) {
      return Response.json({ tree: { sha: 'tree-sha' } })
    }
    if (url.includes('/git/trees/')) {
      return Response.json({ tree: files, truncated: false })
    }
    if (url.includes('/contents/data/progress.json')) {
      const content =
        options.rawContent ??
        JSON.stringify(options.document ?? document())
      return Response.json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha: 'progress-blob',
        html_url: 'https://github.com/timthedev07/leetcode/blob/dev/data/progress.json',
        path: 'data/progress.json'
      })
    }
    return Response.json({ message: 'not found' }, { status: 404 })
  })
}

function progressService(transport: ReturnType<typeof progressTransport>): GitHubProgressService {
  return new GitHubProgressService({
    getToken: () => 'opaque-token',
    getSettings: async () => ({
      repository: 'timthedev07/leetcode',
      branch: 'dev'
    }),
    fetch: transport
  })
}

describe('GitHub progress contract', () => {
  it('reads and validates progress from the exact branch revision', async () => {
    const transport = progressTransport()

    const snapshot = await progressService(transport).loadSnapshot()

    expect(snapshot).toMatchObject({
      headSha: 'head-sha',
      treeSha: 'tree-sha',
      progressBlobSha: 'progress-blob'
    })
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/repos/timthedev07/leetcode/git/ref/heads/dev',
      'https://api.github.com/repos/timthedev07/leetcode/git/commits/head-sha',
      'https://api.github.com/repos/timthedev07/leetcode/git/trees/tree-sha?recursive=1',
      'https://api.github.com/repos/timthedev07/leetcode/contents/data/progress.json?ref=head-sha'
    ])
  })

  it('reports a missing progress contract without creating a file', async () => {
    const transport = progressTransport({ includeProgress: false })

    await expect(progressService(transport).loadSnapshot()).rejects.toMatchObject({
      code: 'PROGRESS_UNAVAILABLE',
      message: expect.stringContaining('does not contain data/progress.json')
    })
    expect(
      transport.mock.calls.some(([url]) => String(url).includes('/contents/'))
    ).toBe(false)
  })

  it('rejects malformed JSON and permission failures', async () => {
    const malformed = progressTransport({ rawContent: '{"version": 1,' })
    await expect(progressService(malformed).loadSnapshot()).rejects.toMatchObject({
      code: 'PROGRESS_UNAVAILABLE',
      message: expect.stringContaining('not valid JSON')
    })

    const denied = progressTransport({ refStatus: 403 })
    await expect(progressService(denied).loadSnapshot()).rejects.toMatchObject({
      code: 'ACCESS_DENIED'
    })
  })

  it('validates the current version and preserves uninterpreted metadata', () => {
    const parsed = parseProgressDocument(document(), paths)

    expect(parsed.problems[0]).toMatchObject({
      id: 128,
      done: true,
      custom_label: 'preserved'
    })
    expect(parsed.problems[1]).toMatchObject({ premium: true })
    expect(serialiseProgressDocument(parsed)).toContain('"custom_label": "preserved"')
  })

  it('rejects an unsupported version and malformed fields', () => {
    expect(() => parseProgressDocument({ ...document(), version: 2 }, paths)).toThrow(
      'supported version 1'
    )
    const malformed = document()
    ;(malformed.problems[0] as unknown as Record<string, unknown>).done = 'yes'
    expect(() => parseProgressDocument(malformed, paths)).toThrow(
      'supported version 1'
    )
  })

  it('rejects duplicate IDs and missing or duplicate progressive orders', () => {
    const duplicateId = document()
    duplicateId.problems[1]!.id = 128
    expect(() => parseProgressDocument(duplicateId, paths)).toThrow('duplicated')

    const duplicateOrder = document()
    duplicateOrder.problems[1]!.order = 1
    expect(() => parseProgressDocument(duplicateOrder, paths)).toThrow('duplicated')

    const missingOrder = document()
    missingOrder.problems[1]!.order = 3
    expect(() => parseProgressDocument(missingOrder, paths)).toThrow('order 2 is missing')
  })

  it('rejects inconsistent phase ordering and null phase/order pairs', () => {
    const wrongPhase = document()
    wrongPhase.problems[0]!.phase = 2
    wrongPhase.problems[1]!.phase = 1
    expect(() => parseProgressDocument(wrongPhase, paths)).toThrow('learning order')

    const halfCurated = document()
    halfCurated.problems[1]!.order = null
    expect(() => parseProgressDocument(halfCurated, paths)).toThrow(
      'both phase and order'
    )
  })

  it('validates repository-relative paths and completed solution existence', () => {
    const traversal = document()
    traversal.problems[0]!.solution_path = '../Problem128.cpp'
    expect(() => parseProgressDocument(traversal, paths)).toThrow(
      'repository-relative'
    )

    const missing = document()
    expect(() => parseProgressDocument(missing, new Set())).toThrow(
      'missing solution file'
    )

    const noPath = document()
    noPath.problems[0]!.solution_path = null
    expect(() => parseProgressDocument(noPath, paths)).toThrow(
      'complete but has no solution path'
    )
  })

  it('updates only the matching ID and preserves every other field', () => {
    const original = document()
    const result = prepareProgressUpdate(
      original,
      {
        id: 42,
        name: 'Trapping Rain Water',
        slug: 'trapping-rain-water',
        difficulty: 'Hard'
      },
      'hard/Problem42.cpp'
    )

    expect(result.action).toBe('update')
    expect(result.document.problems[1]).toMatchObject({
      id: 42,
      phase: 2,
      order: 2,
      done: true,
      premium: true,
      solution_path: 'hard/Problem42.cpp'
    })
    expect(result.document.problems[0]).toBe(original.problems[0])
    expect(original.problems[1]!.done).toBe(false)
  })

  it('appends uncurated problems without altering target_count or curated order', () => {
    const original = document()
    const result = prepareProgressUpdate(
      original,
      {
        id: 912,
        name: 'Sort an Array',
        slug: 'sort-an-array',
        difficulty: 'Medium'
      },
      'medium/Problem912.cpp'
    )

    expect(result.action).toBe('add')
    expect(result.document.target_count).toBe(2)
    expect(result.document.problems.at(-1)).toMatchObject({
      id: 912,
      phase: null,
      order: null,
      done: true
    })
  })
})

describe('Up Next recommendations', () => {
  function recommendationDocument(): ProgressDocument {
    return {
      version: 1,
      target_count: 7,
      phases: [{ number: 1, title: 'Phase', description: 'Progress.' }],
      problems: [
        ...[7, 6, 5, 4, 3, 2, 1].map((order) => ({
          id: 100 + order,
          name: `Problem ${order}`,
          slug: `problem-${order}`,
          difficulty: 'Medium' as const,
          phase: 1,
          order,
          done: order === 6,
          solution_path: order === 6 ? 'medium/Problem106.cpp' : null
        })),
        {
          id: 999,
          name: 'Additional',
          slug: 'additional',
          difficulty: 'Easy',
          phase: null,
          order: null,
          done: false,
          solution_path: null
        }
      ]
    }
  }

  it('returns the five earliest incomplete curated problems by order', () => {
    const parsed = parseProgressDocument(
      recommendationDocument(),
      new Set(['medium/Problem106.cpp'])
    )

    expect(getNextProblems(parsed).map((problem) => problem.order)).toEqual([1, 2, 3, 4, 5])
    expect(getNextProblems(parsed).map((problem) => problem.id)).not.toContain(999)
  })

  it('returns fewer items when fewer remain and none when complete', () => {
    const fewer: ProgressDocument = {
      version: 1,
      target_count: 2,
      phases: [{ number: 1, title: 'Phase', description: 'Progress.' }],
      problems: [
        {
          id: 1,
          name: 'One',
          slug: 'one',
          difficulty: 'Medium',
          phase: 1,
          order: 1,
          done: true,
          solution_path: 'medium/Problem1.cpp'
        },
        {
          id: 2,
          name: 'Two',
          slug: 'two',
          difficulty: 'Medium',
          phase: 1,
          order: 2,
          done: false,
          solution_path: null
        }
      ]
    }
    expect(
      getNextProblems(parseProgressDocument(fewer, new Set(['medium/Problem1.cpp'])))
    ).toHaveLength(1)

    const complete = recommendationDocument()
    complete.problems = complete.problems.map((problem) => ({
      ...problem,
      done: true,
      solution_path: problem.solution_path ?? `medium/Problem${problem.id}.cpp`
    }))
    const completePaths = new Set(
      complete.problems.flatMap((problem) =>
        problem.solution_path ? [problem.solution_path] : []
      )
    )
    expect(getNextProblems(parseProgressDocument(complete, completePaths))).toEqual([])
  })

  it('calculates curated and additional completion from one snapshot', () => {
    const parsed = parseProgressDocument(document(), paths)
    expect(calculateProgressStatistics(parsed)).toEqual({
      completed: 1,
      targetCount: 2,
      percentage: 50,
      totalCompleted: 2,
      additionalCompleted: 1
    })
  })
})
