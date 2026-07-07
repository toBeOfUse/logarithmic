import { useEffect, useRef, useState } from "react";

/**
 * Surfaced once after a logbook is created or imported. The token in the URL
 * fragment is the *only* way back into the logbook — there are no accounts —
 * so the modal nags the user to save the link before dismissing.
 *
 * The same link is already in their localStorage, but localStorage is bound to
 * this device + browser profile. The bookmarkable URL is the portable copy.
 */
export function AccessLinkModal({
  url,
  onClose,
}: {
  logbookName: string;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fall back to selecting the input text; user can Ctrl+C manually.
      inputRef.current?.select();
    }
  };

  return (
    <div
      className="fixed inset-0 z-(--z-modal) bg-scrim flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-stark border border-stark-border rounded-lg shadow-2xl p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-link-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="access-link-title" className="m-0 mb-2 text-xl font-semibold text-primary">
          Save your access link
        </h3>
        <p className="m-0 mb-4 text-muted">
          This browser will remember how to access your new logbook. But, if you want to access this
          logbook on other devices or after you clear your history, you'll need to bookmark this
          link or send it to yourself to preserve your access.
        </p>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            readOnly
            value={url}
            className="flex-1 text-sm font-mono border border-stark-border bg-stark text-primary rounded-[7px] px-3 py-2 outline-none focus:border-accent focus:shadow-focus"
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-primary bg-primary text-stark cursor-pointer transition-colors duration-120 hover:bg-primary-hover"
            onClick={copy}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="text-sm font-medium py-2 px-3.5 rounded-md border border-stark-border bg-stark text-primary cursor-pointer transition-colors duration-120 hover:bg-stark-hover"
            onClick={onClose}
          >
            I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}
