import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A single delete-confirmation request. The dialog renders this copy and, on
 * confirm, runs `onConfirm`; while a promise it returns is pending the confirm
 * button shows `busyLabel` and both buttons disable, then the dialog closes
 * once it settles.
 */
export type ConfirmDeleteRequest = {
  /** Heading, e.g. "Delete entry?". */
  title: string;
  /** Body copy spelling out what will be removed. */
  body: ReactNode;
  /** Confirm-button label at rest. Defaults to "Delete". */
  confirmLabel?: string;
  /** Confirm-button label while the deletion runs. Defaults to "Deleting…". */
  busyLabel?: string;
  /** The deletion itself. If it returns a promise the dialog stays open in its
   *  busy state until the promise settles; it closes once the promise resolves.
   *  (A rejection leaves the dialog open so the user can retry; surfacing the
   *  error is the caller's concern.) */
  onConfirm: () => void | Promise<unknown>;
};

/**
 * Shared "are you sure you want to delete this?" confirmation. Call `confirm`
 * with the copy and the deletion to run, and render `dialog` somewhere in the
 * tree. Lifted out of the entry route's original inline modal so the org-view
 * card delete and the logbook delete reuse the exact same dialog, busy handling,
 * and dismissal behavior.
 */
export function useConfirmDelete(): {
  confirm: (request: ConfirmDeleteRequest) => void;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmDeleteRequest | null>(null);
  const [busy, setBusy] = useState(false);
  // Read `busy` from a ref inside the stable callbacks so they don't churn as
  // it flips — and so a close attempt mid-deletion is reliably ignored.
  const busyRef = useRef(false);
  busyRef.current = busy;

  const confirm = useCallback((next: ConfirmDeleteRequest) => {
    setRequest(next);
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    if (busyRef.current) return;
    setRequest(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (busyRef.current) return;
    try {
      setBusy(true);
      await request?.onConfirm();
      setRequest(null);
    } finally {
      setBusy(false);
    }
  }, [request]);

  const dialog = request ? (
    <ConfirmDeleteModal
      title={request.title}
      body={request.body}
      confirmLabel={request.confirmLabel ?? "Delete"}
      busyLabel={request.busyLabel ?? "Deleting…"}
      busy={busy}
      onCancel={close}
      onConfirm={handleConfirm}
    />
  ) : null;

  return { confirm, dialog };
}

function ConfirmDeleteModal({
  title,
  body,
  confirmLabel,
  busyLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  busyLabel: string;
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

  return (
    <div
      className="fixed inset-0 z-(--z-modal) bg-scrim flex items-center justify-center p-6"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-md bg-stark border border-stark-border rounded-lg shadow-2xl p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-delete-title" className="m-0 mb-2 text-xl font-semibold text-primary">
          {title}
        </h3>
        <p className="m-0 mb-4 text-muted">{body}</p>
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
            type="button"
            disabled={busy}
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-warn bg-warn text-stark cursor-pointer transition-colors duration-120 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Copy for deleting an entry, shared by the content route's kebab item and the
 * org-view card delete so both phrase the irreversible "this and all its
 * descendants" warning identically. Pass the entry's name (empty string for an
 * untitled entry).
 */
export function entryDeleteRequest(name: string): Pick<ConfirmDeleteRequest, "title" | "body"> {
  return {
    title: "Delete entry?",
    body: name ? (
      <>
        <span className="text-primary font-medium">"{name}"</span> and all of its descendants will
        be permanently deleted. This cannot be undone.
      </>
    ) : (
      <>This entry and all of its descendants will be permanently deleted. This cannot be undone.</>
    ),
  };
}
