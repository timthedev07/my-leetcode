import { ChevronsUp, Clock3 } from 'lucide-react'
import type { RecentAttempt } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type RecentSidebarProps = {
  attempts: RecentAttempt[]
  activeProblemId: string | null
  collapsed: boolean
  onSelect: (attempt: RecentAttempt) => void
  onOpenRecent: () => void
}

export function RecentSidebar({
  attempts,
  activeProblemId,
  collapsed,
  onSelect,
  onOpenRecent
}: RecentSidebarProps): React.JSX.Element | null {
  if (collapsed) return null

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-surface/35" aria-label="Recent problems">
      <div className="flex h-10 shrink-0 items-center px-3">
        <h2 className="text-xs font-medium text-muted">Recent</h2>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          aria-label="Choose a recent problem"
          onClick={onOpenRecent}
        >
          <ChevronsUp className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {attempts.length === 0 ? (
          <div className="mx-1 mt-1 rounded-md border border-dashed border-border px-3 py-5 text-center text-xs leading-5 text-muted">
            Open a problem to start
            <br />
            a local C++ attempt.
          </div>
        ) : (
          <ol className="space-y-0.5">
            {attempts.map((attempt) => {
              const active = activeProblemId === attempt.problemId
              return (
                <li key={`${attempt.accountKey}:${attempt.problemId}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(attempt)}
                    className={cn(
                      'group w-full rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'bg-accent/10 text-foreground' : 'text-muted hover:bg-surface-raised hover:text-foreground'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px]">{attempt.title}</span>
                      {active && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      <span>{attempt.problemId}</span>
                      <span aria-hidden="true">·</span>
                      <span>{attempt.difficulty}</span>
                      <Clock3 className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </aside>
  )
}

