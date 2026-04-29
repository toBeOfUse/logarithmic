import { useNavigate, useParams } from "react-router";

import { OrgView } from "~/components/OrgView.tsx";
import { TopBar } from "~/components/TopBar.tsx";
import { isDemoLogbook, useCreateEntry, useLogbookOverview } from "~/data/hooks.ts";

export default function LogbookRoute() {
  const params = useParams();
  const logbookId = params.logbookId ?? "";
  const demo = isDemoLogbook(logbookId);
  const navigate = useNavigate();

  const { data, isLoading } = useLogbookOverview(logbookId, { demo });
  const createEntry = useCreateEntry({ demo });

  if (isLoading || !data) {
    return (
      <div className="font-sans text-ink text-[13px] leading-[1.5] [font-feature-settings:'ss01','cv11'] h-full w-full flex flex-col bg-stark overflow-hidden">
        <TopBar
          variant="paper"
          logbookId={logbookId}
          logbookName={isLoading ? "Loading…" : "Not found"}
        />
        <div className="flex-1 flex flex-col overflow-hidden bg-paper">
          <div className="flex flex-col items-center justify-center h-full text-ink-3 gap-3.5 py-[60px] px-10 text-center">
            <p className="text-[13px] text-ink-3 m-0">
              {isLoading ? "Loading logbook…" : "This logbook could not be found."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { logbook, entries } = data;

  return (
    <div className="font-sans text-ink text-[13px] leading-[1.5] [font-feature-settings:'ss01','cv11'] h-full w-full flex flex-col bg-stark overflow-hidden">
      <TopBar variant="paper" logbookId={logbook.id} logbookName={logbook.name} />
      <OrgView
        entries={entries}
        logbookId={logbook.id}
        onAdd={({ col, parentId }) => {
          createEntry.mutate(
            { logbookId: logbook.id, name: "", col, parentId: parentId ?? null },
            {
              onSuccess: (entry) => {
                if (entry) void navigate(`/${logbook.id}/${entry.id}`);
              },
            },
          );
        }}
      />
    </div>
  );
}
