import { z } from 'zod'
import { LEETCODE_ORIGIN } from '@shared/constants'
import type {
  JudgeCaseResult,
  JudgeOperation,
  JudgeResult,
  JudgeState
} from '@shared/types'
import { AppError } from '../security/app-error'
import { logDevelopmentDiagnostic } from '../development-log'
import type { LeetCodeAuthenticatedSession } from './auth-contract'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_INITIAL_POLL_MS = 600
const DEFAULT_MAX_POLL_MS = 4_000

const identifierSchema = z
  .union([
    z.string().trim().min(1).max(200),
    z.number().int().positive().transform((value) => String(value))
  ])

const integerLikeSchema = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform((value) => Number(value))
])

const scalarTextSchema = z.union([z.string(), z.number().finite()])
const textValueSchema = scalarTextSchema.nullable().optional()
const textCollectionSchema = z
  .union([scalarTextSchema, z.array(scalarTextSchema)])
  .nullable()
  .optional()

const operationAcknowledgementSchema = z
  .object({
    interpret_id: identifierSchema.optional(),
    submission_id: identifierSchema.optional()
  })
  .passthrough()

const pollResponseSchema = z
  .object({
    state: z.string().nullable().optional(),
    status_code: integerLikeSchema.nullable().optional(),
    status_msg: z.string().nullable().optional(),
    run_success: z.boolean().nullable().optional(),
    compile_error: z.string().nullable().optional(),
    full_compile_error: z.string().nullable().optional(),
    runtime_error: z.string().nullable().optional(),
    full_runtime_error: z.string().nullable().optional(),
    total_correct: integerLikeSchema.nullable().optional(),
    total_testcases: integerLikeSchema.nullable().optional(),
    runtime: textValueSchema,
    memory: textValueSchema,
    code_answer: z.array(z.string()).nullable().optional(),
    expected_code_answer: z.array(z.string()).nullable().optional(),
    code_output: textCollectionSchema,
    expected_output: textCollectionSchema,
    std_output_list: z.array(z.string()).nullable().optional(),
    compare_result: z.string().nullable().optional(),
    input: z.string().nullable().optional(),
    inputs: z.array(z.string()).nullable().optional(),
    last_testcase: z.string().nullable().optional(),
    submission_id: identifierSchema.nullable().optional()
  })
  .passthrough()

type ParsedPollResponse = z.infer<typeof pollResponseSchema>

type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>

export type JudgeRunRequest = {
  problemSlug: string
  internalProblemId: string
  typedCode: string
  dataInput: string
}

export type JudgeSubmitRequest = {
  problemSlug: string
  internalProblemId: string
  typedCode: string
}

export type LeetCodeJudgeOptions = {
  timeoutMs?: number
  initialPollIntervalMs?: number
  maxPollIntervalMs?: number
  now?: () => number
  sleep?: Sleep
  logger?: JudgeDiagnosticsLogger
}

type JudgeDiagnosticsLogger = (
  event: string,
  details: Record<string, unknown>
) => void

type ActiveOperation = {
  controller: AbortController
  timedOut: boolean
  requestId: string
}

type OperationSnapshot = {
  operation: JudgeOperation
  problemSlug: string
  codeSnapshot: string
  testInputSnapshot: string | null
}

type PollAttempt =
  | { kind: 'response'; value: unknown }
  | { kind: 'rate_limited'; retryAfterMs: number | null }

export class LeetCodeJudgeService {
  private readonly activeOperations = new Map<string, ActiveOperation>()
  private readonly timeoutMs: number
  private readonly initialPollIntervalMs: number
  private readonly maxPollIntervalMs: number
  private readonly now: () => number
  private readonly sleep: Sleep
  private readonly logger: JudgeDiagnosticsLogger

  constructor(
    private readonly session: LeetCodeAuthenticatedSession,
    options: LeetCodeJudgeOptions = {}
  ) {
    this.timeoutMs = positiveDuration(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    this.initialPollIntervalMs = nonNegativeDuration(
      options.initialPollIntervalMs,
      DEFAULT_INITIAL_POLL_MS
    )
    this.maxPollIntervalMs = Math.max(
      this.initialPollIntervalMs,
      nonNegativeDuration(options.maxPollIntervalMs, DEFAULT_MAX_POLL_MS)
    )
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? abortableSleep
    this.logger = options.logger ?? developmentJudgeLogger
  }

  async run(request: JudgeRunRequest): Promise<JudgeResult> {
    assertProblemReference(request.problemSlug, request.internalProblemId)
    const path = `/problems/${request.problemSlug}/interpret_solution/`
    const payload = {
      lang: 'cpp',
      question_id: request.internalProblemId,
      typed_code: request.typedCode,
      data_input: request.dataInput
    }

    return this.execute(
      {
        operation: 'run',
        problemSlug: request.problemSlug,
        codeSnapshot: request.typedCode,
        testInputSnapshot: request.dataInput
      },
      (csrfToken, signal) => this.send(path, request.problemSlug, payload, csrfToken, signal)
    )
  }

  async submit(request: JudgeSubmitRequest): Promise<JudgeResult> {
    assertProblemReference(request.problemSlug, request.internalProblemId)
    const path = `/problems/${request.problemSlug}/submit/`
    const payload = {
      lang: 'cpp',
      question_id: request.internalProblemId,
      typed_code: request.typedCode
    }

    return this.execute(
      {
        operation: 'submit',
        problemSlug: request.problemSlug,
        codeSnapshot: request.typedCode,
        testInputSnapshot: null
      },
      (csrfToken, signal) => this.send(path, request.problemSlug, payload, csrfToken, signal)
    )
  }

  cancel(problemSlug: string): boolean {
    const operation = this.activeOperations.get(problemSlug)
    if (!operation) return false
    this.activeOperations.delete(problemSlug)
    operation.controller.abort()
    return true
  }

  hasActiveOperation(problemSlug: string): boolean {
    return this.activeOperations.has(problemSlug)
  }

  private async execute(
    snapshot: OperationSnapshot,
    send: (csrfToken: string, signal: AbortSignal) => Promise<Response>
  ): Promise<JudgeResult> {
    if (this.activeOperations.has(snapshot.problemSlug)) {
      throw new AppError(
        'JUDGE_FAILED',
        'A judge operation is already running for this problem.'
      )
    }

    const controller = new AbortController()
    const active: ActiveOperation = {
      controller,
      timedOut: false,
      requestId: ''
    }
    const timeout = setTimeout(() => {
      active.timedOut = true
      controller.abort()
    }, this.timeoutMs)
    unrefTimer(timeout)
    this.activeOperations.set(snapshot.problemSlug, active)
    this.logger('started', {
      operation: snapshot.operation,
      problemSlug: snapshot.problemSlug
    })

    try {
      ensureNotAborted(controller.signal)
      const csrfToken = this.session.getCsrfToken
        ? await this.session.getCsrfToken()
        : null
      ensureNotAborted(controller.signal)
      if (!csrfToken) {
        throw new AppError(
          'AUTH_EXPIRED',
          'Your LeetCode session cannot authorise judge requests. Reconnect your account and try again.'
        )
      }

      const acknowledgement = await this.parseResponse(
        await send(csrfToken, controller.signal),
        'judge request'
      )
      const requestId = readRequestId(
        snapshot.operation,
        acknowledgement,
        this.logger
      )
      active.requestId = requestId
      return await this.poll(snapshot, requestId, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) {
        this.logger('interrupted', {
          operation: snapshot.operation,
          problemSlug: snapshot.problemSlug,
          requestId: active.requestId || null,
          reason: active.timedOut ? 'timed_out' : 'cancelled'
        })
        return createInterruptedResult(
          snapshot,
          active.requestId,
          active.timedOut ? 'timed_out' : 'cancelled',
          this.now()
        )
      }
      this.logger('failed', {
        operation: snapshot.operation,
        problemSlug: snapshot.problemSlug,
        requestId: active.requestId || null,
        error: describeError(error)
      })
      throw mapJudgeError(error)
    } finally {
      clearTimeout(timeout)
      if (this.activeOperations.get(snapshot.problemSlug) === active) {
        this.activeOperations.delete(snapshot.problemSlug)
      }
    }
  }

  private async poll(
    snapshot: OperationSnapshot,
    requestId: string,
    signal: AbortSignal
  ): Promise<JudgeResult> {
    let delayMs = this.initialPollIntervalMs

    while (true) {
      ensureNotAborted(signal)
      const attempt = await this.pollOnce(requestId, signal)
      ensureNotAborted(signal)

      if (attempt.kind === 'rate_limited') {
        const waitMs = Math.max(delayMs, attempt.retryAfterMs ?? 0)
        await this.sleep(waitMs, signal)
        delayMs = nextPollDelay(delayMs, this.maxPollIntervalMs)
        continue
      }

      this.logger('poll response', {
        requestId,
        response: describeUnknownValue(attempt.value)
      })
      const response = parseExternal(
        pollResponseSchema,
        attempt.value,
        'poll response',
        this.logger
      )
      if (isTerminalPollResponse(response)) {
        const result = mapPollResult(snapshot, requestId, response, this.now())
        this.logger('completed', {
          requestId,
          state: result.state,
          totalCorrect: result.totalCorrect,
          totalTestcases: result.totalTestcases
        })
        return result
      }
      if (!isTransientPollResponse(response)) {
        throw new AppError(
          'API_CHANGED',
          'LeetCode returned an unrecognised judge state.',
          response.state ?? 'Missing poll state'
        )
      }

      await this.sleep(delayMs, signal)
      delayMs = nextPollDelay(delayMs, this.maxPollIntervalMs)
    }
  }

  private async pollOnce(requestId: string, signal: AbortSignal): Promise<PollAttempt> {
    const response = await this.session.request(
      `/submissions/detail/${encodeURIComponent(requestId)}/check/`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Referer: `${LEETCODE_ORIGIN}/submissions/`
        },
        signal
      }
    )
    ensureNotAborted(signal)

    if (response.status === 429) {
      return {
        kind: 'rate_limited',
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), this.now())
      }
    }
    if (!response.ok) throw httpResponseError(response, 'judge poll')
    return { kind: 'response', value: await parseJsonResponse(response, 'judge poll') }
  }

  private async send(
    path: string,
    problemSlug: string,
    payload: Record<string, string>,
    csrfToken: string,
    signal: AbortSignal
  ): Promise<Response> {
    return this.session.request(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: LEETCODE_ORIGIN,
        Referer: `${LEETCODE_ORIGIN}/problems/${problemSlug}/`,
        'x-csrftoken': csrfToken,
        'x-requested-with': 'XMLHttpRequest'
      },
      body: JSON.stringify(payload),
      signal
    })
  }

  private async parseResponse(response: Response, context: string): Promise<unknown> {
    if (!response.ok) throw httpResponseError(response, context)
    return parseJsonResponse(response, context)
  }
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1_000
  }

  const retryAt = Date.parse(trimmed)
  if (!Number.isFinite(retryAt)) return null
  return Math.max(0, retryAt - nowMs)
}

function readRequestId(
  operation: JudgeOperation,
  value: unknown,
  logger: JudgeDiagnosticsLogger
): string {
  const acknowledgement = parseExternal(
    operationAcknowledgementSchema,
    value,
    'request acknowledgement',
    logger
  )
  const requestId =
    operation === 'run' ? acknowledgement.interpret_id : acknowledgement.submission_id
  if (!requestId) {
    throw new AppError(
      'API_CHANGED',
      'LeetCode did not confirm a judge request identifier.'
    )
  }
  logger('acknowledged', { operation, requestId })
  return requestId
}

function isTerminalPollResponse(response: ParsedPollResponse): boolean {
  if (response.compile_error || response.full_compile_error) return true
  if (response.runtime_error || response.full_runtime_error) return true
  if (response.status_code !== null && response.status_code !== undefined) return true
  return response.state?.toUpperCase() === 'SUCCESS'
}

function isTransientPollResponse(response: ParsedPollResponse): boolean {
  const state = response.state?.toUpperCase()
  return (
    state === 'PENDING' ||
    state === 'STARTED' ||
    state === 'RUNNING' ||
    state === 'QUEUED' ||
    state === 'NOT_STARTED'
  )
}

function mapPollResult(
  snapshot: OperationSnapshot,
  requestId: string,
  response: ParsedPollResponse,
  completedAtMs: number
): JudgeResult {
  const statusDisplay = firstNonEmpty(response.status_msg) ?? terminalLabel(response, snapshot.operation)
  const state = mapJudgeState(snapshot.operation, response, statusDisplay)
  const submissionId =
    snapshot.operation === 'submit'
      ? (response.submission_id ?? requestId)
      : null

  return {
    operation: snapshot.operation,
    problemSlug: snapshot.problemSlug,
    requestId,
    submissionId,
    state,
    statusDisplay,
    compileError:
      firstNonEmpty(response.full_compile_error, response.compile_error),
    runtimeError:
      firstNonEmpty(response.full_runtime_error, response.runtime_error),
    totalCorrect: nullableInteger(response.total_correct),
    totalTestcases: nullableInteger(response.total_testcases),
    runtime: formatMetric(response.runtime),
    memory: formatMetric(response.memory),
    cases: mapCaseResults(response),
    codeSnapshot: snapshot.codeSnapshot,
    testInputSnapshot: snapshot.testInputSnapshot,
    completedAtMs
  }
}

function mapJudgeState(
  operation: JudgeOperation,
  response: ParsedPollResponse,
  statusDisplay: string
): JudgeState {
  if (response.compile_error || response.full_compile_error) return 'compile_error'
  if (response.runtime_error || response.full_runtime_error) return 'runtime_error'

  const status = statusDisplay.trim().toLowerCase()
  if (status.includes('compile error')) return 'compile_error'
  if (status.includes('runtime error')) return 'runtime_error'
  if (status.includes('time limit')) return 'time_limit'
  if (status.includes('wrong answer')) return 'wrong_answer'

  const statusCode = response.status_code
  if (statusCode === 20) return 'compile_error'
  if (statusCode === 15) return 'runtime_error'
  if (statusCode === 14) return 'time_limit'
  if (statusCode === 11) return 'wrong_answer'

  const allCasesPassed =
    response.total_correct !== null &&
    response.total_correct !== undefined &&
    response.total_testcases !== null &&
    response.total_testcases !== undefined &&
    response.total_testcases > 0 &&
    response.total_correct === response.total_testcases

  if (operation === 'submit') {
    return statusCode === 10 || status === 'accepted' ? 'accepted' : 'other_terminal_error'
  }
  return statusCode === 10 ||
    status === 'accepted' ||
    response.run_success === true ||
    allCasesPassed
    ? 'passed'
    : 'other_terminal_error'
}

function mapCaseResults(response: ParsedPollResponse): JudgeCaseResult[] {
  const actualOutputs = response.code_answer ?? []
  const expectedOutputs = response.expected_code_answer ?? []
  const inputs = response.inputs ?? []
  const compareResults = response.compare_result?.trim() ?? ''
  const returnedCaseCount = Math.max(
    actualOutputs.length,
    expectedOutputs.length,
    compareResults.length
  )
  const reportedCaseCount =
    response.total_testcases !== null &&
    response.total_testcases !== undefined &&
    response.total_testcases > 0
      ? response.total_testcases
      : returnedCaseCount
  const caseCount =
    returnedCaseCount > 0
      ? Math.min(returnedCaseCount, reportedCaseCount)
      : reportedCaseCount
  const results: JudgeCaseResult[] = []
  const fallbackInput = response.input ?? response.last_testcase ?? null

  for (let index = 0; index < caseCount; index += 1) {
    const correct =
      index < compareResults.length
        ? compareResults[index] === '1'
        : null
    results.push({
      caseNumber: index + 1,
      correct,
      statusDisplay:
        correct === null ? firstNonEmpty(response.status_msg) : correct ? 'Passed' : 'Failed',
      input:
        inputs[index] ??
        (caseCount === 1 ? fallbackInput : null),
      expectedOutput:
        expectedOutputs[index] ??
        (caseCount === 1 ? firstOutput(response.expected_output) : null),
      actualOutput:
        actualOutputs[index] ??
        (caseCount === 1 ? firstOutput(response.code_output) : null)
    })
  }

  return results
}

function terminalLabel(response: ParsedPollResponse, operation: JudgeOperation): string {
  switch (response.status_code) {
    case 10:
      return operation === 'submit' ? 'Accepted' : 'Passed'
    case 11:
      return 'Wrong Answer'
    case 14:
      return 'Time Limit Exceeded'
    case 15:
      return 'Runtime Error'
    case 20:
      return 'Compile Error'
    default:
      return 'Judge completed'
  }
}

function createInterruptedResult(
  snapshot: OperationSnapshot,
  requestId: string,
  state: 'cancelled' | 'timed_out',
  completedAtMs: number
): JudgeResult {
  return {
    operation: snapshot.operation,
    problemSlug: snapshot.problemSlug,
    requestId,
    submissionId:
      snapshot.operation === 'submit' && requestId ? requestId : null,
    state,
    statusDisplay: state === 'cancelled' ? 'Cancelled' : 'Timed out',
    compileError: null,
    runtimeError: null,
    totalCorrect: null,
    totalTestcases: null,
    runtime: null,
    memory: null,
    cases: [],
    codeSnapshot: snapshot.codeSnapshot,
    testInputSnapshot: snapshot.testInputSnapshot,
    completedAtMs
  }
}

function parseExternal<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: string,
  logger: JudgeDiagnosticsLogger
): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    logger('invalid response', {
      context,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message
      })),
      response: describeUnknownValue(value)
    })
    throw new AppError(
      'API_CHANGED',
      'LeetCode returned an unexpected judge response.',
      result.error.message
    )
  }
  return result.data
}

const developmentJudgeLogger: JudgeDiagnosticsLogger = (
  event,
  details
): void => {
  logDevelopmentDiagnostic(
    'leetcode:judge',
    event,
    details,
    event === 'failed' || event === 'invalid response' ? 'error' : 'info'
  )
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details ?? null
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    }
  }
  return { value: String(error) }
}

function describeUnknownValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return { type: describeValueType(value) }
  }
  if (Array.isArray(value)) {
    return { type: describeValueType(value) }
  }

  return {
    type: 'object',
    fields: Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, fieldValue]) => [key, describeValueType(fieldValue)])
    )
  }
}

function describeValueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const itemTypes = [...new Set(value.map(describeValueType))]
    return `array(${itemTypes.join(' | ') || 'empty'})[${value.length}]`
  }
  return typeof value
}

async function parseJsonResponse(response: Response, context: string): Promise<unknown> {
  try {
    const text = await response.text()
    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError(
        'API_CHANGED',
        `LeetCode returned an unreadable ${context} response.`
      )
    }
    throw error
  }
}

function httpResponseError(response: Response, context: string): AppError {
  if (response.status === 401) {
    return new AppError(
      'AUTH_EXPIRED',
      'LeetCode rejected the stored session. Reconnect your account and try again.'
    )
  }
  if (response.status === 403) {
    if (response.headers.get('cf-mitigated') === 'challenge') {
      return new AppError(
        'ACCESS_DENIED',
        'LeetCode requires browser verification before judging. Open LeetCode, complete verification, then reconnect.'
      )
    }
    return new AppError(
      'AUTH_EXPIRED',
      'LeetCode did not authorise this judge request. Reconnect your account and try again.'
    )
  }
  if (response.status === 404) {
    return new AppError(
      'ACCESS_DENIED',
      'LeetCode could not find that problem or judge request.'
    )
  }
  if (response.status === 429) {
    return new AppError(
      'RATE_LIMITED',
      'LeetCode is receiving too many judge requests. Wait a moment before trying again.'
    )
  }
  return new AppError(
    'JUDGE_FAILED',
    `LeetCode rejected the ${context} (HTTP ${response.status}).`
  )
}

function mapJudgeError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (isAbortError(error)) {
    return new AppError('JUDGE_FAILED', 'The judge request was interrupted.')
  }
  if (error instanceof Error && /fetch|network|ECONN|ENOTFOUND|net::/i.test(error.message)) {
    return new AppError(
      'OFFLINE',
      'LeetCode could not be reached while judging. Check your connection and try again.'
    )
  }
  return new AppError(
    'JUDGE_FAILED',
    'LeetCode could not complete the judge request.',
    error instanceof Error ? error.message : undefined
  )
}

function assertProblemReference(problemSlug: string, internalProblemId: string): void {
  if (!/^[a-z0-9-]+$/.test(problemSlug) || !/^\d+$/.test(internalProblemId)) {
    throw new AppError('UNKNOWN', 'That judge request is not valid.')
  }
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError()
}

function createAbortError(): DOMException {
  return new DOMException('The operation was cancelled.', 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'The operation was cancelled.')
  )
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError())
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    unrefTimer(timer)

    function onAbort(): void {
      clearTimeout(timer)
      reject(createAbortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function nonNegativeDuration(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

function nextPollDelay(current: number, maximum: number): number {
  return Math.min(maximum, Math.max(1, current * 2))
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function formatMetric(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const formatted = String(value).trim()
  return formatted.length > 0 ? formatted : null
}

function firstOutput(
  value: string | number | Array<string | number> | null | undefined
): string | null {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : null
  }
  return value === null || value === undefined ? null : String(value)
}

function nullableInteger(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isInteger(value) ? value : null
}
