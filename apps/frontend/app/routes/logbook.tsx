import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { AccessLinkModal } from "~/components/AccessLinkModal";

import { OrgView } from "~/components/OrgView.tsx";
import { TopBar, type KebabMenuItem } from "~/components/TopBar.tsx";
import {
  exportLogbookToFile,
  isDemoLogbook,
  useCreateEntry,
  useLogbookOverview,
  useMoveEntry,
  useRenameEntry,
  useRenameLogbook,
  useReorderSiblings,
} from "~/data/hooks.ts";
import type { EntryNode } from "logarithmic-backend/api-types";
import { buildBookmarkUrl, getToken } from "~/data/tokens";
import { parseRouteSegment, routeSegment } from "~/lib/route-segment.ts";
import { useDocumentTitle } from "~/lib/use-document-title.ts";

export default function LogbookRoute() {
  const params = useParams();
  const logbookId = parseRouteSegment(params.logbookId ?? "");
  const demo = isDemoLogbook(logbookId);

  const { data, isLoading } = useLogbookOverview(logbookId, { demo });
  const createEntry = useCreateEntry({ demo });
  const renameEntry = useRenameEntry({ demo });
  const renameLogbook = useRenameLogbook({ demo });
  const reorderSiblings = useReorderSiblings({ demo });
  const moveEntry = useMoveEntry({ demo });

  type PendingInput =
    | { kind: "add"; col: number; parentId: number | null }
    | { kind: "rename"; entryId: number };
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  // A submitted new entry awaiting the server's id. Entry creation isn't
  // optimistic, so we hold the typed name here to render a loading placeholder
  // in its slot until the server confirms and we can focus its real link.
  const [pendingCreate, setPendingCreate] = useState<{
    col: number;
    parentId: number | null;
    name: string;
  } | null>(null);
  const [focusEntryId, setFocusEntryId] = useState<number | null>(null);
  const [renamingLogbook, setRenamingLogbook] = useState(false);
  const [displayingAccessLink, setDisplayingAccessLink] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useDocumentTitle(data ? `${data.logbook.name} [Logbook]` : null);

  if (isLoading || !data) {
    return (
      <div className="font-sans text-primary text-base leading-normal h-full w-full flex flex-col bg-stark overflow-hidden">
        <TopBar
          variant="paper"
          logbookSegment={params.logbookId ?? ""}
          logbookName={isLoading ? "Loading…" : "Not found"}
        />
        <div className="flex-1 flex flex-col overflow-hidden bg-paper">
          <div className="flex flex-col items-center justify-center h-full text-muted gap-3.5 py-[60px] px-10 text-center">
            <p className="text-base text-muted m-0">
              {isLoading ? "Loading logbook…" : "This logbook could not be found."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { logbook, entries } = data;

  const menuItems: KebabMenuItem[] = [
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
  ];
  if (!demo) {
    menuItems.push({
      id: "export",
      label: exporting ? "Exporting…" : "Export as ZIP",
      icon: "ri-download-2-line",
      onSelect: () => {
        if (exporting) return;
        setExporting(true);
        setExportError(null);
        exportLogbookToFile(logbook.id, `${logbook.slug || "logbook"}.zip`)
          .catch((err: unknown) => {
            setExportError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => setExporting(false));
      },
    });
  }

  return (
    <div className="font-sans text-primary text-base leading-normal h-full w-full flex flex-col bg-stark overflow-hidden">
      <TopBar
        variant="paper"
        logbookSegment={routeSegment(logbook.slug, logbook.id)}
        logbookName={logbook.name}
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
      {exportError && (
        <div className="bg-warn-soft text-warn text-sm px-4 py-2 border-b border-paper-edge flex items-center justify-between">
          <span>Couldn't export logbook: {exportError}</span>
          <button
            type="button"
            className="text-warn underline cursor-pointer bg-transparent border-0 [font:inherit]"
            onClick={() => setExportError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <OrgView
        forest={entries}
        logbookId={logbook.id}
        logbookSlug={logbook.slug}
        pendingInput={pendingInput}
        pendingCreate={pendingCreate}
        focusEntryId={focusEntryId}
        onAdd={(input) => setPendingInput({ kind: "add", ...input })}
        onRename={(id) => setPendingInput({ kind: "rename", entryId: id })}
        onSubmitPending={(name) => {
          const input = pendingInput;
          setPendingInput(null);
          if (!input) return;
          const trimmed = name.trim();
          if (input.kind === "add") {
            if (!trimmed) return;
            setPendingCreate({ col: input.col, parentId: input.parentId, name: trimmed });
            createEntry.mutate(
              { logbookId: logbook.id, name: trimmed, col: input.col, parentId: input.parentId },
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
          const current = findInForest(entries, input.entryId);
          if (trimmed && current && trimmed !== current.name) {
            renameEntry.mutate({ id: input.entryId, name: trimmed, logbookId: logbook.id });
          }
          setFocusEntryId(input.entryId);
        }}
        onCancelPending={() => {
          if (pendingInput?.kind === "rename") setFocusEntryId(pendingInput.entryId);
          setPendingInput(null);
        }}
        onMove={(input) => moveEntry.mutate(input)}
        onReorderSiblings={(parentId, ids) => {
          reorderSiblings.mutate({ logbookId: logbook.id, parentId, ids });
        }}
        onFocused={() => setFocusEntryId(null)}
      />
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
      className="fixed inset-0 z-[100] bg-primary/30 flex items-center justify-center p-6"
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
        <p className="m-0 mb-4 text-muted">
          Give this logbook a new name. The URL slug will update automatically.
        </p>
        <input
          autoFocus
          type="text"
          className="w-full [font:inherit] text-base border border-paper-edge bg-paper text-primary rounded-[7px] px-3 py-2 outline-none placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          placeholder="Logbook name"
        />
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
            type="submit"
            disabled={!canSubmit}
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-primary bg-primary text-paper cursor-pointer transition-colors duration-[120ms] hover:bg-primary-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
