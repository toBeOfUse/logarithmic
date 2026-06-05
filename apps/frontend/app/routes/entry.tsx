import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import type { Metadata } from "logarithmic-backend/api-types";

import { Attributes } from "~/components/Attributes.tsx";
import { MarkdownEditor, type MarkdownEditorHandle } from "~/components/Editor.tsx";
import { TopBar, type KebabMenuItem } from "~/components/TopBar.tsx";
import { cn } from "~/lib/cn.ts";
import {
  isDemoLogbook,
  useCreateEntry,
  useDeleteEntry,
  useEntry,
  useLogbookOverview,
  useRenameEntry,
  useUpdateEntryContent,
  useUpdateEntryMetadata,
} from "~/data/hooks.ts";
import { parseEntryId, parseRouteSegment, routeSegment } from "~/lib/route-segment.ts";

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
  const logbookSegment = params.logbookId ?? "";
  const logbookId = parseRouteSegment(logbookSegment);
  const entryId = parseEntryId(params.entryId ?? "");
  const demo = isDemoLogbook(logbookId);

  const { data: entry, isLoading } = useEntry(entryId, logbookId, { demo });
  const { data: overview } = useLogbookOverview(logbookId, { demo });

  const updateContent = useUpdateEntryContent({ demo });
  const updateMetadata = useUpdateEntryMetadata({ demo });
  const renameEntry = useRenameEntry({ demo });
  const createEntry = useCreateEntry({ demo });
  const deleteEntry = useDeleteEntry({ demo });
  const navigate = useNavigate();

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [maximized, setMaximized] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [savingFloor, setSavingFloor] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pendingChild, setPendingChild] = useState(false);
  const [focusChildId, setFocusChildId] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  // Seed `savedAt` from the entry's persisted `updatedAt` so the footer reads
  // "Saved · 2 days ago" on initial load instead of just "Saved". Re-seed when
  // the route navigates to a different entry; user-driven saves overwrite this
  // via the mutation `onSuccess` handlers.
  useEffect(() => {
    if (entry) setSavedAt(entry.updatedAt);
  }, [entry?.id]);

  // Title draft counts as unsaved if it differs from the persisted name.
  const titleDirty = titleDraft != null && entry != null && titleDraft !== entry.name;
  const dirty = titleDirty || editorDirty || mutationPending;

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

  // Warn only on genuine app-exit (tab close, refresh, leaving the SPA), where
  // an in-flight save would be aborted and unsaved edits truly lost. In-app
  // navigation is intentionally not guarded — the editor flushes pending edits
  // on unmount and the resulting mutation finishes in the background. The
  // browser prompt is generic; Chrome and Firefox ignore custom strings.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Focus a freshly-created subsection's link once it appears so a second
  // Enter follows it through to that child's page.
  useEffect(() => {
    if (focusChildId === null) return;
    const link = document.querySelector<HTMLAnchorElement>(`[data-child-anchor="${focusChildId}"]`);
    if (!link) return;
    link.focus();
    link.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setFocusChildId(null);
  }, [focusChildId, entry?.children]);

  if (isLoading || !entry || !overview) {
    return (
      <div className={appShell}>
        <TopBar
          logbookSegment={logbookSegment}
          logbookName={overview?.logbook.name ?? (isLoading ? "Loading…" : "Logbook")}
          currentName={isLoading ? "Loading…" : "Not found"}
        />
        <div className="flex-1 overflow-y-auto scrollbar-gutter-stable bg-stark">
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
      renameEntry.mutate({ id: entry.id, name: titleDraft, logbookId });
    }
    setTitleDraft(null);
  };

  const onSaveContent = (markdown: string) => {
    updateContent.mutate(
      { id: entry.id, content: markdown, logbookId },
      { onSuccess: () => setSavedAt(new Date()) },
    );
  };

  const onMetadataChange = (next: Metadata) => {
    updateMetadata.mutate(
      { id: entry.id, metadata: next, logbookId },
      { onSuccess: () => setSavedAt(new Date()) },
    );
  };

  const addChild = () => setPendingChild(true);

  const onSubmitPendingChild = (name: string) => {
    setPendingChild(false);
    const trimmed = name.trim();
    if (!trimmed) return;
    createEntry.mutate(
      { logbookId, name: trimmed, col: entry.col - 1, parentId: entry.id },
      {
        onSuccess: (created) => {
          if (created) setFocusChildId(created.id);
        },
      },
    );
  };

  const menuItems: KebabMenuItem[] = [
    {
      id: "copy-as-markdown",
      label: "Copy as Markdown",
      icon: "ri-file-copy-2-line",
      destructive: false,
      onSelect: () => {
        void navigator.clipboard.writeText(entry.content ?? "");
      },
    },
    {
      id: "delete",
      label: "Delete entry",
      icon: "ri-delete-bin-line",
      destructive: true,
      onSelect: () => setConfirmingDelete(true),
    },
  ];

  const confirmDelete = () => {
    deleteEntry.mutate(
      { id: entry.id, logbookId: logbook.id },
      {
        onSuccess: () => {
          setConfirmingDelete(false);
          void navigate(`/${routeSegment(logbook.slug, logbook.id)}`, { replace: true });
        },
      },
    );
  };

  if (maximized) {
    return (
      <div className={cn(appShell, "bg-stark")}>
        <div className="flex-1 overflow-y-auto scrollbar-gutter-stable bg-stark">
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
        logbookSegment={routeSegment(logbook.slug, logbook.id)}
        logbookName={logbook.name}
        parents={ancestors.map((a) => ({
          id: a.id,
          name: a.name,
          href: `/${routeSegment(logbook.slug, logbook.id)}/${routeSegment(a.slug, a.id)}`,
        }))}
        currentName={entry.name || "Untitled entry"}
        menuItems={menuItems}
      />
      {confirmingDelete && (
        <DeleteConfirmModal
          entryName={entry.name}
          busy={deleteEntry.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={confirmDelete}
        />
      )}
      <div className="flex-1 overflow-y-auto scrollbar-gutter-stable bg-stark">
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
            const showHeadings = hasChildren || hasAttrs || pendingChild;
            if (!showHeadings) {
              return (
                <div className="flex flex-wrap gap-2 items-center my-5">
                  <WithTrailingSep>
                    <AddChildPill onClick={addChild} label="Add subsection..." />
                  </WithTrailingSep>
                  <Attributes metadata={entry.metadata} onChange={onMetadataChange} bare />
                </div>
              );
            }
            return (
              <div className="space-y-7 my-7">
                <section>
                  {hasAttrs && <SectionHeading>Metadata</SectionHeading>}
                  <Attributes metadata={entry.metadata} onChange={onMetadataChange} />
                </section>
                <section>
                  {(hasChildren || pendingChild) && <SectionHeading>Subsections</SectionHeading>}
                  <div className="flex flex-wrap gap-2 items-center">
                    {entry.children.map((c) => (
                      <WithTrailingSep key={c.id}>
                        <ChildItem
                          href={`/${routeSegment(logbook.slug, logbook.id)}/${routeSegment(c.slug, c.id)}`}
                          id={c.id}
                          name={c.name}
                        />
                      </WithTrailingSep>
                    ))}
                    {pendingChild && (
                      <WithTrailingSep>
                        <PendingChildInput
                          onSubmit={onSubmitPendingChild}
                          onCancel={() => setPendingChild(false)}
                        />
                      </WithTrailingSep>
                    )}
                    {!pendingChild && (
                      <AddChildPill
                        onClick={addChild}
                        label={hasChildren ? "Add..." : "Add subsection..."}
                      />
                    )}
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

function ChildItem({ href, id, name }: { href: string; id: number; name: string }) {
  const isUntitled = !name;
  return (
    <Link
      to={href}
      data-child-anchor={id}
      className={cn(childLink, isUntitled && "text-muted italic")}
    >
      {name || "Untitled entry"}
    </Link>
  );
}

/**
 * Inline input for naming a new subsection. Blur and Enter submit the value;
 * a non-whitespace name commits to a real entry, anything else discards the
 * input cell without creating one. Escape always discards.
 */
function PendingChildInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  return (
    <input
      ref={inputRef}
      defaultValue=""
      placeholder="New subsection"
      className={cn(
        childLink,
        "[font:inherit] bg-transparent border-0 outline-none p-0 m-0 placeholder:text-muted field-sizing-content min-w-[10ch]",
      )}
      onBlur={(e) => {
        if (settledRef.current) return;
        settledRef.current = true;
        onSubmit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (settledRef.current) return;
          settledRef.current = true;
          onSubmit(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (settledRef.current) return;
          settledRef.current = true;
          onCancel();
        }
      }}
    />
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

function DeleteConfirmModal({
  entryName,
  busy,
  onCancel,
  onConfirm,
}: {
  entryName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, busy]);

  const label = entryName || "this untitled entry";

  return (
    <div
      className="fixed inset-0 z-[100] bg-primary/30 flex items-center justify-center p-6"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-md bg-stark border border-stark-border rounded-lg shadow-2xl p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-entry-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="delete-entry-title" className="m-0 mb-2 text-xl font-semibold text-primary">
          Delete entry?
        </h3>
        <p className="m-0 mb-4 text-muted">
          {entryName ? (
            <>
              <span className="text-primary font-medium">"{label}"</span> and all of its descendants
              will be permanently deleted. This cannot be undone.
            </>
          ) : (
            <>
              This entry and all of its descendants will be permanently deleted. This cannot be
              undone.
            </>
          )}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-stark-border bg-stark text-primary cursor-pointer transition-colors duration-[120ms] hover:bg-stark-soft disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-warn bg-warn text-stark cursor-pointer transition-colors duration-[120ms] hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={onConfirm}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
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
