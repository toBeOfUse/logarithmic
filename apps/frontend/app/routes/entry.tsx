import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useParams } from "react-router";

import type { Metadata } from "logarithmic-backend/api-types";

import { Attributes } from "~/components/Attributes.tsx";
import { MarkdownEditor, type MarkdownEditorHandle } from "~/components/Editor.tsx";
import { TopBar } from "~/components/TopBar.tsx";
import { cn } from "~/lib/cn.ts";
import {
  isDemoLogbook,
  useCreateEntry,
  useEntry,
  useLogbookOverview,
  useRenameEntry,
  useUpdateEntryContent,
  useUpdateEntryMetadata,
} from "~/data/hooks.ts";

/**
 * Minimum time the "Saving…" footer label stays visible after a save kicks
 * off. Without this floor the label would barely flicker for in-memory mutations
 * (which resolve in <1ms), making the indicator feel broken.
 */
const SAVING_INDICATOR_MIN_MS = 400;

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

const titleField =
  "font-sans text-4xl leading-[1.2] tracking-[-0.02em] font-semibold text-primary flex-1 m-0 bg-transparent border-0 outline-none p-0 w-full resize-none overflow-hidden field-sizing-content";

const pagePadding = "px-4 pt-8 pb-14 sm:px-14 sm:pt-10";

export default function EntryRoute() {
  const params = useParams();
  const logbookId = params.logbookId ?? "";
  const entryId = params.entryId ?? "";
  const demo = isDemoLogbook(logbookId);

  const { data: entry, isLoading } = useEntry(entryId, { demo });
  const { data: overview } = useLogbookOverview(logbookId, { demo });

  const updateContent = useUpdateEntryContent({ demo });
  const updateMetadata = useUpdateEntryMetadata({ demo });
  const renameEntry = useRenameEntry({ demo });
  const createEntry = useCreateEntry({ demo });

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [maximized, setMaximized] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [savingFloor, setSavingFloor] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [editingChildId, setEditingChildId] = useState<string | null>(null);

  // Real-saving = any mutation that affects this entry is in flight.
  const mutationPending =
    updateContent.isPending || updateMetadata.isPending || renameEntry.isPending;

  // Combine with a minimum-display floor so brief in-memory mutations still
  // produce a perceptible "Saving…" tick.
  const saving = mutationPending || savingFloor;

  useEffect(() => {
    if (mutationPending) {
      setSavingFloor(true);
      return;
    }
    const t = setTimeout(() => setSavingFloor(false), SAVING_INDICATOR_MIN_MS);
    return () => clearTimeout(t);
  }, [mutationPending]);

  // Title draft counts as unsaved if it differs from the persisted name.
  const titleDirty = titleDraft != null && entry != null && titleDraft !== entry.name;
  const dirty = titleDirty || editorDirty || mutationPending;

  // Block in-app nav and tab close while there are unsaved changes. The
  // browser's `beforeunload` prompt is intentionally generic — Chrome and
  // Firefox ignore custom strings.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return dirty && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (blocker.state === "blocked") {
      const ok = window.confirm("You have unsaved changes. Leave this page?");
      if (ok) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        editorRef.current?.save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (isLoading || !entry || !overview) {
    return (
      <div className={appShell}>
        <TopBar
          logbookId={logbookId}
          logbookName={overview?.logbook.name ?? (isLoading ? "Loading…" : "Logbook")}
          currentName={isLoading ? "Loading…" : "Not found"}
        />
        <div className="flex-1 overflow-y-auto bg-stark">
          <div className={cn("max-w-[720px] mx-auto", pagePadding)}>
            <p className="text-muted">{isLoading ? "Loading entry…" : "Entry not found."}</p>
          </div>
        </div>
      </div>
    );
  }

  const logbook = overview.logbook;
  const ancestors = entry.ancestors;

  const titleValue = titleDraft ?? entry.name;
  const isUntitled = !titleValue;

  const onTitleBlur = () => {
    if (titleDraft != null && titleDraft !== entry.name) {
      renameEntry.mutate({ id: entry.id, name: titleDraft });
    }
    setTitleDraft(null);
  };

  const onSaveContent = (markdown: string) => {
    updateContent.mutate(
      { id: entry.id, content: markdown },
      { onSettled: () => setSavedAt(new Date()) },
    );
  };

  const onMetadataChange = (next: Metadata) => {
    updateMetadata.mutate(
      { id: entry.id, metadata: next },
      { onSettled: () => setSavedAt(new Date()) },
    );
  };

  const addChild = () => {
    createEntry.mutate(
      { logbookId, name: "", col: entry.col - 1, parentId: entry.id },
      {
        onSuccess: (created) => {
          if (created) setEditingChildId(created.id);
        },
      },
    );
  };

  const onSaveChildName = (id: string, name: string) => {
    const trimmed = name.trim();
    const child = entry.children.find((c) => c.id === id);
    if (child && trimmed !== child.name) {
      renameEntry.mutate({ id, name: trimmed });
    }
    setEditingChildId((prev) => (prev === id ? null : prev));
  };

  if (maximized) {
    return (
      <div className={cn(appShell, "bg-stark")}>
        <div className="flex-1 overflow-y-auto bg-stark">
          <div className={cn("max-w-[680px] mx-auto min-h-full flex flex-col", pagePadding)}>
            <div className="flex items-start gap-3 my-4">
              <TitleEditor
                value={titleValue}
                isUntitled={isUntitled}
                onChange={setTitleDraft}
                onBlur={onTitleBlur}
              />
              <button
                type="button"
                className={cn(btn, "mt-1.5 shrink-0")}
                onClick={() => setMaximized(false)}
                title="Exit focus"
              >
                <i className="ri-fullscreen-exit-line" />
                Exit focus
              </button>
            </div>
            <MarkdownEditor
              key={entry.id}
              ref={editorRef}
              initialMarkdown={entry.content ?? ""}
              onSave={onSaveContent}
              onDirtyChange={setEditorDirty}
              className="flex-1 flex flex-col"
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
        <div className={cn("max-w-3xl mx-auto min-h-full flex flex-col", pagePadding)}>
          <div className="flex items-start gap-3">
            <TitleEditor
              value={titleValue}
              isUntitled={isUntitled}
              onChange={setTitleDraft}
              onBlur={onTitleBlur}
            />
            <button
              type="button"
              className={cn(btn, "mt-1.5 shrink-0")}
              onClick={() => setMaximized(true)}
              title="Maximize editor"
            >
              <i className="ri-fullscreen-line" />
              Focus
            </button>
          </div>

          {(() => {
            const hasChildren = entry.children.length > 0;
            const hasAttrs = entry.metadata != null && Object.keys(entry.metadata).length > 0;
            if (!hasChildren && !hasAttrs) {
              return (
                <div className="flex flex-wrap gap-2 items-center my-5">
                  <WithTrailingSep>
                    <AddChildPill onClick={addChild} label="Add nested entry..." />
                  </WithTrailingSep>
                  <Attributes metadata={entry.metadata} onChange={onMetadataChange} bare />
                </div>
              );
            }
            return (
              <div className="space-y-7 my-7">
                <section>
                  {hasAttrs && <SectionHeading>This Entry's Metadata</SectionHeading>}
                  <Attributes metadata={entry.metadata} onChange={onMetadataChange} />
                </section>
                <section>
                  {hasChildren && <SectionHeading>Next Column's Entries</SectionHeading>}
                  <div className="flex flex-wrap gap-2 items-center">
                    {entry.children.map((c) => (
                      <WithTrailingSep key={c.id}>
                        <ChildItem
                          logbookId={logbook.id}
                          id={c.id}
                          name={c.name}
                          isEditing={editingChildId === c.id}
                          onSave={(name) => onSaveChildName(c.id, name)}
                        />
                      </WithTrailingSep>
                    ))}
                    <AddChildPill
                      onClick={addChild}
                      label={hasChildren ? "Add..." : "Add nested entry..."}
                    />
                  </div>
                </section>
              </div>
            );
          })()}

          <div className="flex-1 flex flex-col">
            <MarkdownEditor
              key={entry.id}
              ref={editorRef}
              initialMarkdown={entry.content ?? ""}
              onSave={onSaveContent}
              onDirtyChange={setEditorDirty}
              className="flex-1 flex flex-col"
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

const childLink = "inline-flex items-center text-base text-primary";

function ChildSep() {
  return (
    <span aria-hidden className="text-paper-edge select-none">
      |
    </span>
  );
}

/** Glues a trailing pipe to the item before it so they wrap together — the
 *  pipe stays at the end of the line rather than starting a wrapped one. */
function WithTrailingSep({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      {children}
      <ChildSep />
    </span>
  );
}

function ChildItem({
  logbookId,
  id,
  name,
  isEditing,
  onSave,
}: {
  logbookId: string;
  id: string;
  name: string;
  isEditing: boolean;
  onSave: (name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const wasEditingRef = useRef(isEditing);

  // Focus the input when entering edit mode; focus the link when leaving it
  // (so a second Enter follows the link).
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (wasEditingRef.current) {
      linkRef.current?.focus();
    }
    wasEditingRef.current = isEditing;
  }, [isEditing]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        defaultValue={name}
        placeholder="Untitled entry"
        className={cn(
          childLink,
          "[font:inherit] bg-transparent border-0 outline-none p-0 m-0 placeholder:text-muted field-sizing-content min-w-[10ch]",
        )}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onSave(name);
          }
        }}
      />
    );
  }

  const isUntitled = !name;
  return (
    <Link
      ref={linkRef}
      to={`/${logbookId}/${id}`}
      className={cn(childLink, isUntitled && "text-muted italic")}
    >
      {name || "Untitled entry"}
    </Link>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-medium text-muted uppercase mb-2">{children}</h3>;
}

function AddChildPill({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="gap-1 bg-transparent border-0 p-0 text-sm text-muted whitespace-nowrap cursor-pointer hover:text-primary [font:inherit]"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function TitleEditor({
  value,
  isUntitled,
  onChange,
  onBlur,
}: {
  value: string;
  isUntitled: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Belt-and-suspenders: in browsers without `field-sizing: content`, fall
  // back to manual height syncing on input.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (CSS.supports?.("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={cn(titleField, isUntitled && "text-muted")}
      value={value}
      placeholder="Untitled entry"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
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
    <div className="mt-7 flex justify-between items-center text-sm text-muted">
      <span className="inline-flex items-center gap-1">
        <i className={saving ? "ri-loader-line" : "ri-check-line"} />
        {status}
      </span>
      <span>
        Created {formatDate(createdAt)} · {wordCount(content)} words
      </span>
    </div>
  );
}
