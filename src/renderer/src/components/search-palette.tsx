import { useQuery } from '@tanstack/react-query'
import { BookOpen, CircleAlert, Settings2 } from 'lucide-react'
import { useState } from 'react'
import type { ProblemSummary } from '@shared/types'
import { SEARCH_DEBOUNCE_MS } from '@shared/constants'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading
} from '@/components/ui/command'
import { Kbd } from '@/components/kbd'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

type SearchPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (problem: ProblemSummary) => void
  onOpenDocs: () => void
  onOpenSettings: () => void
}

export function SearchPalette({
  open,
  onOpenChange,
  onSelect,
  onOpenDocs,
  onOpenSettings
}: SearchPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)

  const search = useQuery({
    queryKey: ['problem-search', debouncedQuery],
    enabled: open && debouncedQuery.trim().length >= 2,
    queryFn: async () => {
      const result = await window.desktop.searchProblems(debouncedQuery, 1, 20)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setQuery('')
        onOpenChange(nextOpen)
      }}
      title="Search LeetCode problems"
      description="Search by problem number, title, slug or topic. Use the arrow keys and press Enter to open a result."
      className="top-[18%] max-w-2xl translate-y-0"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Problem number, title, slug or topic"
        aria-label="Search LeetCode problems"
      />
      <CommandList>
        {query.trim().length < 2 ? (
          <>
            <CommandGroup heading="Go to">
              <CommandItem
                value="Documentation docs"
                onSelect={() => {
                  onOpenChange(false)
                  onOpenDocs()
                }}
              >
                <BookOpen className="size-4 text-muted" aria-hidden="true" />
                Documentation
              </CommandItem>
              <CommandItem
                value="Settings GitHub connections"
                onSelect={() => {
                  onOpenChange(false)
                  onOpenSettings()
                }}
              >
                <Settings2 className="size-4 text-muted" aria-hidden="true" />
                Settings
              </CommandItem>
            </CommandGroup>
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-muted">Search by problem number, title, slug or topic.</p>
              <p className="mt-2 text-xs text-muted/70">
                Try <span className="font-mono text-foreground/80">209</span> or{' '}
                <span className="font-mono text-foreground/80">sliding window</span>.
              </p>
            </div>
          </>
        ) : search.isPending ? (
          <CommandLoading>Searching LeetCode</CommandLoading>
        ) : search.isError ? (
          <div className="flex items-start gap-2.5 px-3 py-7 text-left text-sm text-muted" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="text-foreground">Search is unavailable</p>
              <p className="mt-1 text-xs leading-5">{search.error.message}</p>
            </div>
          </div>
        ) : search.data?.problems.length === 0 ? (
          <CommandEmpty>
            No problems match <span className="text-foreground">“{debouncedQuery}”</span>.
          </CommandEmpty>
        ) : (
          <CommandGroup heading={search.data ? `${search.data.total.toLocaleString()} matching problems` : undefined}>
            {search.data?.problems.map((problem) => (
              <CommandItem
                key={problem.titleSlug}
                value={`${problem.frontendId} ${problem.title} ${problem.titleSlug} ${problem.difficulty}`}
                onSelect={() => {
                  onOpenChange(false)
                  onSelect(problem)
                }}
                className="items-start px-2.5 py-2.5"
              >
                <span className="w-11 shrink-0 pt-0.5 font-mono text-xs text-muted">{problem.frontendId}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">{problem.title}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <DifficultyLabel difficulty={problem.difficulty} />
                    {problem.topicTags.slice(0, 2).map((tag) => (
                      <span key={tag.slug} className="truncate text-[11px] text-muted">
                        {tag.name}
                      </span>
                    ))}
                  </span>
                </span>
                <Kbd className="mt-0.5 hidden shrink-0 group-data-[selected=true]:inline-flex">↵</Kbd>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}

function DifficultyLabel({ difficulty }: { difficulty: ProblemSummary['difficulty'] }): React.JSX.Element {
  const colour =
    difficulty === 'Easy' ? 'text-emerald-400/85' : difficulty === 'Medium' ? 'text-amber-400/80' : 'text-rose-400/85'
  return <span className={`text-[11px] ${colour}`}>{difficulty}</span>
}

