import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionPanel, type TestCaseDraft } from '@/components/execution-panel'
import type { JudgeResult } from '@shared/types'

const cases: TestCaseDraft[] = [
  { id: 'example', label: 'Example tests', input: '[2,7,11,15]\n9' },
  { id: 'custom', input: '[1,2]\n3' }
]

function renderPanel(overrides: Partial<React.ComponentProps<typeof ExecutionPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ExecutionPanel
        panelRef={{ current: null }}
        tab="tests"
        onTabChange={vi.fn()}
        testCases={cases}
        onTestCaseChange={vi.fn()}
        onAddTestCase={vi.fn()}
        onDuplicateTestCase={vi.fn()}
        onRemoveTestCase={vi.fn()}
        leetcodeConnected={false}
        problemSlug="two-sum"
        judgeResult={null}
        judgeError={null}
        judgeBusy={null}
        onCancelJudge={vi.fn()}
        onRestoreCode={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>
  )
}

describe('execution panel', () => {
  it('renders editable cases and exposes add, duplicate and remove actions', async () => {
    const user = userEvent.setup()
    const onAddTestCase = vi.fn()
    const onDuplicateTestCase = vi.fn()
    renderPanel({ onAddTestCase, onDuplicateTestCase })

    expect(screen.getByText('Example tests')).toBeInTheDocument()
    expect(screen.getByText('Case 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Example tests input')).toHaveValue('[2,7,11,15]\n9')

    await user.click(screen.getByRole('button', { name: 'Add case' }))
    await user.click(screen.getByRole('button', { name: 'Duplicate case 2' }))

    expect(onAddTestCase).toHaveBeenCalledOnce()
    expect(onDuplicateTestCase).toHaveBeenCalledWith('custom')
  })

  it('renders results as distinct case cards with summary counts', () => {
    const result: JudgeResult = {
      operation: 'run',
      problemSlug: 'two-sum',
      requestId: 'run-1',
      submissionId: null,
      state: 'wrong_answer',
      statusDisplay: 'Wrong Answer',
      compileError: null,
      runtimeError: null,
      totalCorrect: 1,
      totalTestcases: 2,
      runtime: '4 ms',
      memory: '9 MB',
      cases: [
        {
          caseNumber: 1,
          correct: true,
          statusDisplay: 'Accepted',
          input: '[2,7]\n9',
          expectedOutput: '[0,1]',
          actualOutput: '[0,1]'
        },
        {
          caseNumber: 2,
          correct: false,
          statusDisplay: 'Wrong Answer',
          input: '[3,3]\n6',
          expectedOutput: '[0,1]',
          actualOutput: '[]'
        }
      ],
      codeSnapshot: 'class Solution {};',
      testInputSnapshot: '[2,7]\n9',
      completedAtMs: 1
    }
    renderPanel({ tab: 'results', judgeResult: result })

    expect(screen.getAllByText('Wrong Answer').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Passed: 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Failed: 1')).toBeInTheDocument()
    expect(screen.getByText('Case 1')).toBeInTheDocument()
    expect(screen.getByText('Case 2')).toBeInTheDocument()
    expect(screen.getByText(/\[3,3\]/)).toBeInTheDocument()
  })
})
