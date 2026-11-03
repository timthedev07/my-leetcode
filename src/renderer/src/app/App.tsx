import { useQuery } from '@tanstack/react-query'
import { BookOpen, Command, Search, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function App(): React.JSX.Element {
  const appInfo = useQuery({
    queryKey: ['app-info'],
    queryFn: async () => {
      const result = await window.desktop.getAppInfo()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  return (
    <div className="grid min-h-screen grid-rows-[48px_1fr_30px] bg-background text-foreground">
      <header className="drag-region flex items-center border-b border-border px-4 pl-24">
        <div className="w-52 text-[13px] font-semibold tracking-tight">LeetCode Desktop</div>
        <button
          type="button"
          className="no-drag flex h-8 w-full max-w-xl items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-[13px] text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="flex-1">Search problems</span>
          <kbd className="flex items-center gap-0.5 rounded border border-border bg-surface-raised px-1.5 py-0.5 font-sans text-[10px]">
            <Command className="size-2.5" aria-hidden="true" />K
          </kbd>
        </button>
        <div className="ml-auto">
          <Button variant="ghost" size="sm">Accounts</Button>
        </div>
      </header>

      <main className="grid min-h-0 grid-cols-[232px_1fr]">
        <aside className="border-r border-border bg-surface/60 p-3" aria-label="Recent problems">
          <div className="mb-2 px-2 text-xs font-medium text-muted">Recent</div>
          <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs leading-5 text-muted">
            Open a problem to start
            <br />
            a local C++ attempt.
          </div>
        </aside>

        <section className="grid min-h-0 place-items-center p-8">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold tracking-tight">Solve in a focused workspace</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Search the live LeetCode catalogue, keep a private C++ draft, and send accepted code to a chosen GitHub branch.
            </p>
            <Button className="mt-5">
              <Search className="size-4" aria-hidden="true" />
              Search problems
            </Button>
          </div>
        </section>
      </main>

      <footer className="flex items-center border-t border-border bg-surface/45 px-4 text-xs text-muted">
        <nav className="flex items-center gap-1" aria-label="Application">
          <Button variant="ghost" size="sm">
            <BookOpen className="size-3.5" aria-hidden="true" />
            Docs
          </Button>
          <Button variant="ghost" size="sm">
            <Settings className="size-3.5" aria-hidden="true" />
            Settings
          </Button>
        </nav>
        <span className="ml-auto">
          LeetCode disconnected
          {appInfo.data ? ` · v${appInfo.data.version}` : ''}
        </span>
      </footer>
    </div>
  )
}

