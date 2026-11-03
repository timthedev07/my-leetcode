import { Braces, Search, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

type EmptyWorkspaceProps = {
  onSearch: () => void
}

export function EmptyWorkspace({ onSearch }: EmptyWorkspaceProps): React.JSX.Element {
  return (
    <section className="grid min-h-0 place-items-center overflow-auto p-8" aria-labelledby="welcome-title">
      <div className="w-full max-w-[460px]">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg border border-accent/25 bg-accent/8 text-accent">
            <Braces className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 id="welcome-title" className="text-[17px] font-semibold tracking-tight">
              A focused C++ workspace
            </h1>
            <p className="mt-0.5 text-[13px] text-muted">Live problems, local drafts and deliberate remote actions.</p>
          </div>
        </div>

        <div className="border-y border-border py-5">
          <p className="text-sm leading-6 text-muted">
            Search the live LeetCode catalogue. Your draft stays on this Mac until it is submitted, and GitHub sync uses only
            an Accepted C++ submission recorded by LeetCode.
          </p>
          <Button className="mt-4" onClick={onSearch}>
            <Search className="size-4" aria-hidden="true" />
            Find a problem
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-2.5 text-xs leading-5 text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent/80" aria-hidden="true" />
          <p>Credentials stay in trusted processes. LeetCode sessions use a dedicated browser profile and are never exposed to the editor.</p>
        </div>
      </div>
    </section>
  )
}

