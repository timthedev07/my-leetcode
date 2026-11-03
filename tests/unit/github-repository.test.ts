import { describe, expect, it, vi } from 'vitest'
import { RepositoryService, type FetchTransport } from '../../src/main/github/repository'

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

const repository = {
  name: 'leetcode',
  full_name: 'timthedev07/leetcode',
  private: false,
  default_branch: 'dev',
  owner: { login: 'timthedev07' },
  permissions: { push: true }
}

describe('GitHub repository discovery', () => {
  it('lists accessible repositories with their actual push permission', async () => {
    const transport = vi.fn<FetchTransport>().mockResolvedValueOnce(
      jsonResponse([
        repository,
        {
          ...repository,
          name: 'read-only',
          full_name: 'timthedev07/read-only',
          permissions: { push: false }
        }
      ])
    )
    const service = new RepositoryService(() => 'opaque-token', transport)

    const repositories = await service.listRepositories()

    expect(repositories).toEqual([
      {
        owner: 'timthedev07',
        name: 'leetcode',
        fullName: 'timthedev07/leetcode',
        private: false,
        defaultBranch: 'dev',
        canPush: true
      },
      {
        owner: 'timthedev07',
        name: 'read-only',
        fullName: 'timthedev07/read-only',
        private: false,
        defaultBranch: 'dev',
        canPush: false
      }
    ])
    const [url, init] = transport.mock.calls[0] ?? []
    expect(String(url)).toContain('/user/repos?')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer opaque-token')
  })

  it('lists all branch pages returned by GitHub', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(
        jsonResponse([{ name: 'dev' }], 200, {
          link: '<https://api.github.com/repos/timthedev07/leetcode/branches?per_page=100&page=2>; rel="next"'
        })
      )
      .mockResolvedValueOnce(jsonResponse([{ name: 'main' }]))
    const service = new RepositoryService(async () => 'opaque-token', transport)

    const branches = await service.listBranches('timthedev07', 'leetcode')

    expect(branches).toEqual([{ name: 'dev' }, { name: 'main' }])
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('verifies that the selected branch exists and the token can push', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(jsonResponse(repository))
      .mockResolvedValueOnce(jsonResponse({ name: 'dev' }))
    const service = new RepositoryService(() => 'opaque-token', transport)

    const destination = await service.verifyPushPermission('timthedev07', 'leetcode', 'dev')

    expect(destination.canPush).toBe(true)
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/repos/timthedev07/leetcode',
      'https://api.github.com/repos/timthedev07/leetcode/branches/dev'
    ])
  })

  it('rejects a repository without push permission', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(jsonResponse({ ...repository, permissions: { push: false } }))
      .mockResolvedValueOnce(jsonResponse({ name: 'dev' }))
    const service = new RepositoryService(() => 'opaque-token', transport)

    await expect(
      service.validateDestination('timthedev07/leetcode', 'dev')
    ).rejects.toMatchObject({
      code: 'ACCESS_DENIED'
    })
  })

  it.each([
    [401, 'AUTH_EXPIRED'],
    [403, 'ACCESS_DENIED'],
    [404, 'ACCESS_DENIED'],
    [409, 'GITHUB_CONFLICT'],
    [429, 'RATE_LIMITED']
  ] as const)('maps GitHub HTTP %i to %s', async (status, code) => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(jsonResponse({ message: `GitHub error ${status}` }, status))
    const service = new RepositoryService(() => 'opaque-token', transport)

    await expect(service.listBranches('timthedev07', 'leetcode')).rejects.toMatchObject({
      code,
      details: expect.stringContaining(`HTTP ${status}`)
    })
  })

  it('rejects unsafe repository and branch coordinates before making requests', async () => {
    const transport = vi.fn<FetchTransport>()
    const service = new RepositoryService(() => 'opaque-token', transport)

    await expect(service.listBranches('../owner', 'leetcode')).rejects.toMatchObject({
      code: 'UNKNOWN'
    })
    await expect(
      service.verifyPushPermission('timthedev07', 'leetcode', 'dev..backup')
    ).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(transport).not.toHaveBeenCalled()
  })
})
