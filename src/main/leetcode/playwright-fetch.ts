import type { APIResponse, BrowserContext } from 'playwright'
import { LEETCODE_ORIGIN } from '@shared/constants'
import { AppError } from '../security/app-error'
import type { LeetCodeAuthenticatedSession } from './auth-contract'

export const PLAYWRIGHT_REQUEST_TIMEOUT_MS = 15_000

type PlaywrightRequestContext = Pick<BrowserContext, 'cookies' | 'request'>

/**
 * Adapts Playwright's shared-cookie request context to the standard Fetch
 * response shape used by the existing GraphQL transport.
 */
export class PlaywrightRequestSession
  implements LeetCodeAuthenticatedSession
{
  constructor(
    private readonly context: PlaywrightRequestContext,
    private readonly timeoutMs = PLAYWRIGHT_REQUEST_TIMEOUT_MS
  ) {}

  async request(
    pathOrUrl: string | URL,
    init: RequestInit = {}
  ): Promise<Response> {
    const url = toLeetCodeUrl(pathOrUrl)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)

    if (isStateChanging(method) && !headers.has('x-csrftoken')) {
      const csrfToken = await this.getCsrfToken()
      if (csrfToken) headers.set('x-csrftoken', csrfToken)
    }

    const data = await toPlaywrightBody(init.body, headers)
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)
    const cancel = (): void => controller.abort()
    if (init.signal?.aborted) cancel()
    init.signal?.addEventListener('abort', cancel, { once: true })

    try {
      const requestHeaders: Record<string, string> = {}
      headers.forEach((value, name) => {
        requestHeaders[name] = value
      })
      const apiResponse = await this.context.request.fetch(url.toString(), {
        method,
        headers: requestHeaders,
        ...(data === undefined ? {} : { data }),
        failOnStatusCode: false,
        maxRedirects: 0,
        timeout: this.timeoutMs,
        signal: controller.signal
      })

      return await toStandardResponse(apiResponse)
    } catch (error) {
      if (timedOut) {
        throw new AppError(
          'OFFLINE',
          'LeetCode did not respond in time. Check your connection and try again.'
        )
      }
      if (error instanceof AppError) throw error
      if (init.signal?.aborted) throw error

      throw new AppError(
        'OFFLINE',
        'LeetCode could not be reached. Check your connection and try again.',
        error instanceof Error ? error.message : undefined
      )
    } finally {
      clearTimeout(timeout)
      init.signal?.removeEventListener('abort', cancel)
    }
  }

  async getCsrfToken(): Promise<string | null> {
    const cookies = await this.context.cookies(LEETCODE_ORIGIN)
    return cookies.find((cookie) => cookie.name === 'csrftoken')?.value ?? null
  }
}

function toLeetCodeUrl(pathOrUrl: string | URL): URL {
  let url: URL
  try {
    url =
      typeof pathOrUrl === 'string'
        ? pathOrUrl.startsWith('/')
          ? new URL(pathOrUrl, LEETCODE_ORIGIN)
          : new URL(pathOrUrl)
        : new URL(pathOrUrl.toString())
  } catch {
    throw new AppError(
      'UNKNOWN',
      'LeetCode requests must use an absolute URL or a path beginning with `/`.'
    )
  }

  if (
    url.origin !== LEETCODE_ORIGIN ||
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new AppError(
      'ACCESS_DENIED',
      'LeetCode requests can only be sent to https://leetcode.com.'
    )
  }

  return url
}

function isStateChanging(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
}

async function toPlaywrightBody(
  body: BodyInit | null | undefined,
  headers: Headers
): Promise<string | Buffer | FormData | undefined> {
  if (body === null || body === undefined) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
    }
    return body.toString()
  }
  if (body instanceof FormData) return body
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer())
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  if (body instanceof ReadableStream) {
    throw new AppError(
      'UNKNOWN',
      'Streaming request bodies are not supported for LeetCode requests.'
    )
  }

  throw new AppError('UNKNOWN', 'That LeetCode request body is not supported.')
}

async function toStandardResponse(apiResponse: APIResponse): Promise<Response> {
  try {
    const status = apiResponse.status()
    const headers = new Headers()
    for (const header of apiResponse.headersArray()) {
      headers.append(header.name, header.value)
    }

    const hasNoBody =
      status === 204 || status === 205 || status === 304
    const body = hasNoBody ? null : await apiResponse.body()

    const responseBody =
      body && body.byteLength > 0 ? Uint8Array.from(body).buffer : null
    return new Response(responseBody, {
      status,
      statusText: apiResponse.statusText(),
      headers
    })
  } finally {
    await apiResponse.dispose()
  }
}
