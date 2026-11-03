import { GITHUB_API_URL } from '@shared/constants'
import type { GitHubBranch, GitHubRepository } from '@shared/types'
import { z } from 'zod'
import { AppError } from '../security/app-error'

export type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type TokenGetter = () => string | null | Promise<string | null>

const repositorySchema = z.object({
  name: z.string().min(1),
  full_name: z.string().min(1),
  private: z.boolean(),
  default_branch: z.string().min(1),
  owner: z.object({
    login: z.string().min(1)
  }),
  permissions: z
    .object({
      push: z.boolean().optional()
    })
    .optional()
})

const branchSchema = z.object({
  name: z.string().min(1)
})

const PER_PAGE = 100
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPOSITORY_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/

export class RepositoryService {
  constructor(
    private readonly getToken: TokenGetter,
    private readonly transport: FetchTransport
  ) {}

  async listRepositories(): Promise<GitHubRepository[]> {
    const records = await this.getAllPages(
      `${GITHUB_API_URL}/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&per_page=${PER_PAGE}`,
      z.array(repositorySchema),
      'GitHub repositories could not be loaded'
    )
    return records.map(toRepository)
  }

  async listBranches(owner: string, name: string): Promise<GitHubBranch[]> {
    validateOwner(owner)
    validateRepositoryName(name)

    const records = await this.getAllPages(
      `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=${PER_PAGE}`,
      z.array(branchSchema),
      'GitHub branches could not be loaded'
    )
    return records.map((branch) => ({ name: branch.name }))
  }

  async verifyPushPermission(
    ownerOrRepository: string,
    nameOrBranch: string,
    branch?: string
  ): Promise<GitHubRepository> {
    const coordinates =
      branch === undefined
        ? { ...parseRepository(ownerOrRepository), branch: nameOrBranch }
        : { owner: ownerOrRepository, name: nameOrBranch, branch }

    validateOwner(coordinates.owner)
    validateRepositoryName(coordinates.name)
    validateBranch(coordinates.branch)

    const repositoryUrl = `${GITHUB_API_URL}/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.name)}`
    const branchUrl = `${repositoryUrl}/branches/${encodeURIComponent(coordinates.branch)}`

    const [repositoryRecord] = await Promise.all([
      this.getJson(repositoryUrl, repositorySchema, 'GitHub repository details could not be loaded'),
      this.getJson(branchUrl, branchSchema, 'The selected GitHub branch could not be verified')
    ])

    const repository = toRepository(repositoryRecord)
    if (!repository.canPush) {
      throw new AppError(
        'ACCESS_DENIED',
        `You do not have permission to push to ${repository.fullName}.`,
        'Choose a repository where your GitHub account has write access.'
      )
    }
    return repository
  }

  validateDestination(repository: string, branch: string): Promise<GitHubRepository> {
    return this.verifyPushPermission(repository, branch)
  }

  private async getAllPages<T>(
    initialUrl: string,
    schema: z.ZodType<T[]>,
    operation: string
  ): Promise<T[]> {
    const records: T[] = []
    const visited = new Set<string>()
    let nextUrl: string | null = initialUrl

    while (nextUrl) {
      if (visited.has(nextUrl)) {
        throw new AppError('API_CHANGED', `${operation}: GitHub returned a circular page link.`)
      }
      visited.add(nextUrl)

      const response = await this.request(nextUrl)
      if (!response.ok) throw await mapGitHubHttpError(response, operation)

      const page = await parseJson(response, schema, operation)
      records.push(...page)
      nextUrl = parseNextPage(response.headers.get('link'))
    }

    return records
  }

  private async getJson<T>(url: string, schema: z.ZodType<T>, operation: string): Promise<T> {
    const response = await this.request(url)
    if (!response.ok) throw await mapGitHubHttpError(response, operation)
    return parseJson(response, schema, operation)
  }

  private async request(url: string): Promise<Response> {
    const token = await this.getToken()
    if (!token) {
      throw new AppError('AUTH_EXPIRED', 'Connect GitHub before loading repositories.')
    }

    try {
      return await this.transport(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'LeetCodeDesktop/0.1',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })
    } catch (error) {
      throw new AppError(
        'OFFLINE',
        'GitHub could not be reached. Check your connection and try again.',
        error instanceof Error ? error.message : undefined
      )
    }
  }
}

function toRepository(record: z.infer<typeof repositorySchema>): GitHubRepository {
  return {
    owner: record.owner.login,
    name: record.name,
    fullName: record.full_name,
    private: record.private,
    defaultBranch: record.default_branch,
    canPush: record.permissions?.push === true
  }
}

function parseRepository(repository: string): { owner: string; name: string } {
  const parts = repository.split('/')
  if (parts.length !== 2) {
    throw new AppError('UNKNOWN', 'Enter the GitHub repository as owner/name.')
  }

  const [owner, name] = parts
  if (!owner || !name) {
    throw new AppError('UNKNOWN', 'Enter the GitHub repository as owner/name.')
  }
  return { owner, name }
}

function validateOwner(owner: string): void {
  if (!OWNER_PATTERN.test(owner)) {
    throw new AppError('UNKNOWN', 'The GitHub owner name is not valid.')
  }
}

function validateRepositoryName(name: string): void {
  if (!REPOSITORY_PATTERN.test(name)) {
    throw new AppError('UNKNOWN', 'The GitHub repository name is not valid.')
  }
}

function validateBranch(branch: string): void {
  const hasControlCharacter = Array.from(branch).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 32 || codePoint === 127
  })
  const invalid =
    branch.length === 0 ||
    branch.length > 255 ||
    hasControlCharacter ||
    ['~', '^', ':', '?', '*', '[', '\\'].some((character) => branch.includes(character)) ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.includes('//') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock')

  if (invalid) {
    throw new AppError('UNKNOWN', 'The GitHub branch name is not valid.')
  }
}

function parseNextPage(linkHeader: string | null): string | null {
  if (!linkHeader) return null

  const next = /<([^>]+)>;\s*rel="next"/.exec(linkHeader)?.[1]
  if (!next) return null

  const url = new URL(next)
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com') {
    throw new AppError('API_CHANGED', 'GitHub returned an unsafe repository page link.')
  }
  return url.toString()
}

async function parseJson<T>(response: Response, schema: z.ZodType<T>, operation: string): Promise<T> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new AppError(
      'API_CHANGED',
      `${operation}: GitHub returned an unreadable response.`,
      error instanceof Error ? error.message : undefined
    )
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new AppError(
      'API_CHANGED',
      `${operation}: GitHub returned an unexpected response.`,
      parsed.error.issues[0]?.message
    )
  }
  return parsed.data
}

async function mapGitHubHttpError(response: Response, operation: string): Promise<AppError> {
  const detail = await responseDetail(response)
  switch (response.status) {
    case 401:
      return new AppError('AUTH_EXPIRED', 'GitHub authorisation has expired. Reconnect GitHub.', detail)
    case 403:
      return new AppError('ACCESS_DENIED', `${operation}: GitHub denied access.`, detail)
    case 404:
      return new AppError(
        'ACCESS_DENIED',
        `${operation}: the resource was not found or your account cannot access it.`,
        detail
      )
    case 409:
      return new AppError('GITHUB_CONFLICT', `${operation}: the repository changed.`, detail)
    case 429:
      return new AppError('RATE_LIMITED', `${operation}: the GitHub rate limit was reached.`, detail)
    default:
      return new AppError('API_CHANGED', `${operation}: GitHub returned an unexpected error.`, detail)
  }
}

async function responseDetail(response: Response): Promise<string> {
  const prefix = `GitHub returned HTTP ${response.status}.`
  try {
    const payload = (await response.json()) as unknown
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
    ) {
      return `${prefix} ${payload.message.slice(0, 300)}`
    }
  } catch {
    // The status code remains available when GitHub does not return JSON.
  }
  return prefix
}
