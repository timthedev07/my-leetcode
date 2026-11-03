import { Buffer } from 'node:buffer'
import { GITHUB_API_URL } from '@shared/constants'
import type {
  Difficulty,
  GitHubSyncOutcome,
  GitHubSyncPreview,
  SubmissionDetail
} from '@shared/types'
import { z } from 'zod'
import { AppError } from '../security/app-error'
import type { SubmissionService } from '../leetcode/submissions'
import type { RepositoryService, FetchTransport, TokenGetter } from './repository'

export type GitHubSyncSettings = {
  repository: string
  branch: string
}

type GitHubSyncServiceOptions = {
  getToken: TokenGetter
  repositoryService: RepositoryService
  submissionService: SubmissionService
  getSettings: () => Promise<GitHubSyncSettings | null>
  fetch: FetchTransport
  onSynced?: (submissionId: string, commitSha: string) => void | Promise<void>
}

type SyncInput = {
  problemSlug: string
  frontendProblemId: string
  difficulty: Difficulty
}

const treeSchema = z.object({
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
      sha: z.string()
    })
  ),
  truncated: z.boolean()
})

const contentsSchema = z.object({
  type: z.literal('file'),
  encoding: z.literal('base64'),
  content: z.string(),
  sha: z.string().min(1),
  html_url: z.url(),
  path: z.string().min(1)
})

const putContentsResponseSchema = z.object({
  content: z
    .object({
      html_url: z.url(),
      path: z.string()
    })
    .nullable(),
  commit: z.object({
    sha: z.string().min(1),
    html_url: z.url()
  })
})

export class GitHubSyncService {
  private readonly getToken: TokenGetter
  private readonly repositoryService: RepositoryService
  private readonly submissionService: SubmissionService
  private readonly getSettings: () => Promise<GitHubSyncSettings | null>
  private readonly transport: FetchTransport
  private readonly onSynced?: (submissionId: string, commitSha: string) => void | Promise<void>

  constructor(options: GitHubSyncServiceOptions) {
    this.getToken = options.getToken
    this.repositoryService = options.repositoryService
    this.submissionService = options.submissionService
    this.getSettings = options.getSettings
    this.transport = options.fetch
    if (options.onSynced) this.onSynced = options.onSynced
  }

  async prepare(input: SyncInput): Promise<GitHubSyncPreview> {
    const settings = await this.requireSettings()
    await this.repositoryService.verifyPushPermission(settings.repository, settings.branch)

    const submission = await this.submissionService.findLatestAcceptedCpp(input.problemSlug)
    if (!submission) {
      throw new AppError(
        'ACCESS_DENIED',
        'No server-recorded Accepted C++ submission is available for this problem.',
        'Submit an Accepted C++ solution on LeetCode before synchronising.'
      )
    }
    this.assertSubmissionMatches(submission, input)

    const targetPath = buildSolutionPath(input.difficulty, input.frontendProblemId)
    const existing = await this.findExistingFile(settings, targetPath, input.frontendProblemId)
    const currentCode = existing?.code ?? null
    const identical = currentCode !== null && currentCode === submission.code
    const caseConflict = existing !== null && existing.path !== targetPath

    return {
      sourceSubmissionId: submission.id,
      frontendProblemId: input.frontendProblemId,
      path: targetPath,
      existingPath: existing?.path ?? null,
      identical,
      requiresOverwriteConfirmation:
        !identical && (existing !== null || caseConflict),
      problemUrl: `https://leetcode.com/problems/${input.problemSlug}/`,
      sourceCode: submission.code,
      existingCode: currentCode,
      commitMessage: buildCommitMessage(input.frontendProblemId, targetPath, input.problemSlug)
    }
  }

  async execute(
    input: SyncInput,
    confirmOverwrite: boolean
  ): Promise<GitHubSyncOutcome> {
    const settings = await this.requireSettings()
    const preview = await this.prepare(input)
    const token = await this.requireToken()

    if (preview.existingPath && preview.existingPath !== preview.path) {
      throw new AppError(
        'GITHUB_CONFLICT',
        `An existing file uses different casing: ${preview.existingPath}.`,
        `Rename that file to ${preview.path} in ${settings.repository}, then synchronise again. No duplicate file was created.`
      )
    }
    if (preview.identical) {
      return {
        result: 'already-synchronised',
        submissionId: preview.sourceSubmissionId,
        path: preview.existingPath ?? preview.path,
        commitSha: null,
        fileUrl: fileUrl(settings.repository, settings.branch, preview.existingPath ?? preview.path),
        commitUrl: null
      }
    }
    if (preview.requiresOverwriteConfirmation && !confirmOverwrite) {
      throw new AppError(
        'GITHUB_CONFLICT',
        'The destination already contains different code. Confirm the overwrite before continuing.'
      )
    }

    const existingSha =
      preview.existingPath !== null
        ? await this.fetchFileSha(settings, preview.existingPath)
        : null

    const response = await this.request(
      `${repositoryApiUrl(settings)}/contents/${encodePathSegments(preview.path)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'LeetCodeDesktop/0.1'
        },
        body: JSON.stringify({
          message: preview.commitMessage,
          content: Buffer.from(preview.sourceCode, 'utf8').toString('base64'),
          branch: settings.branch,
          ...(existingSha ? { sha: existingSha } : {})
        })
      }
    )
    if (!response.ok) throw await mapGitHubError(response, 'GitHub could not commit the accepted solution')
    const result = parseExternal(putContentsResponseSchema, await readJson(response))
    if (!result.commit.sha || !result.content) {
      throw new AppError('API_CHANGED', 'GitHub did not confirm the committed file.')
    }

    await this.onSynced?.(preview.sourceSubmissionId, result.commit.sha)
    return {
      result: existingSha ? 'updated' : 'created',
      submissionId: preview.sourceSubmissionId,
      path: result.content.path,
      commitSha: result.commit.sha,
      fileUrl: result.content.html_url,
      commitUrl: result.commit.html_url
    }
  }

  private async findExistingFile(
    settings: GitHubSyncSettings,
    targetPath: string,
    frontendProblemId: string
  ): Promise<{ path: string; code: string } | null> {
    const token = await this.requireToken()
    const treeResponse = await this.request(
      `${repositoryApiUrl(settings)}/git/trees/${encodeURIComponent(settings.branch)}?recursive=1`,
      {
        headers: githubHeaders(token)
      }
    )
    if (!treeResponse.ok) throw await mapGitHubError(treeResponse, 'The destination tree could not be read')
    const tree = parseExternal(treeSchema, await readJson(treeResponse))
    if (tree.truncated) {
      throw new AppError(
        'API_CHANGED',
        'The destination repository tree is too large to verify safely.',
        'No file was changed.'
      )
    }

    const files = tree.tree.filter((entry) => entry.type === 'blob')
    const exact = files.find((entry) => entry.path.toLowerCase() === targetPath.toLowerCase())
    const legacyName = `problem${frontendProblemId}.cpp`.toLowerCase()
    const byFilename = files.filter(
      (entry) => entry.path.split('/').at(-1)?.toLowerCase() === legacyName
    )
    const candidates = exact ? [exact] : byFilename
    if (candidates.length > 1) {
      throw new AppError(
        'GITHUB_CONFLICT',
        'Multiple files match this problem in the destination repository.',
        `Conflicting paths: ${candidates.map((entry) => entry.path).join(', ')}. No file was changed.`
      )
    }
    const existing = candidates[0]
    if (!existing) return null

    const contentResponse = await this.request(
      `${repositoryApiUrl(settings)}/contents/${encodePathSegments(existing.path)}?ref=${encodeURIComponent(settings.branch)}`,
      { headers: githubHeaders(token) }
    )
    if (contentResponse.status === 404) {
      throw new AppError('GITHUB_CONFLICT', 'The destination file changed while reading it. No file was changed.')
    }
    if (!contentResponse.ok) throw await mapGitHubError(contentResponse, 'The destination file could not be read')
    const content = parseExternal(contentsSchema, await readJson(contentResponse))
    return {
      path: content.path,
      code: Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf8')
    }
  }

  private async fetchFileSha(settings: GitHubSyncSettings, path: string): Promise<string> {
    const token = await this.requireToken()
    const response = await this.request(
      `${repositoryApiUrl(settings)}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(settings.branch)}`,
      { headers: githubHeaders(token) }
    )
    if (!response.ok) throw await mapGitHubError(response, 'The destination file SHA could not be verified')
    return parseExternal(contentsSchema, await readJson(response)).sha
  }

  private async requireSettings(): Promise<GitHubSyncSettings> {
    const settings = await this.getSettings()
    if (!settings) {
      throw new AppError(
        'ACCESS_DENIED',
        'Select and confirm a GitHub repository and branch in Settings before synchronising.'
      )
    }
    return settings
  }

  private async requireToken(): Promise<string> {
    const token = await this.getToken()
    if (!token) throw new AppError('AUTH_EXPIRED', 'Connect GitHub before synchronising.')
    return token
  }

  private request(url: string, init: RequestInit): Promise<Response> {
    return this.transport(url, init)
  }

  private assertSubmissionMatches(submission: SubmissionDetail, input: SyncInput): void {
    if (
      submission.titleSlug !== input.problemSlug ||
      submission.frontendProblemId !== input.frontendProblemId ||
      submission.statusDisplay !== 'Accepted' ||
      submission.language.toLowerCase() !== 'cpp'
    ) {
      throw new AppError(
        'ACCESS_DENIED',
        'The latest accepted source does not match this C++ problem.',
        'No file was changed.'
      )
    }
  }
}

export function buildSolutionPath(difficulty: Difficulty, frontendProblemId: string): string {
  if (!/^\d+$/.test(frontendProblemId)) {
    throw new AppError('UNKNOWN', 'The displayed problem ID is not valid.')
  }
  return `${difficulty.toLowerCase()}/Problem${frontendProblemId}.cpp`
}

export function buildCommitMessage(
  frontendProblemId: string,
  path: string,
  problemSlug: string
): string {
  return `Upload problem ${frontendProblemId} to ${path}\n\nhttps://leetcode.com/problems/${problemSlug}/`
}

function repositoryApiUrl(settings: GitHubSyncSettings): string {
  const [owner, name] = settings.repository.split('/')
  if (!owner || !name) throw new AppError('UNKNOWN', 'The configured GitHub repository is not valid.')
  return `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

function encodePathSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function fileUrl(repository: string, branch: string, path: string): string {
  return `https://github.com/${repository}/blob/${encodeURIComponent(branch)}/${encodePathSegments(path)}`
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LeetCodeDesktop/0.1'
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new AppError(
      'API_CHANGED',
      'GitHub returned an unreadable response.',
      error instanceof Error ? error.message : undefined
    )
  }
}

function parseExternal<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new AppError('API_CHANGED', 'GitHub returned an unexpected response.', result.error.message)
  }
  return result.data
}

async function mapGitHubError(response: Response, operation: string): Promise<AppError> {
  if (response.status === 401) {
    return new AppError('AUTH_EXPIRED', `${operation}: GitHub sign-in has expired.`)
  }
  if (response.status === 403) {
    return new AppError('ACCESS_DENIED', `${operation}: the token or repository permissions do not allow this operation.`)
  }
  if (response.status === 404) {
    return new AppError('ACCESS_DENIED', `${operation}: the repository, branch or file was not found.`)
  }
  if (response.status === 409 || response.status === 422) {
    return new AppError('GITHUB_CONFLICT', `${operation}: the branch or file changed. No file was overwritten.`)
  }
  if (response.status === 429) {
    return new AppError('RATE_LIMITED', `${operation}: GitHub rate limit reached. Try again later.`)
  }
  return new AppError('GITHUB_CONFLICT', `${operation}: GitHub rejected the request (${response.status}).`)
}

