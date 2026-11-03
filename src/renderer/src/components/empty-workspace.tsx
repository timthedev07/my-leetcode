import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'

type EmptyWorkspaceProps = {
  onSearch: () => void
}

export function EmptyWorkspace({ onSearch }: EmptyWorkspaceProps): React.JSX.Element {
  return (
    <section className="grid min-h-0 place-items-center overflow-auto p-8" aria-labelledby="welcome-title">
      <div className="w-full max-w-[360px] text-center">
        <h1 id="welcome-title" className="text-[17px] font-semibold tracking-tight">
          No problem open
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">Search the LeetCode catalogue to begin.</p>
        <Button className="mt-5" onClick={onSearch}>
          <Search className="size-4" aria-hidden="true" />
          Find a problem
        </Button>
      </div>
    </section>
  )
}

