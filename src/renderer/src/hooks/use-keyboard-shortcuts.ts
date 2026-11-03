import { useEffect, useRef } from 'react'

export type ShortcutHandlers = {
  search: () => void
  recent: () => void
  focusDescription?: () => void
  focusEditor?: () => void
  focusPanel?: () => void
  run?: () => void
  submit?: () => void
  save?: () => void
  format?: () => void
  undo?: () => void
  redo?: () => void
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return

      const key = event.key.toLowerCase()
      let handler: (() => void) | undefined

      if (event.altKey && event.shiftKey && key === 'f') handler = handlersRef.current.format
      else if (event.metaKey || event.ctrlKey) {
        if (key === 'k' && !event.shiftKey && !event.altKey) handler = handlersRef.current.search
        else if (key === 'p' && !event.shiftKey && !event.altKey) handler = handlersRef.current.recent
        else if (key === '1' && !event.shiftKey && !event.altKey) handler = handlersRef.current.focusDescription
        else if (key === '2' && !event.shiftKey && !event.altKey) handler = handlersRef.current.focusEditor
        else if (key === '3' && !event.shiftKey && !event.altKey) handler = handlersRef.current.focusPanel
        else if (key === 'enter' && !event.altKey) handler = event.shiftKey ? handlersRef.current.submit : handlersRef.current.run
        else if (key === 's' && !event.shiftKey && !event.altKey) handler = handlersRef.current.save
        else if (key === 'z' && !event.altKey) {
          handler = event.shiftKey ? handlersRef.current.redo : handlersRef.current.undo
        } else if (key === 'y' && !event.shiftKey && !event.altKey) {
          handler = handlersRef.current.redo
        }
      }

      if (handler) {
        event.preventDefault()
        handler()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}

export function isMacPlatform(): boolean {
  return navigator.userAgent.includes('Mac')
}

export function shortcutLabel(key: string): string {
  return `${isMacPlatform() ? '⌘' : 'Ctrl+'}${key}`
}

