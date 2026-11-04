import { GraphQLClient } from 'graphql-request'
import { z } from 'zod'
import { LEETCODE_GRAPHQL_URL, LEETCODE_ORIGIN } from '@shared/constants'
import type {
  LeetCodeDifficultyStatistics,
  SubmissionDetail,
  SubmissionHistory,
  SubmissionSummary,
  UserStatistics
} from '@shared/types'
import { AppError } from '../security/app-error'
import type { LeetCodeAuthenticatedSession } from './auth-contract'
import {
  SUBMISSION_DETAIL_DOCUMENT,
  SUBMISSION_HISTORY_DOCUMENT,
  USER_STATISTICS_DOCUMENT,
  USER_STATUS_DOCUMENT
} from './queries'

const numericIdentifierSchema = z
  .union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().transform((value) => String(value))
  ])
const integerLikeSchema = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform((value) => Number(value))
])
const nullableTextSchema = z
  .union([z.string(), z.number().finite()])
  .nullable()
  .optional()

const submissionSummaryResponseSchema = z
  .object({
    id: numericIdentifierSchema,
    title: z.string(),
    titleSlug: z.string(),
    status: integerLikeSchema.nullable().optional(),
    statusDisplay: z.string(),
    timestamp: integerLikeSchema,
    lang: z.string(),
    langName: z.string(),
    runtime: nullableTextSchema,
    memory: nullableTextSchema
  })
  .passthrough()

const submissionHistoryResponseSchema = z.object({
  submissionList: z
    .object({
      lastKey: z.string().nullable().optional(),
      hasNext: z.boolean(),
      submissions: z.array(submissionSummaryResponseSchema)
    })
    .nullable()
})

const submissionDetailResponseSchema = z.object({
  submissionDetails: z
    .object({
      question: z
        .object({
          questionId: numericIdentifierSchema,
          questionFrontendId: numericIdentifierSchema,
          titleSlug: z.string(),
          title: z.string()
        })
        .nullable(),
      code: z.string().nullable(),
      lang: z.object({
        name: z.string(),
        verboseName: z.string()
      }),
      statusCode: integerLikeSchema.nullable().optional(),
      statusDisplay: z.string(),
      timestamp: integerLikeSchema,
      runtime: nullableTextSchema,
      memory: nullableTextSchema,
      runtimeDisplay: nullableTextSchema,
      memoryDisplay: nullableTextSchema
    })
    .nullable()
})

const userStatusResponseSchema = z.object({
  userStatus: z
    .object({
      isSignedIn: z.boolean(),
      username: z.string().nullable()
    })
    .nullable()
})

const difficultyStatisticsSchema = z.object({
  difficulty: z.enum(['All', 'Easy', 'Medium', 'Hard']),
  count: integerLikeSchema,
  submissions: integerLikeSchema
})

const userStatisticsResponseSchema = z.object({
  matchedUser: z
    .object({
      profile: z
        .object({
          ranking: integerLikeSchema.nullable().optional(),
          realName: z.string().nullable().optional(),
          userAvatar: z.string().nullable().optional()
        })
        .nullable(),
      submitStatsGlobal: z
        .object({
          acSubmissionNum: z.array(difficultyStatisticsSchema)
        })
        .nullable()
    })
    .nullable()
})

export type SubmissionListOptions = {
  offset?: number
  limit?: number
  lastKey?: string | null
}

export class SubmissionService {
  private readonly client: GraphQLClient

  constructor(private readonly session: LeetCodeAuthenticatedSession) {
    this.client = new GraphQLClient(LEETCODE_GRAPHQL_URL, {
      fetch: async (input, init) => {
        const pathOrUrl =
          input instanceof URL
            ? input.toString()
            : typeof input === 'string'
              ? input
              : input.url
        return this.session.request(pathOrUrl, init)
      },
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: `${LEETCODE_ORIGIN}/problemset/`,
        'User-Agent': 'LeetCodeDesktop/0.1'
      }
    })
  }

  async list(
    problemSlug: string,
    options: SubmissionListOptions = {}
  ): Promise<SubmissionHistory> {
    assertProblemSlug(problemSlug)
    const offset = nonNegativeInteger(options.offset ?? 0, 'offset')
    const limit = positiveInteger(options.limit ?? 20, 'limit', 50)
    const lastKey = options.lastKey ?? null
    if (lastKey !== null && lastKey.length > 500) {
      throw new AppError('UNKNOWN', 'That submission page cursor is not valid.')
    }

    const response = parseExternal(
      submissionHistoryResponseSchema,
      await this.request(
        SUBMISSION_HISTORY_DOCUMENT,
        { offset, limit, lastKey, questionSlug: problemSlug },
        'submissionList'
      )
    )
    if (!response.submissionList) {
      return { submissions: [], hasNext: false, lastKey: null }
    }

    const submissions = response.submissionList.submissions
      .map(normaliseSubmissionSummary)
      .sort((left, right) => right.timestamp - left.timestamp)

    return {
      submissions,
      hasNext: response.submissionList.hasNext,
      lastKey: nonEmpty(response.submissionList.lastKey)
    }
  }

  async detail(submissionId: string): Promise<SubmissionDetail> {
    assertSubmissionId(submissionId)
    const response = parseExternal(
      submissionDetailResponseSchema,
      await this.request(
        SUBMISSION_DETAIL_DOCUMENT,
        { submissionId: Number(submissionId) },
        'submissionDetails'
      )
    )
    const detail = response.submissionDetails
    if (
      !detail ||
      !detail.question ||
      detail.code === null ||
      detail.code.trim().length === 0
    ) {
      throw new AppError(
        'ACCESS_DENIED',
        'LeetCode did not make the submitted source available.'
      )
    }

    return {
      id: submissionId,
      title: detail.question.title,
      titleSlug: detail.question.titleSlug,
      status: detail.statusCode ?? null,
      statusDisplay: detail.statusDisplay,
      timestamp: detail.timestamp,
      language: detail.lang.name,
      languageName: detail.lang.verboseName,
      runtime: formatMetric(detail.runtimeDisplay ?? detail.runtime),
      memory: formatMetric(detail.memoryDisplay ?? detail.memory),
      code: detail.code,
      frontendProblemId: detail.question.questionFrontendId
    }
  }

  async getCurrentUserStatistics(): Promise<UserStatistics> {
    const userStatus = parseExternal(
      userStatusResponseSchema,
      await this.request(USER_STATUS_DOCUMENT, {}, 'globalData')
    )
    const username = userStatus.userStatus?.username?.trim()
    if (!userStatus.userStatus?.isSignedIn || !username) {
      throw new AppError(
        'AUTH_EXPIRED',
        'Your LeetCode session has expired. Reconnect your account and try again.'
      )
    }

    const response = parseExternal(
      userStatisticsResponseSchema,
      await this.request(USER_STATISTICS_DOCUMENT, { username }, 'userProfile')
    )
    const user = response.matchedUser
    if (!user) {
      throw new AppError(
        'ACCESS_DENIED',
        'LeetCode did not return statistics for the signed-in account.'
      )
    }

    const byDifficulty = (user.submitStatsGlobal?.acSubmissionNum ?? [])
      .map(normaliseDifficultyStatistics)
      .sort(
        (left, right) =>
          difficultyOrder(left.difficulty) - difficultyOrder(right.difficulty)
      )

    return {
      username,
      ranking: user.profile?.ranking ?? null,
      realName: nonEmpty(user.profile?.realName),
      avatarUrl: nonEmpty(user.profile?.userAvatar),
      byDifficulty
    }
  }

  async findLatestAcceptedCpp(problemSlug: string): Promise<SubmissionDetail | null> {
    assertProblemSlug(problemSlug)
    let offset = 0
    let lastKey: string | null = null
    let latestAccepted: SubmissionSummary | null = null
    let reachedEnd = false
    const seenCursors = new Set<string>()

    for (let page = 0; page < 100; page += 1) {
      const history = await this.list(problemSlug, { offset, limit: 50, lastKey })
      latestAccepted = selectLatestAcceptedCpp(history.submissions)
      if (latestAccepted) break
      if (!history.hasNext) {
        reachedEnd = true
        break
      }

      if (history.lastKey && seenCursors.has(history.lastKey)) {
        throw new AppError(
          'API_CHANGED',
          'LeetCode returned a repeating submission page cursor.'
        )
      }
      if (history.lastKey) seenCursors.add(history.lastKey)
      if (history.submissions.length === 0 && !history.lastKey) {
        throw new AppError(
          'API_CHANGED',
          'LeetCode reported another submission page without a usable cursor.'
        )
      }

      offset += history.submissions.length
      lastKey = history.lastKey
    }

    if (!latestAccepted && !reachedEnd) {
      throw new AppError(
        'API_CHANGED',
        'LeetCode returned more submission pages than this app can safely inspect.'
      )
    }
    if (!latestAccepted) return null

    const detail = await this.detail(latestAccepted.id)
    if (
      detail.id !== latestAccepted.id ||
      detail.titleSlug !== problemSlug ||
      !isAcceptedSubmission(detail) ||
      !isCppSubmission(detail)
    ) {
      throw new AppError(
        'API_CHANGED',
        'LeetCode returned a submission that does not match the selected Accepted C++ solution.'
      )
    }
    return detail
  }

  private async request(
    document: string,
    variables: Record<string, unknown>,
    operationName: string
  ): Promise<unknown> {
    try {
      return await this.client.request<unknown>({
        document,
        variables,
        requestHeaders: {
          'x-operation-name': operationName
        }
      })
    } catch (error) {
      throw mapSubmissionError(error)
    }
  }
}

export function isAcceptedSubmission(
  submission: Pick<SubmissionSummary, 'status' | 'statusDisplay'>
): boolean {
  const hasAcceptedDisplay =
    submission.statusDisplay.trim().toLowerCase() === 'accepted'
  return (
    hasAcceptedDisplay &&
    (submission.status === null || submission.status === 10)
  )
}

export function isCppSubmission(
  submission: Pick<SubmissionSummary, 'language'>
): boolean {
  return submission.language.trim().toLowerCase() === 'cpp'
}

export function selectLatestAcceptedCpp(
  submissions: readonly SubmissionSummary[]
): SubmissionSummary | null {
  let selected: SubmissionSummary | null = null
  for (const submission of submissions) {
    if (!isAcceptedSubmission(submission) || !isCppSubmission(submission)) continue
    if (!selected || submission.timestamp > selected.timestamp) {
      selected = submission
    }
  }
  return selected
}

function normaliseSubmissionSummary(
  submission: z.infer<typeof submissionSummaryResponseSchema>
): SubmissionSummary {
  return {
    id: submission.id,
    title: submission.title,
    titleSlug: submission.titleSlug,
    status: submission.status ?? null,
    statusDisplay: submission.statusDisplay,
    timestamp: submission.timestamp,
    language: submission.lang,
    languageName: submission.langName,
    runtime: formatMetric(submission.runtime),
    memory: formatMetric(submission.memory)
  }
}

function normaliseDifficultyStatistics(
  statistics: z.infer<typeof difficultyStatisticsSchema>
): LeetCodeDifficultyStatistics {
  return {
    difficulty: statistics.difficulty,
    solved: statistics.count,
    attempted: statistics.submissions
  }
}

function difficultyOrder(difficulty: LeetCodeDifficultyStatistics['difficulty']): number {
  switch (difficulty) {
    case 'All':
      return 0
    case 'Easy':
      return 1
    case 'Medium':
      return 2
    case 'Hard':
      return 3
  }
}

function parseExternal<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new AppError(
      'API_CHANGED',
      'LeetCode returned an unexpected submission response.',
      result.error.message
    )
  }
  return result.data
}

function mapSubmissionError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const response = getResponse(error)
  if (
    response?.status === 403 &&
    response.headers.get('cf-mitigated') === 'challenge'
  ) {
    return new AppError(
      'ACCESS_DENIED',
      'LeetCode requires browser verification before loading account data. Open LeetCode, complete verification, then reconnect.'
    )
  }
  if (response?.status === 401 || response?.status === 403) {
    return new AppError(
      'AUTH_EXPIRED',
      'LeetCode did not authorise this submission request. Reconnect your account and try again.'
    )
  }
  if (response?.status === 429) {
    return new AppError(
      'RATE_LIMITED',
      'LeetCode is receiving too many requests. Wait a moment before trying again.'
    )
  }
  if (response?.status === 404) {
    return new AppError(
      'ACCESS_DENIED',
      'LeetCode could not find that submission or account data.'
    )
  }
  if (
    error instanceof Error &&
    /fetch|network|ECONN|ENOTFOUND|net::/i.test(error.message)
  ) {
    return new AppError(
      'OFFLINE',
      'LeetCode could not be reached. Check your connection and try again.'
    )
  }
  return new AppError(
    'API_CHANGED',
    'LeetCode returned an unexpected submission response. The service may have changed.',
    error instanceof Error ? error.message : undefined
  )
}

function getResponse(error: unknown): Response | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined
  const response = (error as { response?: unknown }).response
  return response instanceof Response ? response : undefined
}

function assertProblemSlug(problemSlug: string): void {
  if (!/^[a-z0-9-]+$/.test(problemSlug)) {
    throw new AppError('UNKNOWN', 'That problem address is not valid.')
  }
}

function assertSubmissionId(submissionId: string): void {
  const numericId = Number(submissionId)
  if (
    !/^\d+$/.test(submissionId) ||
    !Number.isSafeInteger(numericId) ||
    numericId <= 0
  ) {
    throw new AppError('UNKNOWN', 'That submission identifier is not valid.')
  }
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError('UNKNOWN', `The submission ${label} is not valid.`)
  }
  return value
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new AppError('UNKNOWN', `The submission ${label} is not valid.`)
  }
  return value
}

function formatMetric(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const formatted = String(value).trim()
  return formatted.length > 0 ? formatted : null
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
