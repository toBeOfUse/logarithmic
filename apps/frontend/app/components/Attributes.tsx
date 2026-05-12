import { useEffect, useState } from "react";

import type { Metadata, MetadataValue } from "logarithmic-backend/api-types";

import { cn } from "~/lib/cn";

const linkText = "text-base text-primary whitespace-nowrap";

const addBtn =
  "inline-flex items-baseline gap-1 bg-transparent border-0 p-0 text-sm text-muted whitespace-nowrap cursor-pointer hover:text-primary [font:inherit]";

type AttrType = "text" | "list";

function inferType(value: MetadataValue): AttrType {
  return Array.isArray(value) ? "list" : "text";
}

function formatValueInline(value: MetadataValue): string | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : null;
  return value === "" ? null : value;
}

type ModalState = { mode: "add" } | { mode: "edit"; key: string };

export function Attributes({
  metadata,
  onChange,
  bare = false,
}: {
  metadata: Metadata | null;
  onChange?: (next: Metadata) => void;
  bare?: boolean;
}) {
  const editable = !!onChange;
  const entries = metadata ? Object.entries(metadata) : [];
  const [modal, setModal] = useState<ModalState | null>(null);

  const closeModal = () => setModal(null);

  const addBtnEl = editable ? (
    <button type="button" className={addBtn} onClick={() => setModal({ mode: "add" })}>
      {entries.length > 0 ? "Add..." : "Add attribute..."}
    </button>
  ) : null;

  const inner = (
    <>
      {entries.map(([key, value]) => (
        <WithTrailingSep key={key}>
          <AttributeText
            name={key}
            value={value}
            editable={editable}
            onClick={() => setModal({ mode: "edit", key })}
          />
        </WithTrailingSep>
      ))}
      {addBtnEl}
      {modal && onChange && (
        <AttributeModal
          metadata={metadata ?? {}}
          state={modal}
          onCancel={closeModal}
          onSave={(name, value) => {
            const next: Metadata = { ...metadata };
            if (modal.mode === "edit" && modal.key !== name) {
              delete next[modal.key];
            }
            next[name] = value;
            onChange(next);
            closeModal();
          }}
          onDelete={
            modal.mode === "edit"
              ? () => {
                  const next: Metadata = { ...metadata };
                  delete next[modal.key];
                  onChange(next);
                  closeModal();
                }
              : undefined
          }
        />
      )}
    </>
  );

  if (bare) return inner;
  return <div className="flex flex-wrap gap-2 items-center">{inner}</div>;
}

function AttributeText({
  name,
  value,
  editable,
  onClick,
}: {
  name: string;
  value: MetadataValue;
  editable: boolean;
  onClick: () => void;
}) {
  const formatted = formatValueInline(value);
  const body = (
    <>
      <span className="text-muted">{name}</span>
      {formatted !== null && (
        <>
          <span className="text-muted">: </span>
          <span>{formatted}</span>
        </>
      )}
    </>
  );
  if (!editable) {
    return <span className={linkText}>{body}</span>;
  }
  return (
    <button
      type="button"
      className={cn(linkText, "[font:inherit] bg-transparent border-0 p-0 m-0 cursor-pointer")}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-paper-edge select-none">
      |
    </span>
  );
}

/** Glues a trailing pipe to the item before it so they wrap together — the
 *  pipe stays at the end of the line rather than starting a wrapped one. */
function WithTrailingSep({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      {children}
      <Sep />
    </span>
  );
}

function AttributeModal({
  metadata,
  state,
  onCancel,
  onSave,
  onDelete,
}: {
  metadata: Metadata;
  state: ModalState;
  onCancel: () => void;
  onSave: (name: string, value: MetadataValue) => void;
  onDelete?: () => void;
}) {
  const initial =
    state.mode === "edit" ? { key: state.key, value: metadata[state.key] ?? null } : null;

  const [name, setName] = useState(initial?.key ?? "");
  const [type, setType] = useState<AttrType>(initial ? inferType(initial.value) : "text");
  const [singleValue, setSingleValue] = useState(
    initial && typeof initial.value === "string" ? initial.value : "",
  );
  const [multiValue, setMultiValue] = useState<string[]>(
    initial && Array.isArray(initial.value) ? initial.value : [""],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const onSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (state.mode === "add" && trimmed in metadata) {
      setError("An attribute with that name already exists");
      return;
    }
    if (state.mode === "edit" && trimmed !== state.key && trimmed in metadata) {
      setError("An attribute with that name already exists");
      return;
    }
    let value: MetadataValue;
    if (type === "text") {
      value = singleValue === "" ? null : singleValue;
    } else {
      const cleaned = multiValue.map((v) => v).filter((v) => v.length > 0);
      value = cleaned.length === 0 ? null : cleaned;
    }
    onSave(trimmed, value);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-[oklch(0.22_0.01_250/0.32)] flex items-center justify-center p-6"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === "add" ? "Add attribute" : "Edit attribute"}
        className="w-full max-w-md bg-stark border border-stark-border rounded-lg shadow-[0_24px_48px_rgba(0,0,0,0.18)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-primary mb-4">
          {state.mode === "add" ? "Add attribute" : "Edit attribute"}
        </h3>

        <div className="space-y-3">
          <Field label="Type">
            <div className="inline-flex border border-stark-border rounded-md overflow-hidden">
              <TypeOption active={type === "text"} onClick={() => setType("text")}>
                Text
              </TypeOption>
              <TypeOption active={type === "list"} onClick={() => setType("list")} bordered>
                List
              </TypeOption>
            </div>
          </Field>

          <Field label="Name">
            <input
              autoFocus
              className={fieldInput}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            />
          </Field>

          <Field label="Value">
            {type === "text" ? (
              <input
                className={fieldInput}
                value={singleValue}
                onChange={(e) => setSingleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
              />
            ) : (
              <MultiValueEditor values={multiValue} onChange={setMultiValue} />
            )}
          </Field>

          {error && <p className="text-sm text-warn">{error}</p>}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div>
            {onDelete && (
              <button
                type="button"
                className="text-sm text-warn hover:underline cursor-pointer bg-transparent border-0 p-0 [font:inherit]"
                onClick={onDelete}
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className={modalBtn} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className={cn(modalBtn, modalBtnPrimary)} onClick={onSubmit}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldInput =
  "[font:inherit] w-full text-sm text-primary bg-stark border border-stark-border rounded-md px-2.5 py-1.5 outline-none focus:border-muted";

const modalBtn =
  "[font:inherit] text-sm font-medium px-3.5 py-1.5 rounded-md border border-stark-border bg-stark text-primary cursor-pointer hover:bg-stark-soft";

const modalBtnPrimary =
  "bg-primary text-stark border-primary hover:bg-primary-hover hover:text-stark";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted tracking-[0.04em] uppercase mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function TypeOption({
  active,
  onClick,
  bordered,
  children,
}: {
  active: boolean;
  onClick: () => void;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "[font:inherit] px-3 py-1 text-sm cursor-pointer",
        bordered && "border-l border-stark-border",
        active ? "bg-stark-soft text-primary" : "bg-stark text-muted hover:text-primary",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MultiValueEditor({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const setAt = (i: number, v: string) => {
    const next = values.slice();
    next[i] = v;
    onChange(next);
  };
  const removeAt = (i: number) => {
    const next = values.slice();
    next.splice(i, 1);
    onChange(next.length > 0 ? next : [""]);
  };
  const add = () => onChange([...values, ""]);
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input className={fieldInput} value={v} onChange={(e) => setAt(i, e.target.value)} />
          <button
            type="button"
            aria-label="Remove value"
            title="Remove value"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-muted hover:text-warn hover:bg-stark-soft cursor-pointer bg-transparent border-0 p-0"
            onClick={() => removeAt(i)}
          >
            <i className="ri-close-line" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-primary cursor-pointer bg-transparent border-0 p-0 [font:inherit]"
        onClick={add}
      >
        <i className="ri-add-line" />
        Add value
      </button>
    </div>
  );
}
