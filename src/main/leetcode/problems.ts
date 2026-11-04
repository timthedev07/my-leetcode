import { z } from 'zod'
import sanitiseHtml from 'sanitize-html'
import type { Difficulty, ProblemDetail, ProblemSummary, TopicTag } from '@shared/types'
import { difficultySchema, problemDetailSchema, problemSummarySchema } from '@shared/schemas'
import { AppError } from '../security/app-error'
import { PROBLEM_SEARCH_DOCUMENT, QUESTION_DETAIL_DOCUMENT } from './queries'
import { LeetCodeGraphQLClient, type FetchTransport } from './transport'

const rawTopicTagSchema = z.object({
  name: z.string(),
  slug: z.string()
})

const rawProblemSummarySchema = z.object({
  frontendQuestionId: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  titleSlug: z.string(),
  difficulty: z.string(),
  paidOnly: z.boolean(),
  topicTags: z.array(rawTopicTagSchema).nullable().optional()
})

const problemSearchResponseSchema = z.object({
  problemsetQuestionList: z
    .object({
      total: z.number().int().nonnegative(),
      questions: z.array(rawProblemSummarySchema)
    })
    .nullable()
})

const rawCodeSnippetSchema = z.object({
  lang: z.string(),
  langSlug: z.string(),
  code: z.string()
})

const problemMetadataSchema = z
  .object({
    params: z.array(
      z.object({
        name: z.string(),
        type: z.string()
      })
    )
  })
  .passthrough()

const problemDetailResponseSchema = z.object({
  question: z
    .object({
      questionId: z.union([z.string(), z.number()]).transform(String),
      questionFrontendId: z.union([z.string(), z.number()]).transform(String),
      title: z.string(),
      titleSlug: z.string(),
      difficulty: z.string(),
      isPaidOnly: z.boolean(),
      content: z.string().nullable(),
      topicTags: z.array(rawTopicTagSchema).nullable().optional(),
      hints: z.array(z.string()).nullable().optional(),
      codeSnippets: z.array(rawCodeSnippetSchema).nullable().optional(),
      exampleTestcases: z.string().nullable().optional(),
      metaData: z.string().nullable().optional()
    })
    .nullable()
})

export type ProblemSearchResult = {
  problems: ProblemSummary[]
  total: number
  page: number
  pageSize: number
}

export class LeetCodeProblemsService {
  private readonly client: LeetCodeGraphQLClient
  private readonly detailCache = new Map<string, { expiresAtMs: number; value: ProblemDetail }>()
  private readonly now: () => number
  private readonly cacheTtlMs: number

  constructor(
    transport?: FetchTransport,
    options: { now?: () => number; cacheTtlMs?: number } = {}
  ) {
    this.client = new LeetCodeGraphQLClient(transport)
    this.now = options.now ?? Date.now
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 60 * 1000
  }

  async search(query: string, page = 1, pageSize = 20): Promise<ProblemSearchResult> {
    const safePage = Math.max(1, Math.floor(page))
    const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)))
    const searchKeywords = query.trim()
    if (searchKeywords.length === 0) {
      return { problems: [], total: 0, page: safePage, pageSize: safePageSize }
    }

    const response = parseExternal(
      problemSearchResponseSchema,
      await this.client.request<unknown>(
        PROBLEM_SEARCH_DOCUMENT,
        {
          categorySlug: '',
          limit: safePageSize,
          skip: (safePage - 1) * safePageSize,
          filters: { searchKeywords }
        },
        'problemsetQuestionList'
      )
    )

    if (!response.problemsetQuestionList) {
      return { problems: [], total: 0, page: safePage, pageSize: safePageSize }
    }

    const problems = response.problemsetQuestionList.questions
      .map(normaliseProblemSummary)
      .filter((problem): problem is ProblemSummary => problem !== null)
      .sort((left, right) => rankProblem(right, searchKeywords) - rankProblem(left, searchKeywords))

    return {
      problems,
      total: response.problemsetQuestionList.total,
      page: safePage,
      pageSize: safePageSize
    }
  }

  async getProblem(titleSlug: string): Promise<ProblemDetail> {
    if (!/^[a-z0-9-]+$/.test(titleSlug)) {
      throw new AppError('UNKNOWN', 'That problem address is not valid.')
    }

    const cached = this.detailCache.get(titleSlug)
    if (cached && cached.expiresAtMs > this.now()) return cached.value

    const response = parseExternal(
      problemDetailResponseSchema,
      await this.client.request<unknown>(QUESTION_DETAIL_DOCUMENT, { titleSlug }, 'questionData')
    )
    const question = response.question
    if (!question) {
      throw new AppError('ACCESS_DENIED', 'LeetCode did not return this problem. It may be unavailable or removed.')
    }

    const difficulty = parseDifficulty(question.difficulty)
    const starterCode = question.codeSnippets?.find((snippet) => snippet.langSlug === 'cpp')?.code ?? ''
    const topicTags = (question.topicTags ?? []).map(normaliseTopicTag)
    const metadata = parseProblemMetadata(question.metaData)
    const parameterCount = metadata?.params.length ?? 0

    const problem = problemDetailSchema.parse({
      internalId: question.questionId,
      frontendId: question.questionFrontendId,
      title: question.title,
      titleSlug: question.titleSlug,
      difficulty,
      isPaidOnly: question.isPaidOnly,
      contentHtml: sanitiseProblemHtml(question.content ?? ''),
      topicTags,
      hints: (question.hints ?? []).map(sanitiseProblemHtml),
      starterCode,
      exampleTestCases: splitExampleTestCases(
        question.exampleTestcases ?? '',
        parameterCount
      )
    })
    this.cacheDetail(titleSlug, problem)
    return problem
  }

  private cacheDetail(titleSlug: string, problem: ProblemDetail): void {
    if (this.detailCache.size >= 100) {
      while (this.detailCache.size >= 100) {
        const oldestKey = this.detailCache.keys().next().value
        if (typeof oldestKey !== 'string') break
        this.detailCache.delete(oldestKey)
      }
    }
    this.detailCache.set(titleSlug, {
      expiresAtMs: this.now() + this.cacheTtlMs,
      value: problem
    })
  }
}

export function splitExampleTestCases(input: string, parameterCount: number): string[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const lines = trimmed.split(/\r?\n/)
  if (
    parameterCount < 1 ||
    lines.length <= parameterCount ||
    lines.length % parameterCount !== 0
  ) {
    return [trimmed]
  }

  const cases: string[] = []
  for (let index = 0; index < lines.length; index += parameterCount) {
    cases.push(lines.slice(index, index + parameterCount).join('\n'))
  }
  return cases
}

function parseProblemMetadata(value: string | null | undefined): z.infer<
  typeof problemMetadataSchema
> | null {
  if (!value) return null
  try {
    const result = problemMetadataSchema.safeParse(JSON.parse(value) as unknown)
    return result.success ? result.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export function normaliseProblemSummary(raw: z.infer<typeof rawProblemSummarySchema>): ProblemSummary | null {
  try {
    return problemSummarySchema.parse({
      frontendId: raw.frontendQuestionId,
      title: raw.title,
      titleSlug: raw.titleSlug,
      difficulty: parseDifficulty(raw.difficulty),
      isPaidOnly: raw.paidOnly,
      topicTags: (raw.topicTags ?? []).map(normaliseTopicTag)
    })
  } catch {
    return null
  }
}

export function rankProblem(problem: ProblemSummary, query: string): number {
  const normalised = query.trim().toLowerCase()
  const title = problem.title.toLowerCase()
  const slug = problem.titleSlug.toLowerCase()
  const id = problem.frontendId

  if (normalised === id) return 1_000
  if (normalised === slug) return 950
  if (normalised === title) return 900
  if (title.startsWith(normalised)) return 800
  if (slug.startsWith(normalised)) return 750
  if (id.startsWith(normalised)) return 700
  if (title.includes(normalised)) return 600
  if (slug.includes(normalised)) return 550
  if (problem.topicTags.some((tag) => tag.name.toLowerCase().includes(normalised))) return 300
  return 0
}

export function sanitiseProblemHtml(html: string): string {
  return sanitiseHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'code',
      'pre',
      'ul',
      'ol',
      'li',
      'blockquote',
      'sup',
      'sub',
      'span',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td'
    ],
    allowedAttributes: {
      a: ['href'],
      code: ['class']
    },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => {
        const href = attributes.href
        return {
          tagName: 'a',
          attribs:
            href && href.startsWith('https://')
              ? {
                  href,
                  rel: 'noreferrer noopener'
                }
              : {}
        }
      }
    },
    disallowedTagsMode: 'discard'
  })
}

function normaliseTopicTag(tag: z.infer<typeof rawTopicTagSchema>): TopicTag {
  return { name: tag.name, slug: tag.slug }
}

function parseDifficulty(value: string): Difficulty {
  const result = difficultySchema.safeParse(value)
  if (!result.success) {
    throw new AppError('API_CHANGED', 'LeetCode returned an unsupported difficulty value.')
  }
  return result.data
}

function parseExternal<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(
      'API_CHANGED',
      'LeetCode returned an unexpected response. The service may have changed.',
      parsed.error.message
    )
  }
  return parsed.data
}

