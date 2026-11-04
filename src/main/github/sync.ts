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
import {
  encodePathSegments,
  githubHeaders,
  githubTransportError,
  mapGitHubResponseError,
  parseGitHubResponse,
  readGitHubJson
} from './github-http'
import {
  PROGRESS_PATH,
  findProblemById,
  prepareProgressUpdate,
  serialiseProgressDocument,
  validateProgressDocument,
  type GitHubDestination,
  type GitHubProgressService,
  type GitHubTreeFile,
  type ProgressSnapshot
} from './progress'
import type { RepositoryService, FetchTransport, TokenGetter } from './repository'

type GitHubSyncServiceOptions = {
  getToken: TokenGetter
  repositoryService: RepositoryService
  submissionService: SubmissionService
  getSettings: () => Promise<GitHubDestination | null>
  progressService: GitHubProgressService
  fetch: FetchTransport
  onSynced?: (submissionId: string, commitSha: string) => void | Promise<void>
  maxAttempts?: number
}

type SyncInput = {
  problemSlug: string
  frontendProblemId: string
  difficulty: Difficulty
}

type SyncPlan = GitHubSyncPreview & {
  snapshot: ProgressSnapshot
  updatedDocument: ProgressSnapshot['document']
}

const contentsSchema = z.object({
  type: z.literal('file'),
  encoding: z.literal('base64'),
  content: z.string(),
  sha: z.string().min(1),
  html_url: z.url(),
  path: z.string().min(1)
})

const blobSchema = z.object({
  sha: z.string().min(1)
})

const treeResponseSchema = z.object({
  sha: z.string().min(1)
})

const commitResponseSchema = z.object({
  sha: z.string().min(1)
})

const refResponseSchema = z.object({
  object: z.object({
    sha: z.string().min(1)
  })
})

export class GitHubSyncService {
  private readonly getToken: TokenGetter
  private readonly repositoryService: RepositoryService
  private readonly submissionService: SubmissionService
  private readonly getSettings: () => Promise<GitHubDestination | null>
  private readonly progressService: GitHubProgressService
  private readonly transport: FetchTransport
  private readonly onSynced?: (submissionId: string, commitSha: string) => void | Promise<void>
  private readonly maxAttempts: number
  private running = false

  constructor(options: GitHubSyncServiceOptions) {
    this.getToken = options.getToken
    this.repositoryService = options.repositoryService
    this.submissionService = options.submissionService
    this.getSettings = options.getSettings
    this.progressService = options.progressService
    this.transport = options.fetch
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3)
    if (options.onSynced) this.onSynced = options.onSynced
  }

  async prepare(input: SyncInput): Promise<GitHubSyncPreview> {
    const settings = await this.requireSettings()
    await this.repositoryService.verifyPushPermission(settings.repository, settings.branch)
    const submission = await this.findAcceptedSubmission(input)
    const snapshot = await this.progressService.loadSnapshot(settings)
    return toPreview(await this.buildPlan(snapshot, submission, input))
  }

  async execute(
    input: SyncInput,
    confirmOverwrite: boolean,
    expectedSubmissionId: string
  ): Promise<GitHubSyncOutcome> {
    if (this.running) {
      throw new AppError(
        'GITHUB_CONFLICT',
        'A GitHub synchronisation is already in progress.',
        'Wait for the current operation to finish before starting another.'
      )
    }
    this.running = true
    try {
      return await this.executeExclusively(
        input,
        confirmOverwrite,
        expectedSubmissionId
      )
    } finally {
      this.running = false
    }
  }

  private async executeExclusively(
    input: SyncInput,
    confirmOverwrite: boolean,
    expectedSubmissionId: string
  ): Promise<GitHubSyncOutcome> {
    const settings = await this.requireSettings()
    await this.repositoryService.verifyPushPermission(settings.repository, settings.branch)
    let token = await this.requireToken()
    let snapshot = await this.progressService.loadSnapshot(settings)

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      token = await this.requireToken()
      const submission = await this.findAcceptedSubmission(input)
      if (submission.id !== expectedSubmissionId) {
        throw new AppError(
          'GITHUB_CONFLICT',
          'The latest Accepted C++ submission changed after the preview.',
          'Review the synchronisation again before committing.'
        )
      }
      const plan = await this.buildPlan(snapshot, submission, input)
      if (plan.requiresOverwriteConfirmation && !confirmOverwrite) {
        throw new AppError(
          'GITHUB_CONFLICT',
          'The destination already contains different code. Confirm the overwrite before continuing.'
        )
      }
      if (plan.changedFiles.length === 0) {
        return toOutcome(plan, null, false)
      }

      validateProgressDocument(
        plan.updatedDocument,
        new Set([...snapshot.files.map((file) => file.path), plan.path])
      )

      const solutionBlobSha =
        plan.solutionAction === 'unchanged'
          ? null
          : await this.createBlob(
              settings,
              token,
              plan.sourceCode,
              `accepted solution for problem ${plan.frontendProblemId}`
            )
      const progressBlobSha =
        plan.progressAction === 'unchanged'
          ? null
          : await this.createBlob(
              settings,
              token,
              serialiseProgressDocument(plan.updatedDocument),
              `${PROGRESS_PATH} for problem ${plan.frontendProblemId}`
            )

      const treeEntries = [
        ...(solutionBlobSha
          ? [{ path: plan.path, mode: '100644', type: 'blob', sha: solutionBlobSha }]
          : []),
        ...(progressBlobSha
          ? [{ path: PROGRESS_PATH, mode: '100644', type: 'blob', sha: progressBlobSha }]
          : [])
      ]
      const nextTreeSha = await this.createTree(
        settings,
        token,
        snapshot.treeSha,
        treeEntries
      )
      const commitMessage = buildTransactionalCommitMessage(plan)
      const commitSha = await this.createCommit(
        settings,
        token,
        nextTreeSha,
        snapshot.headSha,
        commitMessage
      )

      const updated = await this.updateBranchReference(settings, token, commitSha)
      if (updated === 'conflict') {
        snapshot = await this.progressService.loadSnapshot(settings)
        continue
      }
      if (updated === 'ambiguous') {
        const currentHead = await this.readHeadSha(settings, token)
        if (currentHead === commitSha) {
          await this.onSynced?.(plan.sourceSubmissionId, commitSha)
          return toOutcome(plan, commitSha, true)
        }
        snapshot = await this.progressService.loadSnapshot(settings)
        continue
      }

      await this.onSynced?.(plan.sourceSubmissionId, commitSha)
      return toOutcome(plan, commitSha, true)
    }

    throw new AppError(
      'GITHUB_CONFLICT',
      'The GitHub branch changed repeatedly while preparing the commit.',
      'No commit was forced. Review the latest progress data and try synchronising again.'
    )
  }

  private async buildPlan(
    snapshot: ProgressSnapshot,
    submission: SubmissionDetail,
    input: SyncInput
  ): Promise<SyncPlan> {
    this.assertSubmissionMatches(submission, input)
    const settings = snapshot.destination
    const targetPath = buildSolutionPath(input.difficulty, input.frontendProblemId)
    const existingFile = findExistingCpp(snapshot.files, targetPath, input.frontendProblemId)
    const path = existingFile?.path ?? targetPath
    if (
      existingFile &&
      existingFile.path.toLowerCase() === targetPath.toLowerCase() &&
      existingFile.path !== targetPath
    ) {
      throw new AppError(
        'GITHUB_CONFLICT',
        `An existing file uses different casing: ${existingFile.path}.`,
        `Rename that file to ${targetPath} in ${settings.repository}, then synchronise again. No duplicate file was created.`
      )
    }

    const existingCode = existingFile
      ? await this.fetchFileContent(settings, snapshot.headSha, existingFile.path)
      : null
    const identical = existingCode !== null && existingCode === submission.code
    const solutionAction = identical
      ? 'unchanged'
      : existingFile
        ? 'update'
        : 'create'
    const existingProblem = findProblemById(snapshot.document, Number(input.frontendProblemId))
    const progressUpdate = prepareProgressUpdate(
      snapshot.document,
      {
        id: Number(input.frontendProblemId),
        name: submission.title,
        slug: submission.titleSlug,
        difficulty: input.difficulty
      },
      path
    )
    const changedFiles = [
      ...(solutionAction === 'unchanged' ? [] : [path]),
      ...(progressUpdate.action === 'unchanged' ? [] : [PROGRESS_PATH])
    ]

    return {
      sourceSubmissionId: submission.id,
      frontendProblemId: input.frontendProblemId,
      problemName: submission.title,
      problemSlug: submission.titleSlug,
      difficulty: input.difficulty,
      repository: settings.repository,
      branch: settings.branch,
      path,
      existingPath: existingFile?.path ?? null,
      identical,
      solutionAction,
      previousDone: existingProblem?.done ?? false,
      nextDone: true,
      curated: existingProblem?.phase !== null && existingProblem?.phase !== undefined,
      phase: existingProblem?.phase ?? null,
      order: existingProblem?.order ?? null,
      progressAction: progressUpdate.action,
      changedFiles,
      requiresOverwriteConfirmation: existingFile !== null && !identical,
      problemUrl: `https://leetcode.com/problems/${submission.titleSlug}/`,
      sourceCode: submission.code,
      existingCode,
      commitMessage: buildCommitMessage(
        input.frontendProblemId,
        path,
        submission.titleSlug
      ),
      snapshot,
      updatedDocument: progressUpdate.document
    }
  }

  private async findAcceptedSubmission(input: SyncInput): Promise<SubmissionDetail> {
    const submission = await this.submissionService.findLatestAcceptedCpp(input.problemSlug)
    if (!submission) {
      throw new AppError(
        'ACCESS_DENIED',
        'No server-recorded Accepted C++ submission is available for this problem.',
        'Submit an Accepted C++ solution on LeetCode before synchronising.'
      )
    }
    this.assertSubmissionMatches(submission, input)
    return submission
  }

  private async fetchFileContent(
    settings: GitHubDestination,
    revision: string,
    path: string
  ): Promise<string> {
    const token = await this.requireToken()
    const response = await this.request(
      `${repositoryApiUrl(settings)}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(revision)}`,
      token
    )
    if (!response.ok) {
      throw await mapGitHubResponseError(response, 'The destination file could not be read')
    }
    const content = parseGitHubResponse(
      contentsSchema,
      await readGitHubJson(response, 'The destination file could not be read'),
      'The destination file could not be read'
    )
    return Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf8')
  }

  private async createBlob(
    settings: GitHubDestination,
    token: string,
    content: string,
    description: string
  ): Promise<string> {
    const response = await this.request(`${repositoryApiUrl(settings)}/git/blobs`, token, {
      method: 'POST',
      body: JSON.stringify({
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64'
      })
    })
    if (!response.ok) {
      throw await mapGitHubResponseError(response, `GitHub could not create the ${description} blob`)
    }
    return parseGitHubResponse(
      blobSchema,
      await readGitHubJson(response, `The ${description} blob could not be created`),
      `The ${description} blob could not be created`
    ).sha
  }

  private async createTree(
    settings: GitHubDestination,
    token: string,
    baseTree: string,
    entries: Array<{ path: string; mode: string; type: string; sha: string }>
  ): Promise<string> {
    const response = await this.request(`${repositoryApiUrl(settings)}/git/trees`, token, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: entries
      })
    })
    if (!response.ok) {
      throw await mapGitHubResponseError(response, 'GitHub could not prepare the synchronisation tree')
    }
    return parseGitHubResponse(
      treeResponseSchema,
      await readGitHubJson(response, 'The GitHub transaction tree could not be created'),
      'The GitHub transaction tree could not be created'
    ).sha
  }

  private async createCommit(
    settings: GitHubDestination,
    token: string,
    treeSha: string,
    parentSha: string,
    message: string
  ): Promise<string> {
    const response = await this.request(`${repositoryApiUrl(settings)}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha]
      })
    })
    if (!response.ok) {
      throw await mapGitHubResponseError(response, 'GitHub could not create the synchronisation commit')
    }
    return parseGitHubResponse(
      commitResponseSchema,
      await readGitHubJson(response, 'The GitHub synchronisation commit could not be created'),
      'The GitHub synchronisation commit could not be created'
    ).sha
  }

  private async updateBranchReference(
    settings: GitHubDestination,
    token: string,
    commitSha: string
  ): Promise<'updated' | 'conflict' | 'ambiguous'> {
    let response: Response
    try {
      response = await this.request(
        `${repositoryApiUrl(settings)}/git/refs/heads/${encodePathSegments(settings.branch)}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ sha: commitSha, force: false })
        }
      )
    } catch (error) {
      if (error instanceof AppError && error.code === 'OFFLINE') return 'ambiguous'
      throw error
    }
    if (response.status === 409 || response.status === 422) {
      const detail = await responseMessage(response)
      if (
        response.status === 422 &&
        /protected|required status|workflow|not permitted|policy|permission/i.test(detail)
      ) {
        throw new AppError(
          'ACCESS_DENIED',
          'GitHub rejected the branch update because of repository rules.',
          detail || 'Check branch protection and direct-push permissions.'
        )
      }
      return 'conflict'
    }
    if (!response.ok) {
      throw await mapGitHubResponseError(response, 'GitHub refused the branch update')
    }
    const ref = parseGitHubResponse(
      refResponseSchema,
      await readGitHubJson(response, 'The updated GitHub branch could not be confirmed'),
      'The updated GitHub branch could not be confirmed'
    )
    if (ref.object.sha !== commitSha) return 'ambiguous'

    try {
      const currentHead = await this.readHeadSha(settings, token)
      return currentHead === commitSha ? 'updated' : 'conflict'
    } catch {
      return 'ambiguous'
    }
  }

  private async readHeadSha(settings: GitHubDestination, token: string): Promise<string> {
    const response = await this.request(
      `${repositoryApiUrl(settings)}/git/ref/heads/${encodePathSegments(settings.branch)}`,
      token
    )
    if (!response.ok) {
      throw await mapGitHubResponseError(response, 'The GitHub branch state could not be re-read')
    }
    return parseGitHubResponse(
      refResponseSchema,
      await readGitHubJson(response, 'The GitHub branch state could not be re-read'),
      'The GitHub branch state could not be re-read'
    ).object.sha
  }

  private async requireSettings(): Promise<GitHubDestination> {
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

  private async request(
    url: string,
    token: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    for (const [name, value] of Object.entries(githubHeaders(token))) headers.set(name, value)
    if (init.body) headers.set('Content-Type', 'application/json')
    try {
      return await this.transport(url, { ...init, headers })
    } catch (error) {
      throw githubTransportError(error, 'GitHub synchronisation failed')
    }
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

function findExistingCpp(
  files: GitHubTreeFile[],
  targetPath: string,
  frontendProblemId: string
): GitHubTreeFile | null {
  const filename = `problem${frontendProblemId}.cpp`.toLowerCase()
  const matches = files.filter(
    (file) => file.path.split('/').at(-1)?.toLowerCase() === filename
  )
  if (matches.length > 1) {
    throw new AppError(
      'GITHUB_CONFLICT',
      'Multiple C++ files match this problem in the destination repository.',
      `Conflicting paths: ${matches.map((file) => file.path).join(', ')}. No file was changed.`
    )
  }
  return matches[0] ?? null
}

function toPreview(plan: SyncPlan): GitHubSyncPreview {
  return {
    sourceSubmissionId: plan.sourceSubmissionId,
    frontendProblemId: plan.frontendProblemId,
    problemName: plan.problemName,
    problemSlug: plan.problemSlug,
    difficulty: plan.difficulty,
    repository: plan.repository,
    branch: plan.branch,
    path: plan.path,
    existingPath: plan.existingPath,
    identical: plan.identical,
    solutionAction: plan.solutionAction,
    previousDone: plan.previousDone,
    nextDone: plan.nextDone,
    curated: plan.curated,
    phase: plan.phase,
    order: plan.order,
    progressAction: plan.progressAction,
    changedFiles: plan.changedFiles,
    requiresOverwriteConfirmation: plan.requiresOverwriteConfirmation,
    problemUrl: plan.problemUrl,
    sourceCode: plan.sourceCode,
    existingCode: plan.existingCode,
    commitMessage: plan.commitMessage
  }
}

function toOutcome(
  plan: SyncPlan,
  commitSha: string | null,
  committed: boolean
): GitHubSyncOutcome {
  return {
    result:
      commitSha === null
        ? 'already-synchronised'
        : plan.solutionAction === 'create'
          ? 'created'
          : 'updated',
    submissionId: plan.sourceSubmissionId,
    path: plan.path,
    solutionAction: plan.solutionAction,
    progressAction: plan.progressAction,
    changedFiles: plan.changedFiles,
    commitSha,
    fileUrl: fileUrl(plan.repository, plan.branch, plan.path),
    commitUrl: commitSha ? `https://github.com/${plan.repository}/commit/${commitSha}` : null,
    readmeStatus:
      !committed || plan.progressAction === 'unchanged'
        ? 'not-needed'
        : plan.repository.toLowerCase() === 'timthedev07/leetcode' && plan.branch === 'dev'
          ? 'pending'
          : 'not-applicable'
  }
}

function buildTransactionalCommitMessage(plan: SyncPlan): string {
  if (plan.solutionAction === 'unchanged') {
    return `Update progress for problem ${plan.frontendProblemId}\n\n${plan.problemUrl}`
  }
  return plan.commitMessage
}

function repositoryApiUrl(settings: GitHubDestination): string {
  const [owner, name] = settings.repository.split('/')
  if (!owner || !name) throw new AppError('UNKNOWN', 'The configured GitHub repository is not valid.')
  return `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

function fileUrl(repository: string, branch: string, path: string): string {
  return `https://github.com/${repository}/blob/${encodeURIComponent(branch)}/${encodePathSegments(path)}`
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.clone().json()) as unknown
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
    ) {
      return payload.message.slice(0, 300)
    }
  } catch {
    // The HTTP status is sufficient when GitHub does not return a JSON message.
  }
  return ''
}
