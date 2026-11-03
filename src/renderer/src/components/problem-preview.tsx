import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ExternalLink, RotateCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ProblemSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ProblemPreviewProps = {
  problemSummary: ProblemSummary
  onOpenSearch: () => void
}

export function ProblemPreview({ problemSummary, onOpenSearch }: ProblemPreviewProps): React.JSX.Element {
  const problem = useQuery({
    queryKey: ['problem-detail', problemSummary.titleSlug],
    queryFn: async () => {
      const result = await window.desktop.getProblem(problemSummary.titleSlug)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden" aria-labelledby="problem-title">
      <header className="flex min-h-16 shrink-0 items-start gap-4 border-b border-border px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 id="problem-title" className="min-w-0 truncate text-[17px] font-semibold tracking-tight">
              {problemSummary.frontendId}. {problemSummary.title}
            </h1>
            <span className={difficultyClass(problemSummary.difficulty)}>{problemSummary.difficulty}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {problemSummary.topicTags.map((tag) => (
              <span key={tag.slug} className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted">
                {tag.name}
              </span>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void window.desktop.openExternal(`https://leetcode.com/problems/${problemSummary.titleSlug}/`)
          }}
        >
          LeetCode
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Button>
      </header>

      {problem.isPending ? (
        <div className="grid flex-1 place-items-center text-sm text-muted" aria-live="polite">
          <span className="flex items-center gap-2">
            <RotateCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading problem
          </span>
        </div>
      ) : problem.isError ? (
        <div className="grid flex-1 place-items-center p-8" role="alert">
          <div className="max-w-sm text-center">
            <AlertCircle className="mx-auto size-5 text-destructive" aria-hidden="true" />
            <h2 className="mt-3 text-sm font-medium">Problem unavailable</h2>
            <p className="mt-1 text-xs leading-5 text-muted">{problem.error.message}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={onOpenSearch}>
                Search again
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void problem.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="description" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border px-4">
            <TabsList className="h-10 gap-1 rounded-none border-0 bg-transparent p-0">
              <TabsTrigger
                value="description"
                className="h-10 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-0"
              >
                Description
              </TabsTrigger>
              {problem.data.hints.length > 0 ? (
                <TabsTrigger
                  value="hints"
                  className="h-10 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-0"
                >
                  Hints
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>
          <TabsContent value="description" className="statement-content min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {problem.data.isPaidOnly && problem.data.contentHtml.trim().length === 0 ? (
              <div className="border-l-2 border-accent/60 pl-4 text-sm text-muted">
                This premium problem does not expose its statement to this account.
              </div>
            ) : (
              <RichProblemHtml html={problem.data.contentHtml} />
            )}
          </TabsContent>
          <TabsContent value="hints" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <ol className="space-y-4">
              {problem.data.hints.map((hint, index) => (
                <li key={index} className="flex gap-3 text-sm leading-6 text-muted">
                  <span className="font-mono text-xs text-accent">{index + 1}</span>
                  <RichProblemHtml html={hint} />
                </li>
              ))}
            </ol>
          </TabsContent>
        </Tabs>
      )}
    </section>
  )
}

function RichProblemHtml({ html }: { html: string }): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      const href = anchor?.getAttribute('href')
      if (!href) return
      event.preventDefault()
      void window.desktop.openExternal(href)
    }

    content.addEventListener('click', onClick)
    return () => content.removeEventListener('click', onClick)
  }, [])

  return (
    <div
      ref={contentRef}
      className="statement-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function difficultyClass(difficulty: ProblemSummary['difficulty']): string {
  const colour =
    difficulty === 'Easy' ? 'text-emerald-400/90' : difficulty === 'Medium' ? 'text-amber-400/90' : 'text-rose-400/90'
  return `shrink-0 text-xs ${colour}`
}

