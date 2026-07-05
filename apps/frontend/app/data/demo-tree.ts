/**
 * Seed forests for the demo logbooks. The frontend supports zero or more
 * demos; each one is a self-contained in-memory logbook.
 *
 * Seed shape: a recursive `Pick` of `EntryNode` plus optional `content` and
 * `metadata`. The structure mirrors what the API now returns from
 * `logbook.overview` (a forest with children nested inline), so no separate
 * `DemoSeedEntry` interface is required — the demo store consumes these
 * seeds and projects to the same API types the backend produces.
 *
 * Every entry carries a hard-coded numeric `id`. Sequential integers make
 * demo URLs stable across reloads (matching the server's auto-increment
 * column) and let `store.createEntry` mint additional ids by counting past
 * the largest seeded value. Ids are unique across *all* demo logbooks because
 * the demo store keys every entry in a single map.
 *
 * Convention reflected in the column choices below (see spec/3-frontend.md):
 *   • Most entries live at col 0 — they are body text.
 *   • Entries at col ≥ 1 are headings. Higher columns are larger headings.
 *   • Entries at col ≤ -1 are asides / footnotes.
 */
import { plainTextContent } from "logarithmic-content/document";
import type { EntryNode, Metadata } from "logarithmic-backend/api-types";

type Seed = Pick<EntryNode, "id" | "name" | "col"> & {
  /** Rich text body as serialized editor (Lexical) JSON; see `plainTextContent`. */
  contentJson?: string;
  metadata?: Metadata;
  /** Optional seeded icon (see Entry entity). Both parts go together. */
  iconName?: string;
  iconFamily?: string;
  children?: Seed[];
};

export type DemoLogbook = {
  /**
   * Stable, hard-coded logbook id. Demo logbooks live only in memory, so this
   * id has to be fixed in the source rather than minted at seed time —
   * otherwise every page load (including opening an entry in a new tab) would
   * generate a fresh id and orphan any existing demo URL. Must be alphanumeric
   * with no hyphen so `parseRouteSegment` reads it back cleanly.
   */
  id: string;
  name: string;
  tree: Seed[];
};

const cookbookTree: Seed[] = [
  {
    id: 29,
    name: "Mains",
    col: 1,
    metadata: { Tags: ["dinner"] },
    iconName: "fire-line",
    iconFamily: "remix",
    children: [
      {
        id: 30,
        name: "Carbonara",
        col: 0,
        metadata: { Time: "25 min" },
        iconName: "heart-line",
        iconFamily: "remix",
      },
      {
        id: 31,
        name: "Cacio e pepe",
        col: 0,
        metadata: { Time: "15 min" },
        children: [{ id: 32, name: "Ratio: ~1g pepper per 100g pasta", col: -1 }],
      },
      { id: 33, name: "Pesto alla Genovese", col: 0, metadata: { Time: "20 min" } },
      { id: 34, name: "Chicken with lemon & thyme", col: 0 },
      { id: 35, name: "Slow-roast pork shoulder", col: 0 },
    ],
  },
  {
    id: 36,
    name: "Sauces & condiments",
    col: 1,
    children: [
      { id: 37, name: "Béchamel", col: 0 },
      { id: 38, name: "Salsa verde", col: 0 },
      { id: 39, name: "Quick pickled onions", col: 0 },
    ],
  },
  {
    id: 40,
    name: "This week's meals",
    col: 1,
    metadata: { Kind: "Plan" },
    children: [
      { id: 41, name: "Mon · pasta night", col: 0 },
      { id: 42, name: "Tue · leftover chicken sandwiches", col: 0 },
      { id: 43, name: "Wed · sheet-pan veg + pickles", col: 0 },
    ],
  },
];

/**
 * The research notebook intentionally exercises layout edge cases:
 *   • a deep singleton chain
 *   • a root at col 0 with no descendants (a flat note)
 *   • a top-level heading at col 2 sitting above col-1 sub-headings
 *   • a chain of asides going from col -1 down to col -2
 */
const researchTree: Seed[] = [
  {
    id: 44,
    name: "Wadden Sea — bird migrations",
    col: 2,
    metadata: { Status: "Active", Tags: ["fieldwork", "2026"] },
    contentJson: plainTextContent(
      "Multi-season survey of stopover sites along the Dutch and German Wadden coast. " +
        "Looking for shifts in arrival timing relative to the 2009 baseline.",
    ),
    children: [
      {
        id: 45,
        name: "Methodology",
        col: 1,
        children: [
          {
            id: 46,
            name: "Survey protocol — daily counts at fixed transects",
            col: 0,
            children: [
              {
                id: 47,
                name: "Hahn et al. (2009) baseline counts",
                col: -1,
                children: [
                  { id: 48, name: "Cited via the 2014 erratum, not the original", col: -2 },
                ],
              },
            ],
          },
          { id: 49, name: "Photo IDs of resident species", col: 0 },
        ],
      },
      {
        id: 50,
        name: "Daily logs",
        col: 1,
        children: [
          { id: 51, name: "Apr 12 · first arrivals (godwits, knots)", col: 0 },
          { id: 52, name: "Apr 13 · NE wind, low counts", col: 0 },
          { id: 53, name: "Apr 14 · overcast, full sweep done", col: 0 },
          { id: 54, name: "Apr 15 · banded a single dunlin", col: 0 },
        ],
      },
      {
        id: 55,
        name: "Working hypothesis — climate driver",
        col: 1,
        children: [
          {
            id: 56,
            name: "Stopover length correlates with sea-surface temp anomaly",
            col: 0,
            contentJson: plainTextContent(
              "Singleton — used to verify that lone-leaf rendering still looks right.",
            ),
          },
        ],
      },
    ],
  },
  {
    id: 57,
    name: "Reading & follow-ups",
    col: 1,
    children: [
      { id: 58, name: "Read: Hahn et al. 2009 (baseline)", col: 0 },
      { id: 59, name: "Email Lars about boat schedule", col: 0 },
      { id: 60, name: "Citizen-science apps — survey landscape", col: 0 },
    ],
  },
  // A bare body-level root with no children — exercises single-leaflet rendering.
  { id: 61, name: "Musing — what counts as a 'site', exactly?", col: 0 },
];

export const DEMO_LOGBOOKS: DemoLogbook[] = [
  { id: "dc", name: "Demo · cookbook", tree: cookbookTree },
  { id: "dr", name: "Demo · research notebook", tree: researchTree },
  { id: "db", name: "Demo · blank logbook", tree: [] },
];
