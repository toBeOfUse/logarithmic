import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { LogbookSummary } from "logarithmic-backend/api-types";

import { AccessLinkModal } from "~/components/AccessLinkModal.tsx";
import { AddingIndicator } from "~/components/AddingIndicator.tsx";
import { Card } from "~/components/Card.tsx";
import { SpiralLogo } from "~/components/SpiralLogo.tsx";
import { useCreateLogbook, useLogbooks } from "~/data/hooks.ts";
import { buildBookmarkUrl } from "~/data/tokens.ts";
import { cn } from "~/lib/cn.ts";
import { formatCardDate } from "~/lib/format-card-date.ts";
import { routeSegment } from "~/lib/route-segment.ts";
import { useDocumentTitle } from "~/lib/use-document-title.ts";

type PendingShare = { logbookName: string; url: string; nextPath: string };

// The ⊕ mark shown after the title on the "create" cards.
const addMark = <i className="ri-add-circle-line" aria-hidden="true" />;

export default function Splash() {
  const navigate = useNavigate();
  const { data: logbooks = [] } = useLogbooks({ demo: false });
  const { data: demoLogbooks = [] } = useLogbooks({ demo: true });
  const createLogbook = useCreateLogbook();
  // Whether the "Create New" / "Get Started" card is currently an input cell.
  const [creating, setCreating] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);

  useDocumentTitle(null);

  const hasLogbooks = logbooks.length > 0;
  // Most-recently-edited first, per the wireframe annotation.
  const sortedLogbooks = [...logbooks].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  function submitCreate(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    createLogbook.mutate(
      { name: trimmed },
      {
        onSuccess: ({ logbook, token }) => {
          setCreating(false);
          setPendingShare({
            logbookName: logbook.name,
            url: buildBookmarkUrl(routeSegment(logbook.slug, logbook.id), token),
            nextPath: `/${routeSegment(logbook.slug, logbook.id)}`,
          });
        },
        onError: () => setCreating(false),
      },
    );
  }

  function dismissShare() {
    const next = pendingShare?.nextPath ?? null;
    setPendingShare(null);
    if (next) void navigate(next);
  }

  return (
    <div className="font-sans text-primary text-base leading-normal h-full w-full flex flex-col bg-stark overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto box-border flex w-full max-w-4xl flex-col gap-8 px-6 py-12 sm:px-10 sm:py-16">
          {/* Hero: the grayscale spiral mark beside the wordmark, the wordmark set
              over three ruled lines like a title on a fresh logbook page. */}
          <header className="flex items-center gap-4 sm:gap-6">
            <SpiralLogo variant="hero" tone="mono" className="h-18 shrink-0 sm:h-24" />
            <div className="relative flex min-w-0 flex-1 items-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 inset-y-1.5 sm:inset-y-3 flex flex-col justify-between"
              >
                <div className="border-t border-stark-border" />
                <div className="border-t border-dashed border-stark-border" />
                <div className="border-t border-stark-border" />
              </div>
              <h1 className="relative m-0 font-serif text-6xl font-semibold leading-none tracking-heading text-primary sm:text-8xl">
                Logarithmic
              </h1>
            </div>
          </header>

          {/* Value proposition, then the logbooks. */}
          <section className="flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <p className="m-0 text-lg leading-prose text-primary sm:text-xl">
                Logarithmic is a structured writing, planning, and note-taking app.
              </p>
              <p className="m-0 text-sm italic leading-prose text-muted">
                It's like if Notion was more organized, or Linear was less so.
              </p>
            </div>
            <LogbookRow
              hasLogbooks={hasLogbooks}
              logbooks={sortedLogbooks}
              creating={creating}
              busy={createLogbook.isPending}
              onStartCreate={() => setCreating(true)}
              onSubmitCreate={submitCreate}
              onCancelCreate={() => setCreating(false)}
            />
          </section>

          {/* How it works: the explainer boxed on the left, the demos as cards
              on the right. */}
          <section className="grid grid-cols-1 items-start gap-8 sm:grid-cols-2">
            <div className="flex flex-col gap-4 px-2">
              <h2 className="m-0 text-xl font-semibold tracking-heading text-primary sm:text-2xl">
                Snap Your Brain To Grid
              </h2>
              <div className="flex flex-col gap-4 text-base leading-prose text-primary">
                <p className="m-0">
                  This app is built on <strong className="font-semibold">logbooks</strong>, which
                  contain entries in columns.
                </p>
                <p className="m-0">
                  Entries can be whatever you want: they can store a name, they can have content,
                  and they can have subentries.
                </p>
                <p className="m-0">
                  Entries and subentries are automatically organized into columns based on their
                  relationships.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="m-0 text-base font-semibold text-primary">See how it works:</h3>
              {demoLogbooks.map((lb) => (
                <Card
                  key={lb.id}
                  strong
                  href={`/${routeSegment(lb.slug, lb.id)}`}
                  title={lb.name || "Untitled logbook"}
                  meta={`Demo · ${lb.entryCount} ${lb.entryCount === 1 ? "entry" : "entries"}`}
                />
              ))}
              <p className="m-0 text-sm text-primary">
                (Nothing you change in these demos will be saved.)
              </p>
            </div>
          </section>
        </div>
      </div>

      {pendingShare && (
        <AccessLinkModal
          logbookName={pendingShare.logbookName}
          url={pendingShare.url}
          onClose={dismissShare}
        />
      )}
    </div>
  );
}

/**
 * The logbooks: a row of cards (styled like the org-view entry cards) that wraps
 * horizontally, most-recently edited first, ending in the "Create New" card.
 * With no logbooks yet that card reads "Get Started" instead. Either card turns
 * into an input cell when selected, just like naming an entry on the org view.
 */
function LogbookRow({
  hasLogbooks,
  logbooks,
  creating,
  busy,
  onStartCreate,
  onSubmitCreate,
  onCancelCreate,
}: {
  hasLogbooks: boolean;
  logbooks: LogbookSummary[];
  creating: boolean;
  busy: boolean;
  onStartCreate: () => void;
  onSubmitCreate: (name: string) => void;
  onCancelCreate: () => void;
}) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-8">
      {logbooks.map((lb) => (
        <Card
          key={lb.id}
          className="sm:col-span-4"
          strong
          href={`/${routeSegment(lb.slug, lb.id)}`}
          title={lb.name || "Untitled logbook"}
          untitled={!lb.name}
          meta={`Updated ${formatCardDate(lb.updatedAt)} · ${lb.entryCount} ${
            lb.entryCount === 1 ? "entry" : "entries"
          }`}
        />
      ))}
      {creating ? (
        <CreateLogbookCell
          className="sm:col-span-4"
          busy={busy}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      ) : (
        <Card
          className="sm:col-span-4"
          strong
          trailingIcon={addMark}
          title={hasLogbooks ? "Create New" : "Get Started"}
          meta={hasLogbooks ? "Add a new logbook" : "Create your first logbook"}
          onClick={onStartCreate}
          ariaLabel={
            hasLogbooks ? "Create a new logbook" : "Get started by creating your first logbook"
          }
        />
      )}
    </div>
  );
}

/**
 * The "Create New" / "Get Started" card turned into an inline name input —
 * mirroring how naming an entry works on the org view: Enter or blur commits,
 * Escape cancels, a blank value is a no-op. Submission is single-fire so the
 * blur that fires when the input disables mid-create doesn't double-submit.
 */
function CreateLogbookCell({
  busy,
  onSubmit,
  onCancel,
  className,
}: {
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (value: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setSubmittedName(value.trim());
    onSubmit(value);
  };

  // While the create round-trips, show the same "Adding…" placeholder the org
  // view uses for a new entry — the input becomes the logbook-to-be.
  if (busy) {
    return (
      <Card
        busy
        strong
        className={className}
        title={submittedName || "New logbook"}
        untitled={!submittedName}
        meta={<AddingIndicator />}
      />
    );
  }

  return (
    <div
      className={cn(
        "box-border flex min-h-card-min w-full items-start rounded-none border border-primary bg-stark px-card-x py-card-y",
        className,
      )}
    >
      <input
        ref={inputRef}
        defaultValue=""
        placeholder="New logbook…"
        disabled={busy}
        className="m-0 w-full border-0 bg-transparent p-0 text-card-title font-card-title-strong text-primary outline-none placeholder:font-normal placeholder:text-muted disabled:opacity-60"
        onBlur={(e) => submit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (settledRef.current) return;
            settledRef.current = true;
            onCancel();
          }
        }}
      />
    </div>
  );
}
