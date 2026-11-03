import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Attempt } from '@shared/types'
import { DRAFT_SAVE_DEBOUNCE_MS } from '@shared/constants'
import type { CppEditorHandle } from '@/components/editor/cpp-editor'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

type DraftPersistence = {
  draft: string
  status: SaveStatus
  errorMessage: string | null
  markDirty: (value: string) => void
  flush: () => Promise<void>
}

const MAX_SAVE_DELAY_MS = 4_000

export function useDraftPersistence(
  attempt: Attempt,
  editorRef: RefObject<CppEditorHandle | null>,
  onSaved: () => void
): DraftPersistence {
  const [draft, setDraft] = useState(attempt.draftCpp)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const draftRef = useRef(attempt.draftCpp)
  const revisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const debounceTimerRef = useRef<number | null>(null)
  const maxTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const onSavedRef = useRef(onSaved)

  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current)
      if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current)
    }
  }, [])

  const flush = useCallback(async (): Promise<void> => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current)
    if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current)
    debounceTimerRef.current = null
    maxTimerRef.current = null

    if (saveInFlightRef.current) await saveInFlightRef.current

    const targetRevision = revisionRef.current
    if (targetRevision === savedRevisionRef.current) return
    const targetDraft = draftRef.current
    const targetEditorState = editorRef.current?.getEditorState() ?? null
    setStatus('saving')
    setErrorMessage(null)

    const save = window.desktop
      .saveAttempt(attempt.problemId, targetDraft, targetEditorState)
      .then((result) => {
        if (!result.ok) throw new Error(result.error.message)
        savedRevisionRef.current = Math.max(savedRevisionRef.current, targetRevision)
        if (mountedRef.current && revisionRef.current === targetRevision) setStatus('saved')
        onSavedRef.current()
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          setStatus('error')
          setErrorMessage(error instanceof Error ? error.message : 'The draft could not be saved.')
        }
      })
      .finally(() => {
        saveInFlightRef.current = null
      })

    saveInFlightRef.current = save
    await save
  }, [attempt.problemId, editorRef])

  const scheduleSave = useCallback(() => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = window.setTimeout(() => void flush(), DRAFT_SAVE_DEBOUNCE_MS)

    if (!maxTimerRef.current) {
      maxTimerRef.current = window.setTimeout(() => void flush(), MAX_SAVE_DELAY_MS)
    }
  }, [flush])

  const markDirty = useCallback(
    (value: string) => {
      draftRef.current = value
      revisionRef.current += 1
      setDraft(value)
      setStatus('dirty')
      setErrorMessage(null)
      scheduleSave()
    },
    [scheduleSave]
  )

  useEffect(() => {
    const beforeUnload = (): void => {
      window.desktop.queueAttemptSave(
        attempt.problemId,
        draftRef.current,
        editorRef.current?.getEditorState() ?? null
      )
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('pagehide', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('pagehide', beforeUnload)
    }
  }, [attempt.problemId, editorRef])

  return { draft, status, errorMessage, markDirty, flush }
}

