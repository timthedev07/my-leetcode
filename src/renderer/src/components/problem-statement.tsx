import { forwardRef, useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import type { ProblemDetail } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ProblemStatementProps = {
  problem: ProblemDetail
}

export const ProblemStatement = forwardRef<HTMLElement, ProblemStatementProps>(
  function ProblemStatement({ problem }, forwardedRef) {
    return (
      <section
        ref={forwardedRef}
        tabIndex={-1}
        className="flex h-full min-h-0 flex-col overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-labelledby="problem-title"
      >
        <header className="flex min-h-[68px] shrink-0 items-start gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 id="problem-title" className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.01em]">
                {problem.frontendId}. {problem.title}
              </h1>
              <span className={difficultyClass(problem.difficulty)}>{problem.difficulty}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {problem.topicTags.map((tag) => (
                <span
                  key={tag.slug}
                  className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Open on LeetCode"
            onClick={() => {
              void window.desktop.openExternal(`https://leetcode.com/problems/${problem.titleSlug}/`)
            }}
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">LeetCode</span>
          </Button>
        </header>

        <Tabs defaultValue="description" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border px-4">
            <TabsList className="h-10 gap-1 rounded-none border-0 bg-transparent p-0">
              <TabsTrigger
                value="description"
                className="h-10 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-0"
              >
                Description
              </TabsTrigger>
              {problem.hints.length > 0 ? (
                <TabsTrigger
                  value="hints"
                  className="h-10 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-0"
                >
                  Hints
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>
          <TabsContent
            value="description"
            className="statement-content min-h-0 flex-1 overflow-y-auto px-6 py-5"
          >
            {problem.isPaidOnly && problem.contentHtml.trim().length === 0 ? (
              <div className="border-l-2 border-accent/60 pl-4 text-sm text-muted">
                This premium problem does not expose its statement to this account.
              </div>
            ) : (
              <RichProblemHtml html={problem.contentHtml} />
            )}
          </TabsContent>
          <TabsContent value="hints" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <ol className="space-y-4">
              {problem.hints.map((hint, index) => (
                <li key={index} className="flex gap-3 text-sm leading-6 text-muted">
                  <span className="font-mono text-xs text-accent">{index + 1}</span>
                  <RichProblemHtml html={hint} />
                </li>
              ))}
            </ol>
          </TabsContent>
        </Tabs>
      </section>
    )
  }
)

function RichProblemHtml({ html }: { html: string }): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const href = target.closest('a')?.getAttribute('href')
      if (!href) return
      event.preventDefault()
      void window.desktop.openExternal(href)
    }
    content.addEventListener('click', onClick)
    return () => content.removeEventListener('click', onClick)
  }, [])

  return <div ref={contentRef} className="statement-content" dangerouslySetInnerHTML={{ __html: html }} />
}

function difficultyClass(difficulty: ProblemDetail['difficulty']): string {
  const colour =
    difficulty === 'Easy'
      ? 'text-emerald-400/90'
      : difficulty === 'Medium'
        ? 'text-amber-400/90'
        : 'text-rose-400/90'
  return `shrink-0 text-xs ${colour}`
}

