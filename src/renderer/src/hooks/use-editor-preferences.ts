import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { EditorPreferences } from '@shared/types'

export function useEditorPreferences(): {
  preferences: EditorPreferences
  isLoading: boolean
  setVimMode: (enabled: boolean) => Promise<void>
} {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['editor-preferences'],
    queryFn: async () => {
      const result = await window.desktop.getEditorPreferences()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    staleTime: Infinity
  })

  const setVimMode = useCallback(
    async (enabled: boolean): Promise<void> => {
      const previous = queryClient.getQueryData<EditorPreferences>(['editor-preferences'])
      const optimistic = { vimMode: enabled }
      queryClient.setQueryData(['editor-preferences'], optimistic)
      const result = await window.desktop.setEditorPreferences(optimistic)
      if (!result.ok) {
        queryClient.setQueryData(['editor-preferences'], previous)
        throw new Error(result.error.message)
      }
      queryClient.setQueryData(['editor-preferences'], result.data)
    },
    [queryClient]
  )

  return {
    preferences: query.data ?? { vimMode: false },
    isLoading: query.isPending,
    setVimMode
  }
}
