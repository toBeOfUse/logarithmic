import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ChildrenList } from "~/components/ChildrenList.tsx";
import { MarkdownEditor } from "~/components/Editor.tsx";
import { MetadataPills } from "~/components/MetadataPills.tsx";
import { TopBar } from "~/components/TopBar.tsx";
import { cn } from "~/lib/cn.ts";
import {
  isDemoLogbook,
  useCreateEntry,
  useEntry,
  useLogbookOverview,
  useRenameEntry,
  useUpdateEntryContent,
} from "~/data/hooks.ts";

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function wordCount(markdown: string | null): number {
  if (!markdown) return 0;
  return markdown
    .replace(/[`*_>#-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

const appShell =
  "font-sans text-primary text-base leading-[1.5] h-full w-full flex flex-col bg-stark overflow-hidden";

const btn =
  "[font:inherit] text-sm font-medium border border-stark-border bg-stark text-primary px-[11px] py-[6px] rounded-[6px] cursor-pointer inline-flex items-center gap-[6px] transition-colors no-underline hover:bg-stark-soft disabled:opacity-[0.55] disabled:cursor-not-allowed";

export default function EntryRoute() {
  const params = useParams();
  const logbookId = params.logbookId ?? "";
  const entryId = params.entryId ?? "";
  const demo = isDemoLogbook(logbookId);
  const navigate = useNavigate();

  const { data: entry, isLoading } = useEntry(entryId, { demo });
  const { data: overview } = useLogbookOverview(logbookId, { demo });

  const updateContent = useUpdateEntryContent({ demo });
  const renameEntry = useRenameEntry({ demo });
  const createEntry = useCreateEntry({ demo });

  const [maximized, setMaximized] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  if (isLoading || !entry || !overview) {
    return (
      <div className={appShell}>
        <TopBar
          logbookId={logbookId}
          logbookName={overview?.logbook.name ?? (isLoading ? "Loading…" : "Logbook")}
          currentName={isLoading ? "Loading…" : "Not found"}
        />
        <div className="flex-1 overflow-y-auto bg-stark">
          <div className="max-w-[720px] mx-auto px-14 pt-14 pb-[120px]">
            <p className="text-muted">{isLoading ? "Loading entry…" : "Entry not found."}</p>
          </div>
        </div>
      </div>
    );
  }

  const logbook = overview.logbook;
  const ancestors = entry.ancestors;
  const parent = ancestors[ancestors.length - 1] ?? null;

  const titleValue = titleDraft ?? entry.name;
  const isUntitled = !titleValue;

  const onTitleBlur = () => {
    if (titleDraft != null && titleDraft !== entry.name) {
      renameEntry.mutate({ id: entry.id, name: titleDraft });
    }
    setTitleDraft(null);
  };

  const onSaveContent = (markdown: string) => {
    setSaving(true);
    updateContent.mutate(
      { id: entry.id, content: markdown },
      {
        onSettled: () => {
          setSaving(false);
          setSavedAt(new Date());
        },
      },
    );
  };

  const addChild = () => {
    createEntry.mutate(
      { logbookId, name: "", col: entry.col - 1, parentId: entry.id },
      {
        onSuccess: (created) => {
          if (created) void navigate(`/${logbookId}/${created.id}`);
        },
      },
    );
  };

  if (maximized) {
    return (
      <div className={cn(appShell, "bg-stark")}>
        <div className="flex-1 overflow-y-auto bg-stark">
          <div className="max-w-[680px] mx-auto px-14 pt-[88px] pb-[120px]">
            <div className="flex items-start gap-3 mb-[18px]">
              <input
                className={cn(
                  "font-sans text-4xl leading-[1.2] tracking-[-0.02em] font-semibold text-primary flex-1 m-0 bg-transparent border-0 outline-none p-0 w-full",
                  isUntitled && "text-muted",
                )}
                value={titleValue}
                placeholder="Untitled entry"
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={onTitleBlur}
              />
              <button
                type="button"
                className={cn(btn, "mt-1.5 flex-shrink-0")}
                onClick={() => setMaximized(false)}
                title="Exit focus"
              >
                <i className="ri-fullscreen-exit-line" />
                Exit focus
              </button>
            </div>
            <MarkdownEditor
              key={entry.id}
              initialMarkdown={entry.content ?? ""}
              onSave={onSaveContent}
              onSavingChange={setSaving}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={appShell}>
      <TopBar
        logbookId={logbook.id}
        logbookName={logbook.name}
        parents={ancestors.map((a) => ({
          id: a.id,
          name: a.name,
          href: `/${logbook.id}/${a.id}`,
        }))}
        currentName={entry.name || "Untitled entry"}
      />
      <div className="flex-1 overflow-y-auto bg-stark">
        <div className="max-w-[720px] mx-auto px-14 pt-14 pb-[120px]">
          {parent && (
            <Link
              to={`/${logbook.id}/${parent.id}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted no-underline mb-[18px] hover:text-primary"
            >
              <i className="ri-arrow-left-line" />
              {parent.name}
            </Link>
          )}

          <div className="flex items-start gap-3 mb-[18px]">
            <input
              className={cn(
                "font-sans text-4xl leading-[1.2] tracking-[-0.02em] font-semibold text-primary flex-1 m-0 bg-transparent border-0 outline-none p-0 w-full",
                isUntitled && "text-muted",
              )}
              value={titleValue}
              placeholder="Untitled entry"
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={onTitleBlur}
            />
            <button
              type="button"
              className={cn(btn, "mt-1.5 flex-shrink-0")}
              onClick={() => setMaximized(true)}
              title="Maximize editor"
            >
              <i className="ri-fullscreen-line" />
              Focus
            </button>
          </div>

          <MetadataPills metadata={entry.metadata} />

          <ChildrenList logbookId={logbook.id} children={entry.children} onAdd={addChild} />

          <div className="mt-4">
            <MarkdownEditor
              key={entry.id}
              initialMarkdown={entry.content ?? ""}
              onSave={onSaveContent}
              onSavingChange={setSaving}
            />
          </div>

          <Footer
            createdAt={entry.createdAt}
            savedAt={savedAt}
            saving={saving}
            content={entry.content}
          />
        </div>
      </div>
    </div>
  );
}

function Footer({
  createdAt,
  savedAt,
  saving,
  content,
}: {
  createdAt: Date;
  savedAt: Date | null;
  saving: boolean;
  content: string | null;
}) {
  const status = saving ? "Saving…" : savedAt ? `Saved · ${formatRelative(savedAt)}` : "Saved";
  return (
    <div className="mt-7 flex justify-between items-center text-xs text-muted">
      <span className="inline-flex items-center gap-[5px] text-xs text-muted">
        <i className={saving ? "ri-loader-line" : "ri-check-line"} />
        {status}
      </span>
      <span>
        Created {formatDate(createdAt)} · {wordCount(content)} words
      </span>
    </div>
  );
}
