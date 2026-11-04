import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubProgressOverview } from '@shared/types'
import { RecentSidebar } from '@/components/recent-sidebar'
import { UpNextSection } from '@/components/up-next-section'

const overview: GitHubProgressOverview = {
  repository: 'timthedev07/leetcode',
  branch: 'dev',
  revision: 'head-sha',
  statistics: {
    completed: 98,
    targetCount: 500,
    percentage: 19.6,
    totalCompleted: 119,
    additionalCompleted: 21
  },
  recommendations: [
    {
      id: 932,
      name: 'Beautiful Array',
      slug: 'beautiful-array',
      difficulty: 'Medium',
      phase: 1,
      order: 25
    },
    {
      id: 714,
      name: 'Best Time to Buy and Sell Stock with Transaction Fee',
      slug: 'best-time-to-buy-and-sell-stock-with-transaction-fee',
      difficulty: 'Medium',
      phase: 1,
      order: 28
    }
  ]
}

function createClient(connected = true): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false }
    }
  })
  client.setQueryData(
    ['github-auth-status'],
    connected
      ? {
          state: 'connected',
          username: 'timthedev07',
          avatarUrl: null
        }
      : {
          state: 'disconnected',
          username: null,
          avatarUrl: null
        }
  )
  return client
}

describe('Up Next recommendations', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: {
        getGitHubSettings: vi.fn(async () => ({
          ok: true as const,
          data: {
            repository: 'timthedev07/leetcode',
            branch: 'dev',
            configured: true
          }
        })),
        getGitHubProgress: vi.fn(async () => ({
          ok: true as const,
          data: overview
        })),
        onGitHubStatus: vi.fn(() => () => undefined)
      }
    })
  })

  it('shows statistics and opens recommendations with the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <QueryClientProvider client={createClient()}>
        <UpNextSection
          activeProblemId="932"
          onSelect={onSelect}
          onOpenSettings={vi.fn()}
        />
      </QueryClientProvider>
    )

    expect(await screen.findByText('98 / 500 completed')).toBeInTheDocument()
    expect(screen.getByText('19.6%')).toBeInTheDocument()
    const recommendation = screen.getByRole('button', { name: /Beautiful Array/ })
    expect(recommendation).toHaveAttribute('aria-current', 'page')

    await user.tab()
    recommendation.focus()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        frontendId: '932',
        titleSlug: 'beautiful-array',
        difficulty: 'Medium'
      })
    )
  })

  it('renders above Recent while preserving the local Recent section', async () => {
    render(
      <QueryClientProvider client={createClient()}>
        <RecentSidebar
          attempts={[]}
          activeProblemId={null}
          collapsed={false}
          onSelect={vi.fn()}
          onSelectRecommendation={vi.fn()}
          onOpenRecent={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </QueryClientProvider>
    )

    const upNext = await screen.findByRole('heading', { name: 'Up Next' })
    const recent = screen.getByRole('heading', { name: 'Recent' })
    await waitFor(() => {
      expect(
        upNext.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })
    expect(screen.getByText(/Open a problem to start/)).toBeInTheDocument()
  })

  it('offers GitHub settings when disconnected', async () => {
    const onOpenSettings = vi.fn()
    render(
      <QueryClientProvider client={createClient(false)}>
        <UpNextSection
          activeProblemId={null}
          onSelect={vi.fn()}
          onOpenSettings={onOpenSettings}
        />
      </QueryClientProvider>
    )

    expect(
      screen.getByText('Connect GitHub to load progressive recommendations.')
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect GitHub' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })
})
