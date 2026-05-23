import { useEffect, useState } from "react";
import { useParams } from "react-router";

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
import { parseRouteSegment, routeSegment } from "~/lib/route-segment.ts";

export default function LogbookRoute() {
  const params = useParams();
  const logbookId = parseRouteSegment(params.logbookId ?? "");
  const demo = isDemoLogbook(logbookId);

  const { data, isLoading } = useLogbookOverview(logbookId, { demo });
  const createEntry = useCreateEntry({ demo });
  const renameEntry = useRenameEntry({ demo });
  const renameLogbook = useRenameLogbook({ demo });
  const moveEntry = useMoveEntry({ demo });
  const reorderSiblings = useReorderSiblings({ demo });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [scrollTargetId, setScrollTargetId] = useState<number | null>(null);
  const [renamingLogbook, setRenamingLogbook] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
        editingId={editingId}
        scrollTargetId={scrollTargetId}
        onAdd={({ col, parentId }) => {
          createEntry.mutate(
            { logbookId: logbook.id, name: "", col, parentId },
            {
              onSuccess: (entry) => {
                if (entry) {
                  setEditingId(entry.id);
                  setScrollTargetId(entry.id);
                }
              },
            },
          );
        }}
        onRename={(id, name) => {
          const trimmed = name.trim();
          // Find the current entry inside the tree to compare names.
          const current = findInForest(entries, id);
          if (current && trimmed !== current.name) {
            renameEntry.mutate({ id, name: trimmed });
          }
          setEditingId((prev) => (prev === id ? null : prev));
        }}
        onMove={(input) => {
          moveEntry.mutate({ ...input, logbookId: logbook.id });
        }}
        onReorderSiblings={(parentId, ids) => {
          reorderSiblings.mutate({ logbookId: logbook.id, parentId, ids });
        }}
        onScrolled={() => setScrollTargetId(null)}
      />
    </div>
  );
}

function findInForest(
  forest: import("logarithmic-backend/api-types").EntryNode[],
  id: number,
): import("logarithmic-backend/api-types").EntryNode | null {
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
