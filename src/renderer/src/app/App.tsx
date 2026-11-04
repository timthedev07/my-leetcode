import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenedAttempt, ProblemSummary, RecentAttempt } from '@shared/types'
import { AppHeader } from '@/components/app-header'
import { AccountsDialog } from '@/components/accounts-dialog'
import { DocsPage } from '@/components/docs-page'
import { EmptyWorkspace } from '@/components/empty-workspace'
import { GitHubSettingsDialog } from '@/components/github-settings-dialog'
import { ProblemWorkspace } from '@/components/problem-workspace'
import { RecentSidebar } from '@/components/recent-sidebar'
import { SearchPalette } from '@/components/search-palette'
import { StatusFooter } from '@/components/status-footer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { useLeetCodeAuth } from '@/hooks/use-leetcode-auth'
import { useStoredState } from '@/hooks/use-stored-state'

type UtilityView = 'docs' | 'settings' | null

export function App(): React.JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState('layout:sidebar-collapsed', false)
  const [narrowWindow, setNarrowWindow] = useState(() => window.matchMedia('(max-width: 1120px)').matches)
  const [searchOpen, setSearchOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [utilityView, setUtilityView] = useState<UtilityView>(null)
  const [docsInitialFile, setDocsInitialFile] = useState('getting-started.md')
  const [selectedProblem, setSelectedProblem] = useState<ProblemSummary | null>(null)
  const [activeAttempt, setActiveAttempt] = useState<OpenedAttempt | null>(null)
  const flushRef = useRef<(() => Promise<void>) | null>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  const leetcode = useLeetCodeAuth()
  const sidebarHidden = sidebarCollapsed || narrowWindow

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1120px)')
    const onChange = (event: MediaQueryListEvent): void => setNarrowWindow(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    return window.desktop.onPrepareQuit(async () => {
      await flushRef.current?.()
      window.desktop.completeQuitFlush()
    })
  }, [])
  const recent = useQuery({
    queryKey: ['recent-attempts'],
    queryFn: async () => {
      const result = await window.desktop.getRecentAttempts()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  useKeyboardShortcuts({
    search: () => setSearchOpen(true),
    recent: () => setRecentOpen(true),
    focusDescription: () => dispatchWorkspaceAction('description'),
    focusEditor: () => dispatchWorkspaceAction('editor'),
    focusPanel: () => dispatchWorkspaceAction('panel'),
    save: () => dispatchWorkspaceAction('save'),
    run: () => dispatchWorkspaceAction('run'),
    submit: () => dispatchWorkspaceAction('submit'),
    format: () => dispatchWorkspaceAction('format'),
    undo: () => dispatchWorkspaceAction('undo'),
    redo: () => dispatchWorkspaceAction('redo')
  })

  const selectProblem = useCallback(async (problem: ProblemSummary): Promise<void> => {
    if (selectedProblem?.titleSlug !== problem.titleSlug) {
      await flushRef.current?.()
    }
    setSelectedProblem(problem)
    setActiveAttempt(null)
  }, [selectedProblem?.titleSlug])

  const handleLoaded = useCallback((openedAttempt: OpenedAttempt) => {
    setActiveAttempt(openedAttempt)
  }, [])

  const handleFlushReady = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush
  }, [])

  const selectRecent = (attempt: RecentAttempt): void => {
    void selectProblem({
      frontendId: attempt.problemId,
      title: attempt.title,
      titleSlug: attempt.titleSlug,
      difficulty: attempt.difficulty,
      acceptanceRate: null,
      isPaidOnly: false,
      topicTags: []
    })
    setRecentOpen(false)
  }

  const openDocs = (initialFile = 'getting-started.md'): void => {
    void (async () => {
      await flushRef.current?.()
      setDocsInitialFile(initialFile)
      setUtilityView('docs')
    })()
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div className="grid h-screen min-h-[600px] grid-rows-[48px_minmax(0,1fr)_32px] overflow-hidden bg-background text-foreground">
        <AppHeader
          sidebarCollapsed={sidebarHidden}
          onToggleSidebar={() => {
            if (!narrowWindow) setSidebarCollapsed(!sidebarCollapsed)
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenAccounts={() => setAccountsOpen(true)}
          searchButtonRef={searchTriggerRef}
          showSidebarToggle={!narrowWindow}
        />

        <main
          className="grid min-h-0 overflow-hidden"
          style={{
            gridTemplateColumns:
              utilityView === 'docs' || sidebarHidden
                ? 'minmax(0,1fr)'
                : '232px minmax(0,1fr)'
          }}
        >
          {utilityView === 'docs' ? (
            <DocsPage initialFile={docsInitialFile} onClose={() => setUtilityView(null)} />
          ) : (
            <>
              <RecentSidebar
                attempts={recent.data?.attempts ?? []}
                activeProblemId={activeAttempt?.attempt.problemId ?? selectedProblem?.frontendId ?? null}
                collapsed={sidebarHidden}
                onSelect={selectRecent}
                onSelectRecommendation={(problem) => void selectProblem(problem)}
                onOpenRecent={() => setRecentOpen(true)}
                onOpenSettings={() => setUtilityView('settings')}
              />

              {selectedProblem ? (
                <ProblemWorkspace
                  problemSummary={selectedProblem}
                  onLoaded={handleLoaded}
                  onFlushReady={handleFlushReady}
                  onSearch={() => setSearchOpen(true)}
                  leetcodeConnected={leetcode.status.state === 'connected'}
                />
              ) : (
                <EmptyWorkspace onSearch={() => setSearchOpen(true)} />
              )}
            </>
          )}
        </main>

        <StatusFooter
          leetcodeLabel={
            leetcode.status.state === 'connected'
              ? `LeetCode · ${leetcode.status.username}`
              : leetcode.status.state === 'connecting'
                ? 'LeetCode · waiting for sign-in'
                : leetcode.status.state === 'expired'
                  ? 'LeetCode · session expired'
                  : 'LeetCode disconnected'
          }
          connected={leetcode.status.state === 'connected'}
          onDocs={() => openDocs()}
          onSettings={() => setUtilityView('settings')}
        />

        <SearchPalette
          open={searchOpen}
          onOpenChange={(open) => {
            setSearchOpen(open)
            if (!open) {
              window.requestAnimationFrame(() => searchTriggerRef.current?.focus())
            }
          }}
          onSelect={(problem) => void selectProblem(problem)}
          onOpenDocs={() => openDocs()}
          onOpenSettings={() => setUtilityView('settings')}
        />

        <Dialog open={recentOpen} onOpenChange={setRecentOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Recent problems</DialogTitle>
              <DialogDescription>Attempts from the last 30 days appear here.</DialogDescription>
            </DialogHeader>
            {recent.data?.attempts.length ? (
              <ol className="max-h-80 divide-y divide-border overflow-y-auto border-y border-border">
                {recent.data.attempts.map((attempt) => (
                  <li key={`${attempt.accountKey}:${attempt.problemId}`}>
                    <button
                      type="button"
                      className="w-full px-2 py-3 text-left transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => selectRecent(attempt)}
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-muted">{attempt.problemId}</span>
                        <span className="truncate">{attempt.title}</span>
                        <span className="ml-auto text-[11px] text-muted">{attempt.difficulty}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="grid place-items-center border-y border-border py-10 text-center">
                <History className="size-5 text-muted" aria-hidden="true" />
                <p className="mt-3 text-sm text-foreground">No recent problems</p>
                <p className="mt-1 text-xs text-muted">Search for a problem to begin.</p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AccountsDialog
          open={accountsOpen}
          onOpenChange={setAccountsOpen}
          onOpenSettings={() => {
            setAccountsOpen(false)
            setUtilityView('settings')
          }}
        />

        <GitHubSettingsDialog
          open={utilityView === 'settings'}
          onOpenChange={(open) => !open && setUtilityView(null)}
          onOpenDocs={() => {
            setUtilityView(null)
            openDocs('github-authentication.md')
          }}
        />

      </div>
    </TooltipProvider>
  )
}

function dispatchWorkspaceAction(
  action: 'description' | 'editor' | 'panel' | 'save' | 'run' | 'submit' | 'format'
    | 'undo'
    | 'redo'
): void {
  window.dispatchEvent(new CustomEvent('leetcode:workspace-action', { detail: action }))
}

