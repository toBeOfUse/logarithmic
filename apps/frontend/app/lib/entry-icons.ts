/**
 * The entry icon set and the helpers that map a stored `(iconName, iconFamily)`
 * pair to a renderable CSS class.
 *
 * Icons are stored on the entry as two parts (see the backend Entry entity):
 * `iconName` is the icon's identifier within its family (e.g. "star-line") and
 * `iconFamily` names the library. Only the Remix family ("remix") exists today;
 * its class names are the icon name prefixed with `ri-`. Keeping the family
 * explicit means a second library can be added later without re-interpreting
 * existing stored names.
 */

/** The only icon family currently supported. */
export const REMIX_FAMILY = "remix";

export type EntryIconOption = {
  /** Stored icon name within its family. */
  name: string;
  /** Short human label for the picker's tooltip / a11y. */
  label: string;
};

/**
 * The 16 picker icons — a small, friendly spread of "what is this entry"
 * markers. All are Remix line icons so they share the chart's outline look.
 */
export const ENTRY_ICONS: EntryIconOption[] = [
  { name: "sticky-note-line", label: "Note" },
  { name: "heart-line", label: "Heart" },
  { name: "fire-line", label: "Fire" },
  { name: "lightbulb-line", label: "Idea" },
  { name: "flag-line", label: "Flag" },
  { name: "bookmark-line", label: "Bookmark" },
  { name: "check-double-line", label: "Done" },
  { name: "error-warning-line", label: "Alert" },
  { name: "leaf-line", label: "Leaf" },
  { name: "cup-line", label: "Coffee" },
  { name: "music-2-line", label: "Music" },
  { name: "camera-line", label: "Camera" },
  { name: "code-s-slash-line", label: "Code" },
  { name: "compass-3-line", label: "Compass" },
  { name: "rocket-2-line", label: "Rocket" },
  { name: "sparkling-2-line", label: "Sparkle" },
];

/**
 * Remix icon name shown when an entry hasn't been given one. Kept separate from
 * the picker set: it's a neutral "no icon chosen yet" marker rather than one of
 * the fun choices a user picks.
 */
export const DEFAULT_ENTRY_ICON_NAME = "sticky-note-line";

/**
 * The CSS class for a stored icon pair, falling back to the default icon when
 * none is set or the family is one we don't recognize. The frontend only knows
 * how to render the Remix family for now.
 */
export function entryIconClass(iconName: string | null, iconFamily: string | null): string {
  if (iconName && iconFamily === REMIX_FAMILY) return `ri-${iconName}`;
  return `ri-${DEFAULT_ENTRY_ICON_NAME}`;
}

/**
 * Whether the entry resolves to the default icon — either because none is set
 * or because the chosen icon is the default one. The default is rendered dimmed
 * to read as the neutral "no distinct icon" marker, even when picked on purpose.
 */
export function isDefaultEntryIcon(iconName: string | null, iconFamily: string | null): boolean {
  return entryIconClass(iconName, iconFamily) === `ri-${DEFAULT_ENTRY_ICON_NAME}`;
}
