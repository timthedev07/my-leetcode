import { GraphQLClient } from 'graphql-request'
import { LEETCODE_GRAPHQL_URL } from '@shared/constants'
import { AppError } from '../security/app-error'

export type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class LeetCodeGraphQLClient {
  private readonly client: GraphQLClient

  constructor(transport: FetchTransport = globalThis.fetch) {
    this.client = new GraphQLClient(LEETCODE_GRAPHQL_URL, {
      fetch: transport,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: 'https://leetcode.com/problemset/',
        'User-Agent': 'LeetCodeDesktop/0.1'
      }
    })
  }

  async request<T>(document: string, variables: Record<string, unknown>, operationName: string): Promise<T> {
    try {
      return await this.client.request<T>({
        document,
        variables,
        requestHeaders: {
          'x-operation-name': operationName
        }
      })
    } catch (error) {
      throw mapLeetCodeError(error)
    }
  }
}

function mapLeetCodeError(error: unknown): AppError {
  if (error instanceof Error && /fetch|network|ECONN|ENOTFOUND|timed out/i.test(error.message)) {
    return new AppError('OFFLINE', 'LeetCode could not be reached. Check your connection and try again.')
  }

  const response = getClientResponse(error)
  const status = response?.status
  if (status === 401 || status === 403) {
    return new AppError('AUTH_EXPIRED', 'LeetCode did not authorise this request. Reconnect your account and try again.')
  }
  if (status === 429) {
    return new AppError('RATE_LIMITED', 'LeetCode is receiving too many requests. Wait a moment before trying again.')
  }

  return new AppError(
    'API_CHANGED',
    'LeetCode returned an unexpected response. The service may have changed.',
    error instanceof Error ? error.message : undefined
  )
}

function getClientResponse(error: unknown): Response | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined
  const response = (error as { response?: unknown }).response
  return response instanceof Response ? response : undefined
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await globalThis.fetch(input, {
      ...init,
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

