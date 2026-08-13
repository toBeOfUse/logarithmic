import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AccessLinkModal } from "~/components/AccessLinkModal";

import { OrgView } from "~/components/OrgView.tsx";
import type { AddInput, PendingCreate, PendingInput } from "~/components/OrgView.tsx";
import { TopBar, type KebabMenuItem } from "~/components/TopBar.tsx";
import {
  isDemoLogbook,
  useCreateEntry,
  useDeleteEntry,
  useDeleteLogbook,
  useLogbookOverview,
  useMoveEntry,
  usePrefetchEntries,
  useRenameEntry,
  useRenameLogbook,
  useSetEntryIcon,
  useSetLogbookColumns,
} from "~/data/hooks.ts";
import type { ColumnSetting, EntryNode, MoveEntryInput } from "logarithmic-backend/api-types";
import { buildBookmarkUrl, getToken } from "~/data/tokens";
import { parseRouteSegment, routeSegment } from "~/lib/route-segment.ts";
import { entryDeleteRequest, useConfirmDelete } from "~/lib/use-confirm-delete.tsx";
import { useDocumentTitle } from "~/lib/use-document-title.ts";

/**
 * The org chart scrolls the DOCUMENT, not a box inside it — that's the only
 * scroller a mobile browser will dismiss its address bar for. So the page grows
 * past the viewport (`min-h-full`, no `overflow-hidden`) and the top bar floats
 * over it, with `pt-top-bar` holding its space open in the flow.
 */
const pageClass =
  "font-sans text-primary text-base leading-normal min-h-full w-full flex flex-col bg-stark pt-top-bar";

export default function LogbookRoute() {
  const params = useParams();
  const logbookId = parseRouteSegment(params.logbookId ?? "");
  const demo = isDemoLogbook(logbookId);

  const { data, isLoading } = useLogbookOverview(logbookId, { demo });
  // Warm every entry's detail cache up front so opening one from the org view
  // paints instantly (then revalidates). Fire-and-forget — the org view renders
  // off the overview, not this.
  usePrefetchEntries(logbookId, { demo });
  const createEntry = useCreateEntry({ demo });
  const renameEntry = useRenameEntry({ demo });
  const renameLogbook = useRenameLogbook({ demo });
  const moveEntry = useMoveEntry({ demo });
  const setEntryIcon = useSetEntryIcon({ demo });
  const setLogbookColumns = useSetLogbookColumns({ demo });
  const deleteEntry = useDeleteEntry({ demo });
  const deleteLogbook = useDeleteLogbook();
  const navigate = useNavigate();
  const { confirm, dialog: deleteDialog } = useConfirmDelete();

  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  // A submitted new entry awaiting the server's id. Entry creation isn't
  // optimistic, so we hold the typed name here to render a loading placeholder
  // in its slot until the server confirms and we can focus its real link.
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [focusEntryId, setFocusEntryId] = useState<number | null>(null);
  const [renamingLogbook, setRenamingLogbook] = useState(false);
  // Whether the org view's column-edit mode is on. Lives here because the toggle
  // is a top-bar action ("Edit Columns" / "Save Columns") while the editable
  // headers render inside OrgView.
  const [editingColumns, setEditingColumns] = useState(false);
  const [displayingAccessLink, setDisplayingAccessLink] = useState(false);

  useDocumentTitle(data ? data.logbook.name : null);

  // Stable handlers so the memoized OrgView subtree can skip re-rendering on
  // route renders that don't touch the chart (export state, modals, focus).
  const handleAdd = useCallback(
    (input: AddInput) => setPendingInput({ kind: "add", ...input }),
    [],
  );
  const handleRename = useCallback(
    (id: number) => setPendingInput({ kind: "rename", entryId: id }),
    [],
  );
  const handleDelete = useCallback(
    (id: number) => {
      if (!data) return;
      const node = findInForest(data.entries, id);
      confirm({
        ...entryDeleteRequest(node?.name ?? ""),
        onConfirm: () => deleteEntry.mutateAsync({ id, logbookId: data.logbook.id }),
      });
    },
    [data, deleteEntry, confirm],
  );
  const handleSetIcon = useCallback(
    (id: number, iconName: string, iconFamily: string) => {
      if (!data) return;
      setEntryIcon.mutate({ id, iconName, iconFamily, logbookId: data.logbook.id });
    },
    [data, setEntryIcon],
  );
  const handlePersistColumns = useCallback(
    (columns: ColumnSetting[]) => {
      if (!data) return;
      setLogbookColumns.mutate({ logbookId: data.logbook.id, columns });
    },
    [data, setLogbookColumns],
  );
  const handleSubmitPending = useCallback(
    (name: string, icon: { iconName: string; iconFamily: string } | null) => {
      const input = pendingInput;
      setPendingInput(null);
      if (!input || !data) return;
      const trimmed = name.trim();
      if (input.kind === "add") {
        if (!trimmed) return;
        const iconName = icon?.iconName ?? null;
        const iconFamily = icon?.iconFamily ?? null;
        setPendingCreate({
          col: input.col,
          parentId: input.parentId,
          name: trimmed,
          iconName,
          iconFamily,
        });
        createEntry.mutate(
          {
            logbookId: data.logbook.id,
            name: trimmed,
            col: input.col,
            parentId: input.parentId,
            iconName,
            iconFamily,
          },
          {
            // The id only exists now; focus the new entry's real link, which
            // also lets a second Enter follow it through to its page.
            onSuccess: (entry) => {
              if (entry) setFocusEntryId(entry.id);
            },
            onSettled: () => setPendingCreate(null),
          },
        );
        return;
      }
      // Rename: empty input (or same name) cancels; otherwise commit.
      const current = findInForest(data.entries, input.entryId);
      if (trimmed && current && trimmed !== current.name) {
        renameEntry.mutate({ id: input.entryId, name: trimmed, logbookId: data.logbook.id });
      }
      setFocusEntryId(input.entryId);
    },
    [pendingInput, data, createEntry, renameEntry],
  );
  const handleCancelPending = useCallback(() => {
    if (pendingInput?.kind === "rename") setFocusEntryId(pendingInput.entryId);
    setPendingInput(null);
  }, [pendingInput]);
  const handleMove = useCallback((input: MoveEntryInput) => moveEntry.mutate(input), [moveEntry]);
  const handleFocused = useCallback(() => setFocusEntryId(null), []);

  if (isLoading || !data) {
    return (
      <div className={pageClass}>
        <TopBar
          logbookSegment={params.logbookId ?? ""}
          logbookName={isLoading ? "Loading…" : "Not found"}
        />
        <div className="flex-1 flex flex-col bg-stark">
          <div className="flex flex-col items-center justify-center flex-1 text-muted gap-3.5 py-[60px] px-10 text-center">
            <p className="text-base text-muted m-0">
              {isLoading ? "Loading logbook…" : "This logbook could not be found."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { logbook, entries } = data;

  // Column-edit mode is entered from the kebab ("Edit Columns") and saved with a
  // single-click action button beside the kebab ("Save Columns") that only shows
  // while editing.
  const topBarActions: KebabMenuItem[] = editingColumns
    ? [
        {
          id: "save-columns",
          label: "Save Columns",
          icon: "ri-save-line",
          onSelect: () => setEditingColumns(false),
        },
      ]
    : [];

  const menuItems: KebabMenuItem[] = [];
  if (!editingColumns) {
    menuItems.push({
      id: "edit-columns",
      label: "Edit Columns",
      icon: "ri-layout-column-line",
      onSelect: () => setEditingColumns(true),
    });
  }
  menuItems.push(
    {
      id: "rename",
      label: "Rename logbook",
      icon: "ri-edit-line",
      onSelect: () => setRenamingLogbook(true),
    },
    {
      id: "access-link",
      icon: "ri-key-2-line",
      label: "View access link",
      onSelect: () => setDisplayingAccessLink(true),
    },
  );
  if (!demo) {
    // Demo logbooks aren't persisted server-side and have no token to revoke,
    // so deletion only applies to real logbooks (like export above).
    menuItems.push({
      id: "delete-logbook",
      label: "Delete logbook",
      icon: "ri-delete-bin-line",
      destructive: true,
      onSelect: () =>
        confirm({
          title: "Delete logbook?",
          body: (
            <>
              <span className="text-primary font-medium">"{logbook.name}"</span> and all of its
              entries will be permanently deleted. This cannot be undone.
            </>
          ),
          onConfirm: async () => {
            await deleteLogbook.mutateAsync({ logbookId: logbook.id });
            void navigate("/", { replace: true });
          },
        }),
    });
  }

  return (
    <div className={pageClass}>
      <TopBar
        logbookSegment={routeSegment(logbook.slug, logbook.id)}
        logbookName={logbook.name}
        actions={topBarActions}
        menuItems={menuItems}
      />
      {renamingLogbook && (
        <RenameLogbookModal
          currentName={logbook.name}
          busy={renameLogbook.isPending}
          onCancel={() => setRenamingLogbook(false)}
          onSubmit={(newName) => {
            renameLogbook.mutate(
              { logbookId: logbook.id, name: newName },
              { onSuccess: () => setRenamingLogbook(false) },
            );
          }}
        />
      )}
      {displayingAccessLink && data.logbook && (
        <AccessLinkModal
          onClose={() => setDisplayingAccessLink(false)}
          logbookName={data.logbook.name}
          url={buildBookmarkUrl(
            routeSegment(data.logbook.slug, data.logbook.id),
            getToken(data.logbook.id)!,
          )}
        />
      )}

      <OrgView
        forest={entries}
        logbookId={logbook.id}
        logbookSlug={logbook.slug}
        columns={logbook.columns}
        editingColumns={editingColumns}
        onSaveColumns={() => setEditingColumns(false)}
        onPersistColumns={handlePersistColumns}
        pendingInput={pendingInput}
        pendingCreate={pendingCreate}
        focusEntryId={focusEntryId}
        onAdd={handleAdd}
        onRename={handleRename}
        onDelete={handleDelete}
        onSetIcon={handleSetIcon}
        onSubmitPending={handleSubmitPending}
        onCancelPending={handleCancelPending}
        onMove={handleMove}
        onFocused={handleFocused}
      />
      {deleteDialog}
    </div>
  );
}

function findInForest(forest: EntryNode[], id: number): EntryNode | null {
  for (const node of forest) {
    if (node.id === id) return node;
    const inChild = findInForest(node.children, id);
    if (inChild) return inChild;
  }
  return null;
}

function RenameLogbookModal({
  currentName,
  busy,
  onCancel,
  onSubmit,
}: {
  currentName: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(currentName);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, busy]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !busy;

  return (
    <div
      className="fixed inset-0 z-(--z-modal) bg-scrim flex items-center justify-center p-6"
      onClick={() => !busy && onCancel()}
    >
      <form
        className="w-full max-w-md bg-stark border border-stark-border rounded-lg shadow-2xl p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-logbook-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(trimmed);
        }}
      >
        <h3 id="rename-logbook-title" className="m-0 mb-2 text-xl font-semibold text-primary">
          Rename logbook
        </h3>
        <p className="m-0 mb-4 text-muted">Give this logbook a new name.</p>
        <input
          autoFocus
          type="text"
          className="w-full text-base border border-stark-border bg-stark text-primary rounded-[7px] px-3 py-2 outline-none placeholder:text-muted focus:border-accent focus:shadow-focus"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          placeholder="Logbook name"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-stark-border bg-stark text-primary cursor-pointer transition-colors duration-120 hover:bg-stark-hover disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-primary bg-primary text-stark cursor-pointer transition-colors duration-120 hover:bg-primary-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
