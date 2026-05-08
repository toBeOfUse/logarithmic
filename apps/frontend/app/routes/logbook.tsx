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

export default function LogbookRoute() {
  const params = useParams();
  const logbookId = params.logbookId ?? "";
  const demo = isDemoLogbook(logbookId);

  const { data, isLoading } = useLogbookOverview(logbookId, { demo });
  const createEntry = useCreateEntry({ demo });
  const renameEntry = useRenameEntry({ demo });
  const moveEntry = useMoveEntry({ demo });
  const reorderSiblings = useReorderSiblings({ demo });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="font-sans text-primary text-base leading-[1.5] h-full w-full flex flex-col bg-stark overflow-hidden">
        <TopBar
          variant="paper"
          logbookId={logbookId}
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
    <div className="font-sans text-primary text-base leading-[1.5] h-full w-full flex flex-col bg-stark overflow-hidden">
      <TopBar variant="paper" logbookId={logbook.id} logbookName={logbook.name} />
      <OrgView
        entries={entries}
        logbookId={logbook.id}
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
          const current = entries.find((e) => e.id === id);
          if (current && trimmed !== current.name) {
            renameEntry.mutate({ id, name: trimmed });
          }
          setEditingId((prev) => (prev === id ? null : prev));
        }}
        onMove={(id, target) => {
          moveEntry.mutate({ id, logbookId: logbook.id, target });
        }}
        onReorderSiblings={(parentId, ids) => {
          reorderSiblings.mutate({ logbookId: logbook.id, parentId, ids });
        }}
        onScrolled={() => setScrollTargetId(null)}
      />
    </div>
  );
}
