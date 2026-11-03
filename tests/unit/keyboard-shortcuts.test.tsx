import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'

function dispatchShortcut(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options
  })
  act(() => window.dispatchEvent(event))
  return event
}

describe('global keyboard shortcuts', () => {
  it('routes search and recent shortcuts without intercepting unrelated keys', () => {
    const search = vi.fn()
    const recent = vi.fn()
    renderHook(() => useKeyboardShortcuts({ search, recent }))

    dispatchShortcut('k')
    dispatchShortcut('p')
    dispatchShortcut('x')

    expect(search).toHaveBeenCalledOnce()
    expect(recent).toHaveBeenCalledOnce()
  })

  it('distinguishes Run from Submit and prevents a handled browser default', () => {
    const run = vi.fn()
    const submit = vi.fn()
    renderHook(() => useKeyboardShortcuts({ search: vi.fn(), recent: vi.fn(), run, submit }))

    const runEvent = dispatchShortcut('Enter')
    const submitEvent = dispatchShortcut('Enter', { shiftKey: true })

    expect(run).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledOnce()
    expect(runEvent.defaultPrevented).toBe(true)
    expect(submitEvent.defaultPrevented).toBe(true)
  })

  it('focuses the three primary workspace regions', () => {
    const focusDescription = vi.fn()
    const focusEditor = vi.fn()
    const focusPanel = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({
        search: vi.fn(),
        recent: vi.fn(),
        focusDescription,
        focusEditor,
        focusPanel
      })
    )

    dispatchShortcut('1')
    dispatchShortcut('2')
    dispatchShortcut('3')

    expect(focusDescription).toHaveBeenCalledOnce()
    expect(focusEditor).toHaveBeenCalledOnce()
    expect(focusPanel).toHaveBeenCalledOnce()
  })

  it('routes Option+Shift+F to formatting', () => {
    const format = vi.fn()
    renderHook(() => useKeyboardShortcuts({ search: vi.fn(), recent: vi.fn(), format }))

    const event = dispatchShortcut('f', { metaKey: false, altKey: true, shiftKey: true })

    expect(format).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('routes undo and redo shortcuts', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    renderHook(() => useKeyboardShortcuts({ search: vi.fn(), recent: vi.fn(), undo, redo }))

    dispatchShortcut('z')
    dispatchShortcut('z', { shiftKey: true })
    dispatchShortcut('y', { shiftKey: false })

    expect(undo).toHaveBeenCalledOnce()
    expect(redo).toHaveBeenCalledTimes(2)
  })
})
