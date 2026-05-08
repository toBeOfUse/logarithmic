import type { Metadata } from "logarithmic-backend/api-types";

const pillBase =
  "inline-flex items-center gap-1.5 min-h-6 px-[9px] rounded-md bg-stark-soft border border-stark-border-soft text-sm text-secondary font-medium whitespace-nowrap";

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
              <span className="text-muted font-medium">{key}</span>
              {value.map((v, i) => (
                <span
                  key={i}
                  className="inline-flex items-center h-5 px-[7px] rounded text-xs bg-stark border border-stark-border text-secondary"
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
              <span className="text-muted font-medium">{key}</span>
              <span className="text-muted">—</span>
            </span>
          );
        }
        return (
          <span key={key} className={pillBase}>
            <span className="text-muted font-medium">{key}</span>
            <span className="text-primary">{value}</span>
          </span>
        );
      })}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 min-h-6 px-[9px] rounded-md bg-transparent border border-dashed border-paper-edge text-sm text-muted font-normal whitespace-nowrap cursor-pointer hover:text-primary hover:border-muted"
        onClick={onAddProperty}
      >
        <i className="ri-add-line" />
        Add property
      </button>
    </div>
  );
}
