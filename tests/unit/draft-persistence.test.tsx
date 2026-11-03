import { act, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attempt, PersistedEditorState } from '@shared/types'
import type { CppEditorHandle } from '@/components/editor/cpp-editor'
import { useDraftPersistence } from '@/hooks/use-draft-persistence'

const attempt: Attempt = {
  accountKey: 'local',
  problemId: '209',
  internalProblemId: '209',
  titleSlug: 'minimum-size-subarray-sum',
  title: 'Minimum Size Subarray Sum',
  difficulty: 'Medium',
  draftCpp: 'class Solution {};',
  editorState: null,
  createdAtMs: 1,
  lastActivityAtMs: 1,
  lastSavedAtMs: 1
}

const editorState: PersistedEditorState = {
  cursor: { lineNumber: 2, column: 3 },
  selection: null,
  scrollTop: 12
}

describe('draft persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces writes for 500 ms and sends the current editor state', async () => {
    const saveAttempt = vi.fn(async () => ({ ok: true as const, data: true as const }))
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: {
        saveAttempt,
        queueAttemptSave: vi.fn()
      }
    })
    const editorRef: RefObject<CppEditorHandle | null> = {
      current: {
        focus: vi.fn(),
        revealLine: vi.fn(),
        getEditorState: () => editorState,
        formatDocument: vi.fn(async () => undefined),
        undo: vi.fn(),
        redo: vi.fn()
      }
    }
    const onSaved = vi.fn()
    const { result } = renderHook(() => useDraftPersistence(attempt, editorRef, onSaved))

    act(() => result.current.markDirty('class Solution { public: int x; };'))
    await act(async () => {
      vi.advanceTimersByTime(499)
      await Promise.resolve()
    })
    expect(saveAttempt).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saveAttempt).toHaveBeenCalledOnce()
    expect(saveAttempt).toHaveBeenCalledWith(
      '209',
      'class Solution { public: int x; };',
      editorState
    )
    expect(onSaved).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('saved')
  })

  it('flushes an edit immediately on navigation', async () => {
    const saveAttempt = vi.fn(async () => ({ ok: true as const, data: true as const }))
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: {
        saveAttempt,
        queueAttemptSave: vi.fn()
      }
    })
    const editorRef: RefObject<CppEditorHandle | null> = {
      current: {
        focus: vi.fn(),
        revealLine: vi.fn(),
        getEditorState: () => editorState,
        formatDocument: vi.fn(async () => undefined),
        undo: vi.fn(),
        redo: vi.fn()
      }
    }
    const { result } = renderHook(() => useDraftPersistence(attempt, editorRef, vi.fn()))

    act(() => result.current.markDirty('int main() {}'))
    await act(async () => {
      await result.current.flush()
    })

    expect(saveAttempt).toHaveBeenCalledWith('209', 'int main() {}', editorState)
  })
})
