import type { ZodType } from 'zod'
import { AppError } from '../security/app-error'

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LeetCodeDesktop/0.1'
  }
}

export function encodePathSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export async function readGitHubJson(
  response: Response,
  operation: string
): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new AppError(
      'API_CHANGED',
      `${operation}: GitHub returned an unreadable response.`,
      error instanceof Error ? error.message : undefined
    )
  }
}

export function parseGitHubResponse<T>(
  schema: ZodType<T>,
  value: unknown,
  operation: string
): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new AppError(
      'API_CHANGED',
      `${operation}: GitHub returned an unexpected response.`,
      result.error.issues[0]?.message
    )
  }
  return result.data
}

export async function mapGitHubResponseError(
  response: Response,
  operation: string
): Promise<AppError> {
  const detail = await responseDetail(response)
  switch (response.status) {
    case 401:
      return new AppError('AUTH_EXPIRED', `${operation}: GitHub authorisation has expired.`, detail)
    case 403:
      return new AppError(
        'ACCESS_DENIED',
        `${operation}: the token or repository permissions do not allow this operation.`,
        detail
      )
    case 404:
      return new AppError(
        'ACCESS_DENIED',
        `${operation}: the repository, branch or file was not found or is not accessible.`,
        detail
      )
    case 409:
    case 422:
      return new AppError(
        'GITHUB_CONFLICT',
        `${operation}: the branch or file changed. No change was forced.`,
        detail
      )
    case 429:
      return new AppError('RATE_LIMITED', `${operation}: the GitHub rate limit was reached.`, detail)
    default:
      return new AppError(
        'API_CHANGED',
        `${operation}: GitHub rejected the request (${response.status}).`,
        detail
      )
  }
}

export function githubTransportError(error: unknown, operation: string): AppError {
  if (error instanceof AppError) return error
  return new AppError(
    'OFFLINE',
    `${operation}: GitHub could not be reached. Check your connection and try again.`,
    error instanceof Error ? error.message : undefined
  )
}

async function responseDetail(response: Response): Promise<string> {
  const prefix = `GitHub returned HTTP ${response.status}.`
  try {
    const payload = (await response.clone().json()) as unknown
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
    ) {
      return `${prefix} ${payload.message.slice(0, 300)}`
    }
  } catch {
    // The status code remains useful when GitHub returns a non-JSON error.
  }
  return prefix
}
