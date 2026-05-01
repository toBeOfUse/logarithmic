import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { AppMark } from "~/components/AppMark.tsx";
import { useCreateLogbook, useLogbooks } from "~/data/hooks.ts";

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const btnPrimary =
  "[font:inherit] text-[12.5px] font-medium bg-ink border border-ink text-paper px-[11px] py-[6px] rounded-[6px] cursor-pointer inline-flex items-center gap-[6px] transition-colors hover:bg-ink-hover disabled:opacity-[0.55] disabled:cursor-not-allowed";

export default function Splash() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const { data: logbooks = [], isLoading } = useLogbooks({ demo: false });
  const { data: demoLogbooks = [] } = useLogbooks({ demo: true });
  const createLogbook = useCreateLogbook({ demo: false });

  const hasLogbooks = logbooks.length > 0;
  const hasDemos = demoLogbooks.length > 0;

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createLogbook.mutate(
      { name: trimmed },
      {
        onSuccess: (lb) => {
          setName("");
          void navigate(`/${lb.id}`);
        },
      },
    );
  }

  return (
    <div className="font-sans text-ink text-[13px] leading-[1.5] [font-feature-settings:'ss01','cv11'] h-full w-full flex flex-col bg-stark overflow-hidden">
      <div className="flex-1 flex flex-col bg-paper splash-bg relative overflow-auto">
        <div className="max-w-[560px] w-full mx-auto px-12 pt-24 pb-16 relative z-[1] flex-1 flex flex-col box-border">
          <AppMark size="lg" />

          {hasLogbooks ? (
            <>
              <h1 className="font-serif font-normal text-[44px] leading-[1.1] tracking-[-0.02em] m-0 mb-3 text-ink">
                Welcome <em className="italic text-accent-ink">back</em>.
              </h1>
              <p className="text-[15px] leading-[1.55] text-ink-2 max-w-[460px] m-0 mb-9">
                Pick a logbook to open, or start a new one.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-serif font-normal text-[44px] leading-[1.1] tracking-[-0.02em] m-0 mb-3 text-ink">
                A logbook for goals,
                <br /> projects, and <em className="italic text-accent-ink">fleeting thoughts</em>.
              </h1>
              <p className="text-[15px] leading-[1.55] text-ink-2 max-w-[460px] m-0 mb-9">
                Trees of entries, organized into columns by their level of detail. Roots on the
                left, leaves on the right.
              </p>
            </>
          )}

          <form className="flex gap-2 mb-9" onSubmit={onCreate}>
            <input
              className="flex-1 [font:inherit] text-[14px] border border-paper-edge bg-stark text-ink rounded-[7px] px-3 py-2.5 outline-none placeholder:text-ink-4 focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)]"
              placeholder={hasLogbooks ? "New logbook…" : "Name your first logbook…"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={createLogbook.isPending}
            />
            <button
              type="submit"
              className={btnPrimary}
              disabled={createLogbook.isPending || name.trim().length === 0}
            >
              <i className="ri-add-line" aria-hidden="true" />
              {hasLogbooks ? "Create" : "Create logbook"}
            </button>
          </form>

          {hasLogbooks && (
            <>
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-4 flex items-center gap-2.5 mb-3 after:content-[''] after:flex-1 after:h-px after:bg-paper-edge">
                Your logbooks · {logbooks.length}
              </div>
              <div className="flex flex-col bg-stark border border-paper-edge rounded-lg overflow-hidden mb-[22px] divide-y divide-stark-border-soft">
                {logbooks.map((lb) => (
                  <Link
                    key={lb.id}
                    to={`/${lb.id}`}
                    className="flex items-center gap-3.5 px-3.5 py-3 cursor-pointer bg-stark no-underline text-[inherit] hover:bg-stark-soft"
                  >
                    <span className="size-[28px] rounded-[5px] bg-paper-soft border border-paper-edge inline-flex items-center justify-center text-ink-3 flex-shrink-0 text-[14px]">
                      <i className="ri-book-2-line" aria-hidden="true" />
                    </span>
                    <span className="text-[13.5px] font-medium text-ink flex-1 min-w-0">
                      {lb.name}
                    </span>
                    <span className="text-[12px] text-ink-3 tabular-nums">
                      {lb.entryCount} {lb.entryCount === 1 ? "entry" : "entries"} · edited{" "}
                      {formatRelative(lb.updatedAt)}
                    </span>
                    <i className="ri-arrow-right-s-line text-ink-4" />
                  </Link>
                ))}
              </div>
            </>
          )}

          {hasDemos && (
            <>
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-4 flex items-center gap-2.5 mb-3 after:content-[''] after:flex-1 after:h-px after:bg-paper-edge">
                {hasLogbooks || isLoading
                  ? `Demo logbooks · ${demoLogbooks.length}`
                  : "Or try it without an account"}
              </div>
              <div className="flex flex-col gap-2">
                {demoLogbooks.map((lb) => (
                  <Link
                    key={lb.id}
                    to={`/${lb.id}`}
                    className="flex items-center gap-2.5 px-[14px] py-3 border border-dashed border-paper-edge rounded-lg bg-paper-col-even no-underline text-[inherit] hover:bg-paper-soft"
                  >
                    <span className="font-mono text-[10px] bg-ink text-paper px-[6px] py-[2px] rounded-[3px] tracking-[0.05em] uppercase flex-none leading-[1.4]">
                      Demo
                    </span>
                    <span className="flex-1 text-[13px] text-ink-2">{lb.name}</span>
                    <span className="text-[12px] text-ink-3 tabular-nums">
                      {lb.entryCount} {lb.entryCount === 1 ? "entry" : "entries"}
                    </span>
                    <i className="ri-arrow-right-s-line text-ink-4" />
                  </Link>
                ))}
              </div>
            </>
          )}

          <div className="mt-auto pt-6 text-[11.5px] text-ink-4 flex justify-between items-center">
            <span>v0.1 · local-first · single user</span>
            <a href="#" className="text-ink-3 no-underline hover:text-ink">
              {hasLogbooks ? "Sign out" : "Sign in"}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
