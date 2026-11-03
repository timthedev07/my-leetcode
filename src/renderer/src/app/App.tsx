import { useQuery } from '@tanstack/react-query'
import { ExternalLink, History, Laptop, ShieldCheck, UserRound } from 'lucide-react'
import { useState } from 'react'
import type { Attempt, ProblemSummary } from '@shared/types'
import { AppHeader } from '@/components/app-header'
import { EmptyWorkspace } from '@/components/empty-workspace'
import { ProblemPreview } from '@/components/problem-preview'
import { RecentSidebar } from '@/components/recent-sidebar'
import { SearchPalette } from '@/components/search-palette'
import { StatusFooter } from '@/components/status-footer'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { useStoredState } from '@/hooks/use-stored-state'

type UtilityView = 'docs' | 'settings' | null

export function App(): React.JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState('layout:sidebar-collapsed', false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [utilityView, setUtilityView] = useState<UtilityView>(null)
  const [selectedProblem, setSelectedProblem] = useState<ProblemSummary | null>(null)
  const [activeAttempt, setActiveAttempt] = useState<Attempt | null>(null)

  const appInfo = useQuery({
    queryKey: ['app-info'],
    queryFn: async () => {
      const result = await window.desktop.getAppInfo()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    staleTime: Infinity
  })

  useKeyboardShortcuts({
    search: () => setSearchOpen(true),
    recent: () => setRecentOpen(true)
  })

  const selectProblem = (problem: ProblemSummary): void => {
    setSelectedProblem(problem)
    setActiveAttempt(null)
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div className="grid h-screen min-h-[600px] grid-rows-[48px_minmax(0,1fr)_32px] overflow-hidden bg-background text-foreground">
        <AppHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenAccounts={() => setAccountsOpen(true)}
        />

        <main
          className="grid min-h-0 overflow-hidden"
          style={{ gridTemplateColumns: sidebarCollapsed ? 'minmax(0,1fr)' : '232px minmax(0,1fr)' }}
        >
          <RecentSidebar
            attempts={[]}
            activeProblemId={activeAttempt?.problemId ?? selectedProblem?.frontendId ?? null}
            collapsed={sidebarCollapsed}
            onSelect={setActiveAttempt}
            onOpenRecent={() => setRecentOpen(true)}
          />

          {selectedProblem ? (
            <ProblemPreview problemSummary={selectedProblem} onOpenSearch={() => setSearchOpen(true)} />
          ) : (
            <EmptyWorkspace onSearch={() => setSearchOpen(true)} />
          )}
        </main>

        <StatusFooter
          leetcodeLabel="LeetCode disconnected"
          connected={false}
          onDocs={() => setUtilityView('docs')}
          onSettings={() => setUtilityView('settings')}
        />

        <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} onSelect={selectProblem} />

        <Dialog open={recentOpen} onOpenChange={setRecentOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Recent problems</DialogTitle>
              <DialogDescription>Attempts from the last 30 days appear here.</DialogDescription>
            </DialogHeader>
            <div className="grid place-items-center border-y border-border py-10 text-center">
              <History className="size-5 text-muted" aria-hidden="true" />
              <p className="mt-3 text-sm text-foreground">No recent problems</p>
              <p className="mt-1 text-xs text-muted">Search for a problem to begin.</p>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={accountsOpen} onOpenChange={setAccountsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Accounts</DialogTitle>
              <DialogDescription>LeetCode and GitHub connections are managed here.</DialogDescription>
            </DialogHeader>
            <div className="divide-y divide-border border-y border-border">
              <ConnectionRow
                icon={<UserRound className="size-4" aria-hidden="true" />}
                label="LeetCode"
                status="Not connected"
              />
              <ConnectionRow
                icon={<Laptop className="size-4" aria-hidden="true" />}
                label="GitHub"
                status="Not connected"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  void window.desktop.openExternal('https://leetcode.com/')
                }}
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open LeetCode
              </Button>
              <Button
                onClick={() => {
                  setAccountsOpen(false)
                  setUtilityView('settings')
                }}
              >
                Open settings
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={utilityView !== null} onOpenChange={(open) => !open && setUtilityView(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{utilityView === 'docs' ? 'Documentation' : 'Settings'}</DialogTitle>
              <DialogDescription>
                {utilityView === 'docs'
                  ? 'Setup and troubleshooting guidance will be available in the bundled documentation area.'
                  : 'Connection, repository and local storage preferences.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 border-y border-border py-5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <p className="text-xs leading-5 text-muted">
                Credentials are stored outside the rendered interface. Application version{' '}
                {appInfo.data?.version ?? '…'} on {appInfo.data?.platform ?? 'this platform'}.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}

function ConnectionRow({
  icon,
  label,
  status
}: {
  icon: React.ReactNode
  label: string
  status: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="text-muted">{icon}</span>
      <span className="text-sm">{label}</span>
      <span className="ml-auto text-xs text-muted">{status}</span>
    </div>
  )
}

