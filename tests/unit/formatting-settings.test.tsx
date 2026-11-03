import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLANG_FORMAT_YAML } from '@shared/constants'
import { FormattingSettingsPanel } from '@/components/formatting-settings-panel'
import { clangFormat } from '@/editor/clang-format-client'

vi.mock('@/editor/clang-format-client', () => ({
  clangFormat: {
    validate: vi.fn(async (yaml: string) => ({
      valid: true,
      error: null,
      formattedPreview: yaml.includes('IndentWidth: 2')
        ? 'class Solution {\n  public:\n    int value;\n};'
        : 'class Solution {\npublic:\n  int value;\n};'
    }))
  }
}))

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return render(
    <QueryClientProvider client={client}>
      <FormattingSettingsPanel />
    </QueryClientProvider>
  )
}

describe('Formatting settings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: {
        getClangFormatConfig: vi.fn(async () => ({
          ok: true as const,
          data: { yaml: DEFAULT_CLANG_FORMAT_YAML }
        })),
        saveClangFormatConfig: vi.fn(async (yaml: string) => ({
          ok: true as const,
          data: { yaml }
        })),
        resetClangFormatConfig: vi.fn(async () => ({
          ok: true as const,
          data: { yaml: DEFAULT_CLANG_FORMAT_YAML }
        })),
        importClangFormatConfig: vi.fn(async () => ({ ok: true as const, data: null })),
        exportClangFormatConfig: vi.fn(async () => ({
          ok: true as const,
          data: { saved: false, fileName: null }
        }))
      }
    })
    vi.mocked(clangFormat.validate).mockClear()
  })

  it('validates live previews and enables saving for changed valid YAML', async () => {
    const user = userEvent.setup()
    renderSettings()

    const indent = await screen.findByLabelText('IndentWidth')
    fireEvent.change(indent, { target: { value: '2' } })

    await waitFor(
      () => {
        expect(screen.getByText('Configuration valid')).toBeInTheDocument()
        expect(screen.getByText(/int value;/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      },
      { timeout: 2_000 }
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(window.desktop.saveClangFormatConfig).toHaveBeenCalledWith(
        expect.stringContaining('IndentWidth: 2')
      )
    })
  })

  it('shows invalid YAML and prevents saving', async () => {
    renderSettings()

    const yaml = await screen.findByLabelText('Configuration YAML')
    fireEvent.change(yaml, { target: { value: 'IndentWidth: [' } })

    await waitFor(() => {
      expect(yaml).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })
    expect(window.desktop.saveClangFormatConfig).not.toHaveBeenCalled()
  })
})
