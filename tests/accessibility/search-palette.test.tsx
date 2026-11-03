import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchPalette } from '@/components/search-palette'

function renderPalette(onSelect = vi.fn(), onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return {
    onSelect,
    onOpenChange,
    ...render(
      <QueryClientProvider client={client}>
        <SearchPalette
          open
          onOpenChange={onOpenChange}
          onSelect={onSelect}
          onOpenDocs={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </QueryClientProvider>
    )
  }
}

describe('problem search accessibility', () => {
  it('focuses the search field and supports keyboard result selection', async () => {
    const searchProblems = vi.fn(async () => ({
      ok: true as const,
      data: {
        problems: [
          {
            frontendId: '209',
            title: 'Minimum Size Subarray Sum',
            titleSlug: 'minimum-size-subarray-sum',
            difficulty: 'Medium' as const,
            isPaidOnly: false,
            topicTags: [{ name: 'Sliding Window', slug: 'sliding-window' }]
          }
        ],
        total: 1,
        page: 1,
        pageSize: 20
      }
    }))
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: { searchProblems }
    })

    const user = userEvent.setup()
    const { onSelect } = renderPalette()
    const input = screen.getByRole('combobox', { name: 'Search LeetCode problems' })
    await waitFor(() => expect(input).toHaveFocus())

    await user.type(input, '209')
    await screen.findByText('Minimum Size Subarray Sum')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ frontendId: '209', titleSlug: 'minimum-size-subarray-sum' })
      )
    })
  })

  it('shows navigation commands before a query is entered', () => {
    renderPalette()

    expect(screen.getByRole('option', { name: 'Documentation' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Search by problem number, title, slug or topic.')).toBeInTheDocument()
  })
})

