import { useQuery } from '@tanstack/react-query'
import { DEFAULT_CLANG_FORMAT_YAML } from '@shared/constants'

export function useClangFormatConfig(): {
  yaml: string
  isLoading: boolean
  error: Error | null
} {
  const query = useQuery({
    queryKey: ['clang-format-config'],
    queryFn: async () => {
      const result = await window.desktop.getClangFormatConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    staleTime: Infinity
  })

  return {
    yaml: query.data?.yaml ?? DEFAULT_CLANG_FORMAT_YAML,
    isLoading: query.isPending,
    error: query.error
  }
}
