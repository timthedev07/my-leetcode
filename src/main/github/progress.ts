import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import { GITHUB_API_URL } from '@shared/constants'
import type {
  Difficulty,
  GitHubProgressOverview,
  ProgressStatistics,
  RecommendedProblem
} from '@shared/types'
import { z } from 'zod'
import { AppError } from '../security/app-error'
import {
  encodePathSegments,
  githubHeaders,
  githubTransportError,
  mapGitHubResponseError,
  parseGitHubResponse,
  readGitHubJson
} from './github-http'
import type { FetchTransport, TokenGetter } from './repository'

export const PROGRESS_PATH = 'data/progress.json'

export type GitHubDestination = {
  repository: string
  branch: string
}

const phaseSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().refine((value) => value.trim().length > 0, 'Title must not be empty.'),
    description: z
      .string()
      .refine((value) => value.trim().length > 0, 'Description must not be empty.')
  })
  .passthrough()

const problemSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().refine((value) => value.trim().length > 0, 'Name must not be empty.'),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']),
    phase: z.number().int().positive().nullable(),
    order: z.number().int().positive().nullable(),
    done: z.boolean(),
    solution_path: z.string().min(1).nullable(),
    premium: z.boolean().optional()
  })
  .passthrough()

export const progressDocumentSchema = z
  .object({
    version: z.literal(1),
    target_count: z.number().int().positive(),
    phases: z.array(phaseSchema).min(1),
    problems: z.array(problemSchema)
  })
  .passthrough()

export type ProgressPhase = z.infer<typeof phaseSchema>
export type ProgressProblem = z.infer<typeof problemSchema>
export type ProgressDocument = z.infer<typeof progressDocumentSchema>

export type GitHubTreeFile = {
  path: string
  sha: string
}

export type ProgressSnapshot = {
  destination: GitHubDestination
  headSha: string
  treeSha: string
  progressBlobSha: string
  document: ProgressDocument
  files: GitHubTreeFile[]
}

export type ProgressProblemInput = {
  id: number
  name: string
  slug: string
  difficulty: Difficulty
}

type ProgressServiceOptions = {
  getToken: TokenGetter
  getSettings: () => Promise<GitHubDestination | null>
  fetch: FetchTransport
}

const refSchema = z.object({
  object: z.object({
    sha: z.string().min(1),
    type: z.string()
  })
})

const commitSchema = z.object({
  tree: z.object({
    sha: z.string().min(1)
  })
})

const treeSchema = z.object({
  tree: z.array(
    z.object({
      path: z.string().min(1),
      type: z.string(),
      sha: z.string().min(1)
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
  path: z.literal(PROGRESS_PATH)
})

export class GitHubProgressService {
  constructor(private readonly options: ProgressServiceOptions) {}

  async loadSnapshot(destination?: GitHubDestination): Promise<ProgressSnapshot> {
    const resolvedDestination = destination ?? (await this.requireSettings())
    const token = await this.requireToken()
    const apiUrl = repositoryApiUrl(resolvedDestination)

    const refResponse = await this.request(
      `${apiUrl}/git/ref/heads/${encodePathSegments(resolvedDestination.branch)}`,
      token
    )
    if (!refResponse.ok) {
      throw await mapGitHubResponseError(refResponse, 'The selected GitHub branch could not be read')
    }
    const ref = parseGitHubResponse(
      refSchema,
      await readGitHubJson(refResponse, 'The selected GitHub branch could not be read'),
      'The selected GitHub branch could not be read'
    )
    if (ref.object.type !== 'commit') {
      throw new AppError('API_CHANGED', 'GitHub returned a branch reference that is not a commit.')
    }
    const headSha = ref.object.sha

    const commitResponse = await this.request(`${apiUrl}/git/commits/${headSha}`, token)
    if (!commitResponse.ok) {
      throw await mapGitHubResponseError(commitResponse, 'The selected GitHub commit could not be read')
    }
    const commit = parseGitHubResponse(
      commitSchema,
      await readGitHubJson(commitResponse, 'The selected GitHub commit could not be read'),
      'The selected GitHub commit could not be read'
    )

    const treeResponse = await this.request(
      `${apiUrl}/git/trees/${commit.tree.sha}?recursive=1`,
      token
    )
    if (!treeResponse.ok) {
      throw await mapGitHubResponseError(treeResponse, 'The destination repository tree could not be read')
    }
    const tree = parseGitHubResponse(
      treeSchema,
      await readGitHubJson(treeResponse, 'The destination repository tree could not be read'),
      'The destination repository tree could not be read'
    )
    if (tree.truncated) {
      throw new AppError(
        'PROGRESS_UNAVAILABLE',
        'The destination repository is too large to validate progress safely.',
        'No GitHub file was changed.'
      )
    }
    const files = tree.tree
      .filter((entry) => entry.type === 'blob')
      .map(({ path, sha }) => ({ path, sha }))
    if (!files.some((file) => file.path === PROGRESS_PATH)) {
      throw new AppError(
        'PROGRESS_UNAVAILABLE',
        `${resolvedDestination.repository} does not contain ${PROGRESS_PATH}.`,
        'Select a repository that uses the JSON progress contract. The app does not create this file automatically.'
      )
    }

    const progressResponse = await this.request(
      `${apiUrl}/contents/${encodePathSegments(PROGRESS_PATH)}?ref=${encodeURIComponent(headSha)}`,
      token
    )
    if (!progressResponse.ok) {
      throw await mapGitHubResponseError(progressResponse, `${PROGRESS_PATH} could not be read`)
    }
    const contents = parseGitHubResponse(
      contentsSchema,
      await readGitHubJson(progressResponse, `${PROGRESS_PATH} could not be read`),
      `${PROGRESS_PATH} could not be read`
    )

    let raw: unknown
    try {
      raw = JSON.parse(Buffer.from(contents.content.replace(/\s/g, ''), 'base64').toString('utf8'))
    } catch (error) {
      throw new AppError(
        'PROGRESS_UNAVAILABLE',
        `${PROGRESS_PATH} is not valid JSON.`,
        error instanceof Error ? error.message : undefined
      )
    }
    const document = parseProgressDocument(
      raw,
      new Set(files.map((file) => file.path))
    )
    return {
      destination: resolvedDestination,
      headSha,
      treeSha: commit.tree.sha,
      progressBlobSha: contents.sha,
      document,
      files
    }
  }

  async getOverview(): Promise<GitHubProgressOverview> {
    const snapshot = await this.loadSnapshot()
    return {
      repository: snapshot.destination.repository,
      branch: snapshot.destination.branch,
      revision: snapshot.headSha,
      statistics: calculateProgressStatistics(snapshot.document),
      recommendations: getNextProblems(snapshot.document).map(toRecommendedProblem)
    }
  }

  private async requireSettings(): Promise<GitHubDestination> {
    const settings = await this.options.getSettings()
    if (!settings) {
      throw new AppError(
        'PROGRESS_UNAVAILABLE',
        'Configure a GitHub repository and branch before loading progress.'
      )
    }
    return settings
  }

  private async requireToken(): Promise<string> {
    const token = await this.options.getToken()
    if (!token) throw new AppError('AUTH_EXPIRED', 'Connect GitHub before loading progress.')
    return token
  }

  private async request(url: string, token: string): Promise<Response> {
    try {
      return await this.options.fetch(url, {
        method: 'GET',
        headers: githubHeaders(token)
      })
    } catch (error) {
      throw githubTransportError(error, 'Progress could not be loaded')
    }
  }
}

export function parseProgressDocument(
  value: unknown,
  existingPaths?: ReadonlySet<string>
): ProgressDocument {
  const parsed = progressDocumentSchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError(
      'PROGRESS_UNAVAILABLE',
      `${PROGRESS_PATH} does not match the supported version 1 contract.`,
      parsed.error.issues[0]?.message
    )
  }
  validateProgressDocument(parsed.data, existingPaths)
  return parsed.data
}

export function validateProgressDocument(
  document: ProgressDocument,
  existingPaths?: ReadonlySet<string>
): void {
  const phaseNumbers = document.phases.map((phase) => phase.number)
  const expectedPhases = Array.from({ length: document.phases.length }, (_, index) => index + 1)
  if (phaseNumbers.some((number, index) => number !== expectedPhases[index])) {
    throw progressError('Phase numbers must be consecutive, starting at 1.')
  }

  const seenIds = new Set<number>()
  const seenOrders = new Set<number>()
  const curated: ProgressProblem[] = []

  for (const problem of document.problems) {
    if (seenIds.has(problem.id)) {
      throw progressError(`Problem ID ${problem.id} is duplicated.`)
    }
    seenIds.add(problem.id)

    if (problem.done && problem.solution_path === null) {
      throw progressError(`Problem ${problem.id} is complete but has no solution path.`)
    }
    if (problem.solution_path !== null) {
      validateRepositoryPath(problem.id, problem.solution_path)
      if (existingPaths && !existingPaths.has(problem.solution_path)) {
        throw progressError(
          `Problem ${problem.id} references a missing solution file: ${problem.solution_path}`
        )
      }
    }

    if (problem.phase === null && problem.order === null) continue
    if (problem.phase === null || problem.order === null) {
      throw progressError(`Problem ${problem.id} must have both phase and order, or neither.`)
    }
    if (!phaseNumbers.includes(problem.phase)) {
      throw progressError(`Problem ${problem.id} references an unknown phase.`)
    }
    if (seenOrders.has(problem.order)) {
      throw progressError(`Progressive order ${problem.order} is duplicated.`)
    }
    if (problem.difficulty === 'Easy') {
      throw progressError(`Curated problem ${problem.id} must be Medium or Hard.`)
    }
    seenOrders.add(problem.order)
    curated.push(problem)
  }

  if (curated.length !== document.target_count) {
    throw progressError(
      `Expected ${document.target_count} curated problems, but found ${curated.length}.`
    )
  }
  for (let order = 1; order <= document.target_count; order += 1) {
    if (!seenOrders.has(order)) throw progressError(`Progressive order ${order} is missing.`)
  }

  curated.sort((left, right) => left.order! - right.order!)
  const phaseOrder = curated.map((problem) => problem.phase!)
  if (
    phaseOrder.some((phase, index) => index > 0 && phase < phaseOrder[index - 1]!) ||
    new Set(phaseOrder).size !== phaseNumbers.length
  ) {
    throw progressError('Phases must occur once each, in increasing learning order.')
  }
}

export function getNextProblems(document: ProgressDocument): ProgressProblem[] {
  return document.problems
    .filter(
      (problem) =>
        problem.phase !== null &&
        problem.order !== null &&
        problem.done === false
    )
    .sort((left, right) => left.order! - right.order!)
    .slice(0, 5)
}

export function calculateProgressStatistics(document: ProgressDocument): ProgressStatistics {
  const curated = document.problems.filter(
    (problem) => problem.phase !== null && problem.order !== null
  )
  const completed = curated.filter((problem) => problem.done).length
  const totalCompleted = document.problems.filter((problem) => problem.done).length
  return {
    completed,
    targetCount: document.target_count,
    percentage:
      document.target_count === 0
        ? 0
        : Math.round((completed / document.target_count) * 1_000) / 10,
    totalCompleted,
    additionalCompleted: totalCompleted - completed
  }
}

export function findProblemById(
  document: ProgressDocument,
  id: number
): ProgressProblem | null {
  return document.problems.find((problem) => problem.id === id) ?? null
}

export function prepareProgressUpdate(
  document: ProgressDocument,
  problem: ProgressProblemInput,
  solutionPath: string
): { document: ProgressDocument; action: 'update' | 'add' | 'unchanged' } {
  const existingIndex = document.problems.findIndex((entry) => entry.id === problem.id)
  if (existingIndex === -1) {
    const next: ProgressDocument = {
      ...document,
      problems: [
        ...document.problems,
        {
          id: problem.id,
          name: problem.name,
          slug: problem.slug,
          difficulty: problem.difficulty,
          phase: null,
          order: null,
          done: true,
          solution_path: solutionPath
        }
      ]
    }
    return { document: next, action: 'add' }
  }

  const existing = document.problems[existingIndex]!
  if (existing.done && existing.solution_path === solutionPath) {
    return { document, action: 'unchanged' }
  }
  const problems = [...document.problems]
  problems[existingIndex] = {
    ...existing,
    done: true,
    solution_path: solutionPath
  }
  return { document: { ...document, problems }, action: 'update' }
}

export function serialiseProgressDocument(document: ProgressDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function validateRepositoryPath(problemId: number, path: string): void {
  const invalid =
    path.includes('\\') ||
    path.includes('\0') ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  if (invalid) {
    throw progressError(
      `Problem ${problemId} has an invalid repository-relative solution path.`
    )
  }
}

function toRecommendedProblem(problem: ProgressProblem): RecommendedProblem {
  if (problem.phase === null || problem.order === null) {
    throw new AppError('API_CHANGED', 'A recommendation has no progressive position.')
  }
  return {
    id: problem.id,
    name: problem.name,
    slug: problem.slug,
    difficulty: problem.difficulty,
    phase: problem.phase,
    order: problem.order
  }
}

function progressError(message: string): AppError {
  return new AppError(
    'PROGRESS_UNAVAILABLE',
    `${PROGRESS_PATH} is incompatible: ${message}`,
    'Correct the JSON and run the solution repository validation before trying again.'
  )
}

function repositoryApiUrl(destination: GitHubDestination): string {
  const [owner, name] = destination.repository.split('/')
  if (!owner || !name) {
    throw new AppError('UNKNOWN', 'The configured GitHub repository is not valid.')
  }
  return `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}
