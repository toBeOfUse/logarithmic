import type { Metadata } from "logarithmic-backend/api-types";

const pillBase =
  "inline-flex items-center gap-1.5 min-h-6 px-[9px] rounded-md bg-[oklch(0.965_0.003_250)] border border-stark-border-soft text-[12px] text-ink-2 font-medium whitespace-nowrap";

export function MetadataPills({
  metadata,
  onAddProperty,
}: {
  metadata: Metadata | null;
  onAddProperty?: () => void;
}) {
  const entries = metadata ? Object.entries(metadata) : [];
  return (
    <div className="flex flex-wrap gap-1.5 items-center mb-1">
      {entries.map(([key, value]) => {
        if (Array.isArray(value)) {
          return (
            <span key={key} className={pillBase}>
              <span className="text-ink-3 font-medium">{key}</span>
              {value.map((v, i) => (
                <span
                  key={i}
                  className="inline-flex items-center h-5 px-[7px] rounded text-[11.5px] bg-stark border border-stark-border text-ink-2"
                >
                  {v}
                </span>
              ))}
            </span>
          );
        }
        if (value === null) {
          return (
            <span key={key} className={pillBase}>
              <span className="text-ink-3 font-medium">{key}</span>
              <span className="text-ink-4">—</span>
            </span>
          );
        }
        return (
          <span key={key} className={pillBase}>
            <span className="text-ink-3 font-medium">{key}</span>
            <span className="text-ink">{value}</span>
          </span>
        );
      })}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 min-h-6 px-[9px] rounded-md bg-transparent border border-dashed border-ink-5 text-[12px] text-ink-3 font-normal whitespace-nowrap cursor-pointer hover:text-ink hover:border-ink-3"
        onClick={onAddProperty}
      >
        <i className="ri-add-line" />
        Add property
      </button>
    </div>
  );
}
