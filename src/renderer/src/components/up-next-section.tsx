import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronRight, RefreshCw, Settings } from "lucide-react";
import type { ProblemSummary, RecommendedProblem } from "@shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGitHubAuth } from "@/hooks/use-github-auth";

type UpNextSectionProps = {
  activeProblemId: string | null;
  onSelect: (problem: ProblemSummary) => void;
  onOpenSettings: () => void;
};

export function UpNextSection({
  activeProblemId,
  onSelect,
  onOpenSettings,
}: UpNextSectionProps): React.JSX.Element {
  const github = useGitHubAuth();
  const settings = useQuery({
    queryKey: ["github-settings"],
    enabled: github.state === "connected",
    queryFn: async () => {
      const result = await window.desktop.getGitHubSettings();
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
  });
  const progress = useQuery({
    queryKey: [
      "github-progress",
      settings.data?.repository,
      settings.data?.branch,
    ],
    enabled:
      github.state === "connected" &&
      settings.data?.configured === true &&
      Boolean(settings.data.repository && settings.data.branch),
    queryFn: async () => {
      const result = await window.desktop.getGitHubProgress();
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    staleTime: 30_000,
    retry: false,
  });

  const overview = progress.data;
  const stale = progress.isError && overview !== undefined;

  return (
    <section
      className="shrink-0 border-b border-border px-2 pb-3"
      aria-labelledby="up-next-title"
    >
      <div className="flex h-10 items-center">
        <h2 id="up-next-title" className="px-1 text-xs font-medium text-muted">
          Up Next
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          aria-label="Refresh recommendations"
          onClick={() => void progress.refetch()}
          disabled={
            github.state !== "connected" ||
            settings.data?.configured !== true ||
            progress.isFetching
          }
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              progress.isFetching && "animate-spin motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
        </Button>
      </div>

      {github.state !== "connected" ? (
        <EmptyState
          message="Connect GitHub to load progressive recommendations."
          action="Connect GitHub"
          onAction={onOpenSettings}
        />
      ) : settings.isPending ? (
        <LoadingRows />
      ) : settings.data?.configured !== true ? (
        <EmptyState
          message="Choose and verify a repository to load recommendations."
          action="Configure repository"
          onAction={onOpenSettings}
        />
      ) : progress.isPending ? (
        <LoadingRows />
      ) : progress.isError && !overview ? (
        <div className="mx-1 rounded-md border border-dashed border-border px-3 py-4">
          <p className="text-xs leading-5 text-destructive" role="alert">
            {progress.error.message}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2"
            onClick={() => void progress.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : overview ? (
        <>
          <p className="mb-2 flex items-center justify-between px-1 text-[11px] text-muted">
            <span>
              {overview.statistics.completed} /{" "}
              {overview.statistics.targetCount} completed
            </span>
            <span>{overview.statistics.percentage.toFixed(1)}%</span>
          </p>
          {stale ? (
            <p
              className="mb-2 px-1 text-[11px] leading-4 text-amber-300/85"
              role="status"
            >
              Showing the last loaded progress. It may be stale.
            </p>
          ) : null}
          {overview.recommendations.length === 0 ? (
            <p className="mx-1 rounded-md border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted">
              All progressive problems are complete.
            </p>
          ) : (
            <ol className="space-y-0.5">
              {overview.recommendations.map((problem) => (
                <li key={problem.id}>
                  <RecommendedProblemItem
                    problem={problem}
                    active={activeProblemId === String(problem.id)}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </section>
  );
}

type RecommendedProblemItemProps = {
  problem: RecommendedProblem;
  active: boolean;
  onSelect: (problem: ProblemSummary) => void;
};

function RecommendedProblemItem({
  problem,
  active,
  onSelect,
}: RecommendedProblemItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() =>
        onSelect({
          frontendId: String(problem.id),
          title: problem.name,
          titleSlug: problem.slug,
          difficulty: problem.difficulty,
          acceptanceRate: null,
          isPaidOnly: false,
          topicTags: [],
        })
      }
      className={cn(
        "group w-full rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent/10 text-foreground"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-accent/80">
          {String(problem.order).padStart(3, "0")}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px]"
          title={problem.name}
        >
          {problem.name}
        </span>
        <ArrowUpRight
          className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
          aria-hidden="true"
        />
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 pl-[34px] text-[11px] text-muted">
        <span>{problem.id}</span>
        <span aria-hidden="true">·</span>
        <span>{problem.difficulty}</span>
        <span aria-hidden="true">·</span>
        <span>Phase {problem.phase}</span>
      </span>
    </button>
  );
}

function EmptyState({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <div className="mx-1 rounded-md border border-dashed border-border px-2.5 py-3">
      <p className="text-xs leading-5 text-muted">{message}</p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2.5 h-7 w-full justify-start gap-1.5 px-2"
        onClick={onAction}
      >
        <Settings className="size-3.5" aria-hidden="true" />
        <span className="truncate text-xs">{action}</span>
        <ChevronRight
          className="ml-auto size-3.5 shrink-0"
          aria-hidden="true"
        />
      </Button>
    </div>
  );
}

function LoadingRows(): React.JSX.Element {
  return (
    <div
      className="space-y-1 px-1"
      aria-label="Loading recommendations"
      role="status"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="rounded-md px-1.5 py-2">
          <div className="h-3 w-4/5 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
          <div className="mt-1.5 h-2.5 w-2/5 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
