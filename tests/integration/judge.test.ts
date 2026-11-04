import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LeetCodeJudgeService,
  type JudgeRunRequest
} from '../../src/main/leetcode/judge'

type SessionMock = ConstructorParameters<typeof LeetCodeJudgeService>[0]

const runRequest: JudgeRunRequest = {
  problemSlug: 'two-sum',
  internalProblemId: '1',
  typedCode: 'class Solution {};',
  dataInput: '[2,7,11,15]\n9'
}

async function fixture(name: string): Promise<Record<string, unknown>> {
  const content = await readFile(
    resolve(process.cwd(), 'tests', 'fixtures', 'leetcode', name),
    'utf8'
  )
  return JSON.parse(content) as Record<string, unknown>
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function createSession(
  handler: (path: string, init?: RequestInit) => Promise<Response>
): {
  session: SessionMock
  request: ReturnType<typeof vi.fn>
  getCsrfToken: ReturnType<typeof vi.fn>
} {
  const request = vi.fn(handler)
  const getCsrfToken = vi.fn(async () => 'redacted-csrf-token')
  return {
    session: { request, getCsrfToken } as unknown as SessionMock,
    request,
    getCsrfToken
  }
}

function createSleepMock() {
  return vi.fn(async (_milliseconds: number, _signal: AbortSignal) => undefined)
}

describe('LeetCode judge service', () => {
  it('waits through queued and running states, then reports a passed Run', async () => {
    const terminal = await fixture('judge-poll.json')
    let pollCount = 0
    const { session, request, getCsrfToken } = createSession(async (_path, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ interpret_id: 'interpret-123' })
      }
      pollCount += 1
      if (pollCount === 1) return jsonResponse({ state: 'PENDING' })
      if (pollCount === 2) return jsonResponse({ state: 'STARTED' })
      return jsonResponse(terminal)
    })
    const sleep = createSleepMock()
    const service = new LeetCodeJudgeService(session, { sleep })

    const result = await service.run(runRequest)

    expect(result).toMatchObject({
      operation: 'run',
      problemSlug: 'two-sum',
      requestId: 'interpret-123',
      submissionId: null,
      state: 'passed',
      statusDisplay: 'Accepted',
      totalCorrect: 1,
      totalTestcases: 1,
      runtime: '0 ms',
      memory: '7.1 MB',
      codeSnapshot: runRequest.typedCode,
      testInputSnapshot: runRequest.dataInput
    })
    expect(result.cases[0]).toMatchObject({
      caseNumber: 1,
      correct: true,
      expectedOutput: '3',
      actualOutput: '3'
    })
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([600, 1_200])
    expect(getCsrfToken).toHaveBeenCalledOnce()

    const firstRequest = request.mock.calls[0]
    expect(firstRequest?.[0]).toBe('/problems/two-sum/interpret_solution/')
    const init = firstRequest?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      lang: 'cpp',
      question_id: '1',
      typed_code: runRequest.typedCode,
      data_input: runRequest.dataInput
    })
    expect(init.headers).toMatchObject({
      'x-csrftoken': 'redacted-csrf-token'
    })
  })

  it('distinguishes an Accepted Submit from a passed custom Run', async () => {
    const terminal = await fixture('judge-poll.json')
    const { session, request } = createSession(async (_path, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ submission_id: 24_681_012 })
      }
      return jsonResponse(terminal)
    })
    const service = new LeetCodeJudgeService(session, {
      sleep: createSleepMock()
    })

    const result = await service.submit({
      problemSlug: 'two-sum',
      internalProblemId: '1',
      typedCode: runRequest.typedCode
    })

    expect(result).toMatchObject({
      operation: 'submit',
      requestId: '24681012',
      submissionId: '24681012',
      state: 'accepted',
      statusDisplay: 'Accepted',
      testInputSnapshot: null
    })
    expect(request.mock.calls[0]?.[0]).toBe('/problems/two-sum/submit/')
    const submitInit = request.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(submitInit.body))).toEqual({
      lang: 'cpp',
      question_id: '1',
      typed_code: runRequest.typedCode
    })
  })

  it.each([
    {
      name: 'wrong answer',
      overrides: { status_code: 11, status_msg: 'Wrong Answer', run_success: false },
      expectedState: 'wrong_answer'
    },
    {
      name: 'compile error',
      overrides: {
        status_code: 20,
        status_msg: 'Compile Error',
        compile_error: 'Line 4: expected a declaration',
        full_compile_error: 'Line 4: expected a declaration'
      },
      expectedState: 'compile_error'
    },
    {
      name: 'runtime error',
      overrides: {
        status_code: 15,
        status_msg: 'Runtime Error',
        runtime_error: 'AddressSanitizer: heap-buffer-overflow',
        full_runtime_error: 'AddressSanitizer: heap-buffer-overflow'
      },
      expectedState: 'runtime_error'
    }
  ])('maps a terminal $name without claiming success', async ({ overrides, expectedState }) => {
    const terminal = { ...(await fixture('judge-poll.json')), ...overrides }
    const { session } = createSession(async (_path, init) =>
      init?.method === 'POST'
        ? jsonResponse({ interpret_id: 'interpret-123' })
        : jsonResponse(terminal)
    )
    const service = new LeetCodeJudgeService(session, {
      sleep: createSleepMock()
    })

    const result = await service.run(runRequest)

    expect(result.state).toBe(expectedState)
    expect(result.state).not.toBe('accepted')
  })

  it('honours Retry-After before polling again after HTTP 429', async () => {
    const terminal = await fixture('judge-poll.json')
    let pollCount = 0
    const { session } = createSession(async (_path, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ interpret_id: 'interpret-123' })
      }
      pollCount += 1
      if (pollCount === 1) {
        return new Response('{}', {
          status: 429,
          headers: { 'Retry-After': '2' }
        })
      }
      return jsonResponse(terminal)
    })
    const sleep = createSleepMock()
    const service = new LeetCodeJudgeService(session, { sleep })

    const result = await service.run(runRequest)

    expect(result.state).toBe('passed')
    expect(sleep.mock.calls[0]?.[0]).toBe(2_000)
  })

  it('returns a timed-out result when the bounded overall deadline expires', async () => {
    const { session } = createSession(async (_path, init) =>
      init?.method === 'POST'
        ? jsonResponse({ interpret_id: 'interpret-123' })
        : jsonResponse({ state: 'PENDING' })
    )
    const service = new LeetCodeJudgeService(session, {
      timeoutMs: 5,
      initialPollIntervalMs: 100
    })

    const result = await service.run(runRequest)

    expect(result).toMatchObject({
      requestId: 'interpret-123',
      state: 'timed_out',
      statusDisplay: 'Timed out',
      codeSnapshot: runRequest.typedCode,
      testInputSnapshot: runRequest.dataInput
    })
  })

  it('returns a cancelled result without discarding its code snapshot', async () => {
    const terminal = await fixture('judge-poll.json')
    let runCount = 0
    const { session, request } = createSession(async (_path, init) => {
      if (init?.method === 'POST') {
        runCount += 1
        return jsonResponse({
          interpret_id: runCount === 1 ? 'interpret-cancelled' : 'interpret-next'
        })
      }
      return runCount === 1 ? jsonResponse({ state: 'PENDING' }) : jsonResponse(terminal)
    })
    const service = new LeetCodeJudgeService(session)

    const pending = service.run(runRequest)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await expect(service.run(runRequest)).rejects.toMatchObject({
      code: 'JUDGE_FAILED'
    })
    expect(service.cancel('two-sum')).toBe(true)
    expect(service.hasActiveOperation('two-sum')).toBe(false)
    const result = await pending

    expect(result).toMatchObject({
      requestId: 'interpret-cancelled',
      state: 'cancelled',
      statusDisplay: 'Cancelled',
      codeSnapshot: runRequest.typedCode,
      testInputSnapshot: runRequest.dataInput
    })
    expect(service.hasActiveOperation('two-sum')).toBe(false)

    await expect(service.run(runRequest)).resolves.toMatchObject({
      requestId: 'interpret-next',
      state: 'passed'
    })
  })

  it('maps an unauthorised judge request to AUTH_EXPIRED', async () => {
    const { session } = createSession(async () =>
      jsonResponse({ detail: 'Authentication credentials were not provided.' }, 401)
    )
    const service = new LeetCodeJudgeService(session)

    await expect(service.run(runRequest)).rejects.toMatchObject({
      code: 'AUTH_EXPIRED'
    })
  })

  it('rejects an acknowledgement without a confirmed request ID', async () => {
    const { session } = createSession(async () => jsonResponse({}))
    const service = new LeetCodeJudgeService(session)

    await expect(service.run(runRequest)).rejects.toMatchObject({
      code: 'API_CHANGED'
    })
  })
})
