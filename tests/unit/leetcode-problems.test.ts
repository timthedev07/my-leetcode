import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProblemSummary } from '@shared/types'
import {
  LeetCodeProblemsService,
  rankProblem,
  sanitiseProblemHtml,
  splitExampleTestCases
} from '../../src/main/leetcode/problems'

async function fixture(name: string): Promise<unknown> {
  const content = await readFile(resolve(process.cwd(), 'tests', 'fixtures', 'leetcode', name), 'utf8')
  return JSON.parse(content) as unknown
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify({ data: value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('LeetCode problem discovery', () => {
  it('normalises search results and ranks exact numeric IDs first', async () => {
    const transport = vi.fn(async () => jsonResponse(await fixture('problem-search.json')))
    const service = new LeetCodeProblemsService(transport)

    const result = await service.search('209')

    expect(result.total).toBe(4)
    expect(result.problems[0]).toMatchObject({
      frontendId: '209',
      titleSlug: 'minimum-size-subarray-sum',
      difficulty: 'Medium'
    })
  })

  it('ranks exact titles, slugs, prefixes and topics deterministically', () => {
    const base: ProblemSummary = {
      frontendId: '209',
      title: 'Minimum Size Subarray Sum',
      titleSlug: 'minimum-size-subarray-sum',
      difficulty: 'Medium',
      isPaidOnly: false,
      topicTags: [{ name: 'Sliding Window', slug: 'sliding-window' }]
    }

    expect(rankProblem(base, '209')).toBeGreaterThan(rankProblem(base, 'minimum-size-subarray-sum'))
    expect(rankProblem(base, 'minimum-size-subarray-sum')).toBeGreaterThan(rankProblem(base, 'Minimum Size Subarray Sum'))
    expect(rankProblem(base, 'Minimum Size Subarray Sum')).toBeGreaterThan(rankProblem(base, 'minimum'))
    expect(rankProblem(base, 'sliding window')).toBeGreaterThan(0)
    expect(rankProblem(base, 'unrelated')).toBe(0)
  })

  it('uses the C++ starter and removes executable problem HTML', async () => {
    const transport = vi.fn(async () => jsonResponse(await fixture('problem-detail.json')))
    const service = new LeetCodeProblemsService(transport)

    const problem = await service.getProblem('minimum-size-subarray-sum')

    expect(problem.starterCode).toContain('minSubArrayLen')
    expect(problem.hints).toEqual(['Use a sliding <strong>window</strong>.'])
    expect(problem.contentHtml).toContain('Example 1')
    expect(problem.contentHtml).toContain('Constraints')
    expect(problem.contentHtml).not.toContain('<script')
    expect(problem.contentHtml).not.toContain('javascript:')
    expect(problem.exampleTestCases).toEqual([
      '7\n[2,3,1,2,4,3]',
      '4\n[1,4,4]',
      '11\n[1,1,1,1,1,1,1,1]'
    ])
  })

  it('splits line-delimited examples by signature and preserves uncertain input', () => {
    expect(splitExampleTestCases('7\n[2,3,1]\n4\n[1,4]', 2)).toEqual([
      '7\n[2,3,1]',
      '4\n[1,4]'
    ])
    expect(splitExampleTestCases('7\n[2,3,1]\n4', 2)).toEqual([
      '7\n[2,3,1]\n4'
    ])
    expect(splitExampleTestCases('   ', 2)).toEqual([])
  })

  it('defuses inline handlers and non-HTTPS links', () => {
    const sanitised = sanitiseProblemHtml(
      '<p onclick="steal()">Safe</p><a href="http://example.com">bad</a><img src="https://tracker.test/x.png">'
    )

    expect(sanitised).toBe('<p>Safe</p><a>bad</a>')
  })

  it('reuses bounded metadata until the cache TTL expires', async () => {
    const detail = await fixture('problem-detail.json')
    const transport = vi.fn(async () => jsonResponse(detail))
    let now = 1_000
    const service = new LeetCodeProblemsService(transport, {
      now: () => now,
      cacheTtlMs: 50
    })

    await service.getProblem('minimum-size-subarray-sum')
    now = 1_049
    await service.getProblem('minimum-size-subarray-sum')
    expect(transport).toHaveBeenCalledOnce()

    now = 1_050
    await service.getProblem('minimum-size-subarray-sum')
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('maps schema drift to an actionable API error', async () => {
    const transport = vi.fn(async () =>
      jsonResponse({
        question: {
          questionId: '209',
          title: 'Missing required fields'
        }
      })
    )
    const service = new LeetCodeProblemsService(transport)

    await expect(service.getProblem('minimum-size-subarray-sum')).rejects.toMatchObject({
      code: 'API_CHANGED',
      message: 'LeetCode returned an unexpected response. The service may have changed.'
    })
  })
})

