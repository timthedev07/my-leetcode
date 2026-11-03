import { BookOpen, Circle, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

type StatusFooterProps = {
  leetcodeLabel: string
  connected: boolean
  onDocs: () => void
  onSettings: () => void
}

export function StatusFooter({
  leetcodeLabel,
  connected,
  onDocs,
  onSettings
}: StatusFooterProps): React.JSX.Element {
  return (
    <footer className="flex h-8 shrink-0 items-center border-t border-border bg-surface/45 px-2 text-xs text-muted">
      <nav className="flex items-center gap-0.5" aria-label="Application">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onDocs}>
          <BookOpen className="size-3" aria-hidden="true" />
          Docs
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onSettings}>
          <Settings className="size-3" aria-hidden="true" />
          Settings
        </Button>
      </nav>
      <span className="ml-auto flex items-center gap-1.5 pr-1" aria-live="polite">
        <Circle
          className={connected ? 'size-1.5 fill-emerald-400 text-emerald-400' : 'size-1.5 fill-muted/55 text-muted/55'}
          aria-hidden="true"
        />
        {leetcodeLabel}
      </span>
    </footer>
  )
}

