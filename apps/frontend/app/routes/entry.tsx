import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import type { Metadata } from "logarithmic-backend/api-types";

import { Attributes } from "~/components/Attributes.tsx";

import { IconPicker } from "~/components/IconPicker.tsx";
import { RichTextEditor, type EditorHandle } from "~/components/editor/RichTextEditor.tsx";
import { TopBar, type KebabMenuItem } from "~/components/TopBar.tsx";
import { cn } from "~/lib/cn.ts";
import {
  isDemoLogbook,
  useCreateEntry,
  useDeleteEntry,
  useEntry,
  useLogbookOverview,
  useRenameEntry,
  useSetEntryIcon,
  useUpdateEntryContent,
  useUpdateEntryMetadata,
} from "~/data/hooks.ts";
import { parseEntryId, parseRouteSegment, routeSegment } from "~/lib/route-segment.ts";
import { entryDeleteRequest, useConfirmDelete } from "~/lib/use-confirm-delete.tsx";
import { useDocumentTitle } from "~/lib/use-document-title.ts";

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

const appShell =
  "font-sans text-primary text-base leading-normal h-full w-full flex flex-col bg-stark overflow-hidden";

const pagePadding = "px-4 pt-8 pb-8 sm:px-14 sm:pt-10";

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
  const setEntryIcon = useSetEntryIcon({ demo });
  const deleteEntry = useDeleteEntry({ demo });
  const navigate = useNavigate();

  const editorRef = useRef<EditorHandle>(null);
  const [maximized, setMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [savingFloor, setSavingFloor] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pendingChild, setPendingChild] = useState(false);
  // A submitted subsection awaiting the server's id. Creation isn't optimistic,
  // so we hold the typed name to show a loading placeholder in the Subsections
  // list until the server confirms and we can focus the new child's real link.
  const [pendingChildName, setPendingChildName] = useState<string | null>(null);
  const [focusChildId, setFocusChildId] = useState<number | null>(null);
  const { confirm, dialog: deleteDialog } = useConfirmDelete();

  // Real-saving = any mutation that affects this entry is in flight.
  const mutationPending =
    updateContent.isPending ||
    updateMetadata.isPending ||
    renameEntry.isPending ||
    setEntryIcon.isPending;

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

  useDocumentTitle(entry ? entry.name || "Untitled entry" : null);

  // Title draft counts as unsaved if it differs from the persisted name.
  const titleDirty = titleDraft != null && entry != null && titleDraft !== entry.name;
  const dirty = titleDirty || editorDirty || mutationPending;

  // Mirror the browser's fullscreen state so the toggle button shows the right
  // icon — including when the user drops fullscreen with Escape, which doesn't
  // go through our handlers.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // When nothing interactive is focused and the user starts typing, drop them
  // into the editor at the end of its content. The keystroke fired on
  // `document`, not the editor, so we cancel the default and hand the character
  // to the editor to insert so it isn't lost. Interactive elements (inputs,
  // buttons, links, …) are skipped so their own keyboard behavior — Space/Enter
  // to activate, typing into a field — keeps working. (Ctrl/Cmd-S and other
  // editor shortcuts are owned by the editor itself.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing) return; // let IME composition target a real field
      if (e.key.length !== 1) return; // ignore non-printable keys (arrows, etc.)
      const active = document.activeElement as HTMLElement | null;
      const interactive =
        active != null &&
        (active.isContentEditable ||
          active.matches(
            "input, textarea, select, button, a[href], [role='button'], [role='link']",
          ));
      if (interactive) return;
      e.preventDefault();
      editorRef.current?.focusEnd(e.key);
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
          <div className={cn("max-w-reading mx-auto", pagePadding)}>
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
    // An empty/whitespace-only title is never committed: discarding the draft
    // reverts the field to the persisted name. Otherwise commit the trimmed
    // value if it actually changed.
    const trimmed = titleDraft?.trim();
    if (trimmed && trimmed !== entry.name) {
      renameEntry.mutate({ id: entry.id, name: trimmed, logbookId });
    }
    setTitleDraft(null);
  };

  const onSaveContent = (contentJson: string) => {
    updateContent.mutate(
      { id: entry.id, contentJson, logbookId },
      { onSuccess: () => setSavedAt(new Date()) },
    );
  };

  const onMetadataChange = (next: Metadata) => {
    updateMetadata.mutate(
      { id: entry.id, metadata: next, logbookId },
      { onSuccess: () => setSavedAt(new Date()) },
    );
  };

  const onSelectIcon = (iconName: string, iconFamily: string) => {
    setEntryIcon.mutate(
      { id: entry.id, iconName, iconFamily, logbookId },
      { onSuccess: () => setSavedAt(new Date()) },
    );
  };

  // Focus mode also takes the browser fullscreen, like a fullscreen video. The
  // request must run inside the click's user gesture, so we do it here rather
  // than in an effect. Leaving fullscreen via Escape only drops the browser
  // chrome — focus mode (and thus our own X button) stays until explicitly
  // exited, so we never tie `maximized` to `document.fullscreenElement`.
  const enterFocus = () => {
    setMaximized(true);
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  const exitFocus = () => {
    setMaximized(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  const addChild = () => setPendingChild(true);

  const onSubmitPendingChild = (name: string) => {
    setPendingChild(false);
    const trimmed = name.trim();
    if (!trimmed) return;
    setPendingChildName(trimmed);
    createEntry.mutate(
      { logbookId, name: trimmed, col: entry.col - 1, parentId: entry.id },
      {
        // The id only exists now; focus the new child's real link, which also
        // lets a second Enter follow it through to its page.
        onSuccess: (created) => {
          if (created) setFocusChildId(created.id);
        },
        onSettled: () => setPendingChildName(null),
      },
    );
  };

  const menuItems: KebabMenuItem[] = [
    {
      id: "copy-as-markdown",
      label: "Copy as Markdown",
      icon: "ri-file-copy-2-line",
      destructive: false,
      // Convert the live editor content to Markdown via the code-split
      // `@lexical/markdown` bundle (loaded lazily inside the handle) rather
      // than shipping it in the main chunk. See spec/3-frontend.md.
      onSelect: () => {
        void editorRef.current?.getMarkdown().then((md) => {
          void navigator.clipboard.writeText(md);
        });
      },
    },
    {
      id: "delete",
      label: "Delete entry",
      icon: "ri-delete-bin-line",
      destructive: true,
      onSelect: () =>
        confirm({
          ...entryDeleteRequest(entry.name),
          onConfirm: async () => {
            await deleteEntry.mutateAsync({ id: entry.id, logbookId: logbook.id });
            void navigate(`/${routeSegment(logbook.slug, logbook.id)}`, { replace: true });
          },
        }),
    },
  ];

  // Focus mode's unobtrusive top-right controls (used in place of the TopBar).
  const focusControls = (
    <div className="fixed top-3 right-4 z-(--z-menu) flex items-center gap-1">
      <button
        type="button"
        className="h-9 inline-flex items-center justify-center rounded-full bg-transparent border-0 text-muted cursor-pointer transition-colors hover:bg-stark-hover hover:text-primary"
        onClick={exitFocus}
        title="Exit focus"
        aria-label="Exit focus"
      >
        <i className="ri-arrow-go-back-line text-xl" />
      </button>
      <button
        type="button"
        className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-transparent border-0 text-muted cursor-pointer transition-colors hover:bg-stark-hover hover:text-primary"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit full screen" : "Full screen"}
        aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
      >
        <i
          className={cn(isFullscreen ? "ri-fullscreen-exit-line" : "ri-fullscreen-line", "text-xl")}
        />
      </button>
    </div>
  );

  // One layout for both modes so the editor is never unmounted (and its state
  // never lost) when focus mode toggles — only the surrounding chrome changes,
  // and the editor stays at a stable position in the tree.
  return (
    <div className={appShell}>
      {maximized ? (
        focusControls
      ) : (
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
          actions={[
            {
              id: "focus",
              label: "Focus",
              icon: "ri-fullscreen-line",
              title: "Maximize editor",
              onSelect: enterFocus,
            },
          ]}
        />
      )}
      {!maximized && deleteDialog}
      <div
        className={cn(
          "flex-1 overflow-y-auto scrollbar-gutter-stable bg-stark",
          maximized && "[scrollbar-width:thin] [&::-webkit-scrollbar]:w-2",
        )}
      >
        <div className={cn("mx-auto min-h-full flex flex-col max-w-reading", pagePadding)}>
          {maximized ? (
            <div className="my-4">
              <TitleEditor
                value={titleValue}
                isUntitled={isUntitled}
                onChange={setTitleDraft}
                onBlur={onTitleBlur}
              />
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <IconPicker
                iconName={entry.iconName}
                iconFamily={entry.iconFamily}
                onSelect={onSelectIcon}
                buttonClassName="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-md border-0 bg-transparent text-primary text-3xl leading-none cursor-pointer transition-colors hover:bg-stark-hover hover:text-accent"
                defaultIconClassName="opacity-50"
              />
              <TitleEditor
                value={titleValue}
                isUntitled={isUntitled}
                onChange={setTitleDraft}
                onBlur={onTitleBlur}
              />
            </div>
          )}

          {!maximized &&
            (() => {
              const hasChildren = entry.children.length > 0;
              const hasAttrs = entry.metadata != null && Object.keys(entry.metadata).length > 0;
              const creatingChild = pendingChildName != null;
              const showHeadings = hasChildren || hasAttrs || pendingChild || creatingChild;
              if (!showHeadings) {
                return (
                  <div className="text-base leading-relaxed my-5">
                    <AddChildPill onClick={addChild} label="Add subentry..." />
                    <ChildSep />
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
                    {(hasChildren || pendingChild || creatingChild) && (
                      <SectionHeading>Subsections</SectionHeading>
                    )}
                    {/* Children list as bullets. The pending input and loading
                      placeholder slot in as bullets too (a new child taking
                      shape), while the trailing "Add" control sits as a
                      marker-less item — same add semantics as before: typing
                      swaps the Add control for the input, submitting shows the
                      loading placeholder until the real child link replaces it. */}
                    <ul className="list-disc pl-4 space-y-2 marker:text-stark-border text-base text-primary">
                      {entry.children.map((c) => (
                        <li key={c.id}>
                          <ChildItem
                            href={`/${routeSegment(logbook.slug, logbook.id)}/${routeSegment(c.slug, c.id)}`}
                            id={c.id}
                            name={c.name}
                          />
                        </li>
                      ))}
                      {pendingChildName != null && (
                        <li>
                          <PendingChildItem name={pendingChildName} />
                        </li>
                      )}
                      {pendingChild ? (
                        <li>
                          <PendingChildInput
                            onSubmit={onSubmitPendingChild}
                            onCancel={() => setPendingChild(false)}
                          />
                        </li>
                      ) : (
                        <li className="list-none">
                          <AddChildPill
                            onClick={addChild}
                            label={hasChildren ? "Add..." : "Add subentry..."}
                          />
                        </li>
                      )}
                    </ul>
                  </section>
                </div>
              );
            })()}

          <div className="flex-1 flex flex-col">
            <RichTextEditor
              key={entry.id}
              ref={editorRef}
              initialContent={entry.contentJson}
              onSave={onSaveContent}
              onDirtyChange={setEditorDirty}
              className="flex-1 flex flex-col"
            />
          </div>

          {!maximized && (
            <Footer
              createdAt={entry.createdAt}
              savedAt={savedAt}
              saving={saving}
              wordCount={entry.wordCount}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const childLink = "text-base text-primary";

/**
 * Separator between inline subsection items. The leading non-breaking space
 * binds the pipe to the preceding item, and the trailing regular space is the
 * only break opportunity — so the run wraps like text and a pipe never starts a
 * wrapped line.
 */
function ChildSep() {
  return (
    <span aria-hidden className="text-stark-border select-none">
      {" | "}
    </span>
  );
}

function ChildItem({ href, id, name }: { href: string; id: number; name: string }) {
  const isUntitled = !name;
  return (
    <Link
      to={href}
      data-child-anchor={id}
      // Ring keyed off :focus (not :focus-visible) so it shows for the
      // programmatic focus a freshly-created child receives; clicking a link
      // navigates away, so there's no downside to showing it on plain focus.
      className={cn(
        childLink,
        "ml-1 rounded-sm focus:outline-none focus:ring-2 focus:ring-accent",
        isUntitled && "text-muted italic",
      )}
    >
      {name || "Untitled entry"}
    </Link>
  );
}

/**
 * Placeholder for a just-submitted subsection while the server assigns its id.
 * Creation isn't optimistic, so this stands in until the real, focusable child
 * link appears in its place on confirmation.
 */
function PendingChildItem({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1 text-base text-muted align-baseline"
      aria-busy="true"
    >
      <i className="ri-loader-4-line animate-spin self-center" aria-hidden="true" />
      {name || "Untitled entry"}
    </span>
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
      placeholder="New subentry"
      className={cn(
        childLink,
        "bg-transparent border-0 outline-none p-0 m-0 placeholder:text-muted field-sizing-content min-w-[10ch]",
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
      className="gap-1 bg-transparent border-0 p-0 text-md text-muted whitespace-nowrap cursor-pointer hover:text-primary"
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
      className={cn(
        "font-sans text-4xl leading-title tracking-heading font-semibold text-primary " +
          "flex-1 m-0 bg-transparent border-0 outline-none p-0 w-full resize-none overflow-hidden field-sizing-content",
        isUntitled && "text-muted",
      )}
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
  wordCount,
}: {
  createdAt: Date;
  savedAt: Date | null;
  saving: boolean;
  wordCount: number;
}) {
  const status = saving ? "Saving…" : savedAt ? `Saved · ${formatRelative(savedAt)}` : "Saved";
  return (
    <div className="mt-7 flex justify-between items-center text-sm text-muted">
      <span className="inline-flex items-center gap-1">
        <i className={saving ? "ri-loader-line" : "ri-check-line"} />
        {status}
      </span>
      <span>
        Created {formatDate(createdAt)} · {wordCount} words
      </span>
    </div>
  );
}
