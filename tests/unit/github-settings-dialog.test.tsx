import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubSettingsDialog } from '@/components/github-settings-dialog'

describe('GitHub settings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: {
        getGitHubSettings: vi.fn(async () => ({
          ok: true as const,
          data: { repository: null, branch: null, configured: false }
        })),
        getGitHubClientId: vi.fn(async () => ({
          ok: true as const,
          data: 'oauth-client-id'
        })),
        getGitHubStatus: vi.fn(async () => ({
          ok: true as const,
          data: { state: 'disconnected', username: null, avatarUrl: null }
        })),
        onGitHubStatus: vi.fn(() => () => undefined),
        setGitHubClientId: vi.fn(async () => ({ ok: true as const, data: true })),
        startGitHubAuth: vi.fn(async () => ({
          ok: true as const,
          data: {
            userCode: 'ABCD-1234',
            verificationUri: 'https://github.com/login/device',
            expiresInSeconds: 900,
            intervalSeconds: 5
          }
        })),
        openExternal: vi.fn(async () => ({ ok: true as const, data: true })),
        waitForGitHubAuth: vi.fn(() => new Promise(() => undefined))
      }
    })
  })

  it('opens GitHub and provides a fallback link after starting device authorisation', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })

    render(
      <QueryClientProvider client={queryClient}>
        <GitHubSettingsDialog open onOpenChange={vi.fn()} onOpenDocs={vi.fn()} />
      </QueryClientProvider>
    )

    await user.click(screen.getByRole('tab', { name: 'GitHub' }))
    await user.click(await screen.findByRole('button', { name: 'Connect' }))

    expect(await screen.findByText('ABCD-1234')).toBeInTheDocument()
    await waitFor(() => {
      expect(window.desktop.openExternal).toHaveBeenCalledWith('https://github.com/login/device')
    })
    expect(screen.getByRole('button', { name: 'Open GitHub' })).toBeEnabled()
  })
})
