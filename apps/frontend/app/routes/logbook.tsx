import { useState } from "react";
import { useParams } from "react-router";

import { OrgView } from "~/components/OrgView.tsx";
import { TopBar } from "~/components/TopBar.tsx";
import {
  isDemoLogbook,
  useCreateEntry,
  useLogbookOverview,
  useMoveEntry,
  useRenameEntry,
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
  const moveEntry = useMoveEntry({ demo });
  const reorderSiblings = useReorderSiblings({ demo });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [scrollTargetId, setScrollTargetId] = useState<number | null>(null);

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

  return (
    <div className="font-sans text-primary text-base leading-normal h-full w-full flex flex-col bg-stark overflow-hidden">
      <TopBar
        variant="paper"
        logbookSegment={routeSegment(logbook.slug, logbook.id)}
        logbookName={logbook.name}
      />
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
