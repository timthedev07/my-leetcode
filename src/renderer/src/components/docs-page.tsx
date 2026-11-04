import { BookOpen, ChevronLeft } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const documents = import.meta.glob("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const order = [
  "getting-started.md",
  "leetcode-authentication.md",
  "github-authentication.md",
  "github-sync.md",
  "vim-and-formatting.md",
  "keyboard-shortcuts.md",
  "settings-and-storage.md",
  "troubleshooting.md",
  "architecture.md",
  "api-compatibility.md",
  "development.md",
];

const pages = order.flatMap((filename) => {
  const source = Object.entries(documents).find(([path]) =>
    path.endsWith(`/${filename}`),
  )?.[1];
  if (!source) return [];
  const title = /^#\s+(.+)$/m.exec(source)?.[1] ?? filename;
  return [{ filename, title, source }];
});

type DocsPageProps = {
  initialFile?: string;
  onClose: () => void;
};

export function DocsPage({
  initialFile = pages[0]?.filename ?? "",
  onClose,
}: DocsPageProps): React.JSX.Element {
  const [activeFile, setActiveFile] = useState(
    pages.some((page) => page.filename === initialFile)
      ? initialFile
      : (pages[0]?.filename ?? ""),
  );
  const active = pages.find((page) => page.filename === activeFile) ?? pages[0];

  return (
    <section
      className="grid min-h-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden"
      aria-labelledby="docs-title"
    >
      <header className="flex items-center gap-3 border-b border-border px-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Workspace
        </Button>
        <div className="h-4 w-px bg-border" aria-hidden="true" />
        <BookOpen className="size-3.5 text-accent" aria-hidden="true" />
        <h1 id="docs-title" className="text-[13px] font-medium">
          Documentation
        </h1>
      </header>

      <div className="grid min-h-0 grid-cols-[228px_minmax(0,1fr)]">
        <nav
          className="min-h-0 overflow-y-auto border-r border-border bg-surface/35 p-2"
          aria-label="Documentation"
        >
          <ol className="space-y-0.5">
            {pages.map((page) => (
              <li key={page.filename}>
                <button
                  type="button"
                  onClick={() => setActiveFile(page.filename)}
                  aria-current={
                    activeFile === page.filename ? "page" : undefined
                  }
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeFile === page.filename
                      ? "bg-accent/10 text-foreground"
                      : "text-muted hover:bg-surface-raised hover:text-foreground",
                  )}
                >
                  <span className="text-xs">{page.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-h-0 overflow-y-auto px-8 py-7">
          <div className="docs-content mx-auto max-w-3xl">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(event) => {
                      event.preventDefault();
                      if (!href) return;
                      if (href.startsWith("https://")) {
                        void window.desktop.openExternal(href);
                        return;
                      }
                      const filename = href.split("/").at(-1);
                      if (
                        filename &&
                        pages.some((page) => page.filename === filename)
                      ) {
                        setActiveFile(filename);
                      }
                    }}
                  >
                    {children}
                  </a>
                ),
                code: ({ children, className }) => (
                  <code className={className}>{children}</code>
                ),
              }}
            >
              {active?.source ?? "# Documentation unavailable"}
            </ReactMarkdown>
          </div>
        </article>
      </div>
    </section>
  );
}
