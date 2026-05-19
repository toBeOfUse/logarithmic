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
import type { EntryNode, Metadata } from "logarithmic-backend/api-types";

type Seed = Pick<EntryNode, "id" | "name" | "col"> & {
  content?: string;
  metadata?: Metadata;
  children?: Seed[];
};

export type DemoLogbook = {
  name: string;
  tree: Seed[];
};

const lifeOsTree: Seed[] = [
  {
    id: 1,
    name: "Creative practice",
    col: 2,
    metadata: { Status: "On track", Tags: ["2026"] },
    children: [
      {
        id: 2,
        name: "Novel — first draft",
        col: 1,
        metadata: { Status: "Active", Due: "Jun 30" },
        children: [
          {
            id: 3,
            name: "Chapter 3 — the lighthouse",
            col: 0,
            metadata: {
              Status: "Drafting",
              "Word count": "2,140",
              Tags: ["fiction", "novel", "ch3"],
            },
            content: [
              "The chapter opens with Ada arriving at the lighthouse on the last ferry of the season. She hasn't been told what to expect — only that the previous keeper left in a hurry, that nothing in the logs explains it, and that someone, anyone, needs to be here when the lamp is lit at sundown.",
              "",
              "## Beats",
              "",
              "- Arrival on the dock; the silence of an island that knows you're coming.",
              "- The keeper's cottage — warm, lived-in, but with one chair pulled away from the table.",
              "- First ascent of the tower. The **lamp room** is immaculate.",
              "- What she finds in the *logbook*: forty years of weather, then nothing.",
              "",
              "## The discovery",
              "",
              "The trick is that the discovery shouldn't feel like a twist. Ada notices it the way you notice that a song has changed key — slowly, then all at once. The lighthouse has been keeping itself.",
              "",
              '> "She wrote the date at the top of the page, and the lamp, having waited politely for her to do so, came on by itself."',
              "",
              "### Open questions",
              "",
              "1. Does Ada tell anyone? (Not in this chapter.)",
              "2. How long has it been keeping itself? Cut to the aside on Casco Bay tides.",
            ].join("\n"),
            children: [
              { id: 4, name: "What if the lighthouse is unmanned the whole time?", col: -1 },
              { id: 5, name: "Cross-ref the Casco Bay tide tables before final pass", col: -1 },
            ],
          },
          { id: 6, name: "Mon · 1,200 words before coffee", col: 0, metadata: { Day: "Apr 27" } },
          {
            id: 7,
            name: "Tue · stuck on the dialogue, walked it off",
            col: 0,
            metadata: { Day: "Apr 28" },
          },
          {
            id: 8,
            name: "Wed · rewrote the ending of the scene",
            col: 0,
            metadata: { Day: "Apr 29" },
          },
          { id: 9, name: "Research — Maine coast 1920s", col: 0 },
          { id: 10, name: 'Notes from "A History of Lighthouses"', col: 0 },
        ],
      },
      {
        id: 11,
        name: "Weekly newsletter",
        col: 1,
        metadata: { Status: "Active", Count: "9 / 24" },
        children: [
          { id: 12, name: "#09 — On finishing things", col: 0, metadata: { Day: "Apr 21" } },
          { id: 13, name: "#10 — Drafts and dignity", col: 0, metadata: { Day: "Apr 28" } },
          { id: 14, name: "Next week — quiet weeks vs. loud weeks", col: 0 },
        ],
      },
    ],
  },
  {
    id: 15,
    name: "Health",
    col: 1,
    metadata: { Status: "On track" },
    children: [
      { id: 16, name: "Mon · 5km easy", col: 0 },
      { id: 17, name: "Wed · intervals 6×400", col: 0 },
      {
        id: 18,
        name: "Sat · 12km long, felt good",
        col: 0,
        children: [{ id: 19, name: "Try the new shoes on grass first", col: -1 }],
      },
      { id: 20, name: "Slept before midnight 11 nights running", col: 0 },
    ],
  },
  {
    id: 21,
    name: "Reading",
    col: 1,
    metadata: { Status: "On track", Count: "8 / 24" },
    children: [
      { id: 22, name: 'Started "A Pattern Language" — Alexander', col: 0 },
      { id: 23, name: 'Finished "Deep Work" — Newport', col: 0 },
      { id: 24, name: '"Shape Up" — on deck', col: 0 },
      { id: 25, name: '"Pilgrim at Tinker Creek" — on deck', col: 0 },
    ],
  },
  { id: 26, name: 'Article idea — "the geometry of attention"', col: 0 },
  { id: 27, name: "Buy the good olive oil again", col: 0 },
  { id: 28, name: "Re-read the Pattern Language preface sometime", col: 0 },
];

const cookbookTree: Seed[] = [
  {
    id: 29,
    name: "Mains",
    col: 1,
    metadata: { Tags: ["dinner"] },
    children: [
      { id: 30, name: "Carbonara", col: 0, metadata: { Time: "25 min" } },
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
    content:
      "Multi-season survey of stopover sites along the Dutch and German Wadden coast. " +
      "Looking for shifts in arrival timing relative to the 2009 baseline.",
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
            content: "Singleton — used to verify that lone-leaf rendering still looks right.",
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
  { name: "Demo · life-OS", tree: lifeOsTree },
  { name: "Demo · cookbook", tree: cookbookTree },
  { name: "Demo · research notebook", tree: researchTree },
  { name: "Demo · blank logbook", tree: [] },
];
