import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { LeetCodeAuthStatus } from '@shared/types'

const disconnected: LeetCodeAuthStatus = {
  state: 'disconnected',
  username: null,
  message: null
}

export function useLeetCodeAuth(): {
  status: LeetCodeAuthStatus
  isLoading: boolean
  error: Error | null
} {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: ['leetcode-auth-status'],
    queryFn: async () => {
      const result = await window.desktop.getLeetCodeStatus()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    staleTime: Infinity,
    retry: false
  })

  useEffect(() => {
    return window.desktop.onLeetCodeStatus((status) => {
      queryClient.setQueryData(['leetcode-auth-status'], status)
      void queryClient.invalidateQueries({ queryKey: ['leetcode-statistics'] })
      void queryClient.invalidateQueries({ queryKey: ['recent-attempts'] })
    })
  }, [queryClient])

  return {
    status: statusQuery.data ?? disconnected,
    isLoading: statusQuery.isPending,
    error: statusQuery.error
  }
}

