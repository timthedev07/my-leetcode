import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { GitHubAuthStatus } from '@shared/types'

const disconnected: GitHubAuthStatus = {
  state: 'disconnected',
  username: null,
  avatarUrl: null
}

export function useGitHubAuth(): GitHubAuthStatus {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['github-auth-status'],
    queryFn: async () => {
      const result = await window.desktop.getGitHubStatus()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    staleTime: Infinity,
    retry: false
  })

  useEffect(() => {
    return window.desktop.onGitHubStatus((nextStatus) => {
      queryClient.setQueryData(['github-auth-status'], nextStatus)
      void queryClient.invalidateQueries({ queryKey: ['github-repositories'] })
    })
  }, [queryClient])

  return status.data ?? disconnected
}

