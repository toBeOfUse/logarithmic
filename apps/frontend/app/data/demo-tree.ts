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
 * Convention reflected in the column choices below (see spec/3-frontend.md):
 *   • Most entries live at col 0 — they are body text.
 *   • Entries at col ≥ 1 are headings. Higher columns are larger headings.
 *   • Entries at col ≤ -1 are asides / footnotes.
 */
import type { EntryNode, Metadata } from "logarithmic-backend/api-types";

type Seed = Pick<EntryNode, "name" | "col"> & {
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
    name: "Creative practice",
    col: 2,
    metadata: { Status: "On track", Tags: ["2026"] },
    children: [
      {
        name: "Novel — first draft",
        col: 1,
        metadata: { Status: "Active", Due: "Jun 30" },
        children: [
          {
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
              { name: "What if the lighthouse is unmanned the whole time?", col: -1 },
              { name: "Cross-ref the Casco Bay tide tables before final pass", col: -1 },
            ],
          },
          { name: "Mon · 1,200 words before coffee", col: 0, metadata: { Day: "Apr 27" } },
          {
            name: "Tue · stuck on the dialogue, walked it off",
            col: 0,
            metadata: { Day: "Apr 28" },
          },
          { name: "Wed · rewrote the ending of the scene", col: 0, metadata: { Day: "Apr 29" } },
          { name: "Research — Maine coast 1920s", col: 0 },
          { name: 'Notes from "A History of Lighthouses"', col: 0 },
        ],
      },
      {
        name: "Weekly newsletter",
        col: 1,
        metadata: { Status: "Active", Count: "9 / 24" },
        children: [
          { name: "#09 — On finishing things", col: 0, metadata: { Day: "Apr 21" } },
          { name: "#10 — Drafts and dignity", col: 0, metadata: { Day: "Apr 28" } },
          { name: "Next week — quiet weeks vs. loud weeks", col: 0 },
        ],
      },
    ],
  },
  {
    name: "Health",
    col: 1,
    metadata: { Status: "On track" },
    children: [
      { name: "Mon · 5km easy", col: 0 },
      { name: "Wed · intervals 6×400", col: 0 },
      {
        name: "Sat · 12km long, felt good",
        col: 0,
        children: [{ name: "Try the new shoes on grass first", col: -1 }],
      },
      { name: "Slept before midnight 11 nights running", col: 0 },
    ],
  },
  {
    name: "Reading",
    col: 1,
    metadata: { Status: "On track", Count: "8 / 24" },
    children: [
      { name: 'Started "A Pattern Language" — Alexander', col: 0 },
      { name: 'Finished "Deep Work" — Newport', col: 0 },
      { name: '"Shape Up" — on deck', col: 0 },
      { name: '"Pilgrim at Tinker Creek" — on deck', col: 0 },
    ],
  },
  { name: 'Article idea — "the geometry of attention"', col: 0 },
  { name: "Buy the good olive oil again", col: 0 },
  { name: "Re-read the Pattern Language preface sometime", col: 0 },
];

const cookbookTree: Seed[] = [
  {
    name: "Mains",
    col: 1,
    metadata: { Tags: ["dinner"] },
    children: [
      { name: "Carbonara", col: 0, metadata: { Time: "25 min" } },
      {
        name: "Cacio e pepe",
        col: 0,
        metadata: { Time: "15 min" },
        children: [{ name: "Ratio: ~1g pepper per 100g pasta", col: -1 }],
      },
      { name: "Pesto alla Genovese", col: 0, metadata: { Time: "20 min" } },
      { name: "Chicken with lemon & thyme", col: 0 },
      { name: "Slow-roast pork shoulder", col: 0 },
    ],
  },
  {
    name: "Sauces & condiments",
    col: 1,
    children: [
      { name: "Béchamel", col: 0 },
      { name: "Salsa verde", col: 0 },
      { name: "Quick pickled onions", col: 0 },
    ],
  },
  {
    name: "This week's meals",
    col: 1,
    metadata: { Kind: "Plan" },
    children: [
      { name: "Mon · pasta night", col: 0 },
      { name: "Tue · leftover chicken sandwiches", col: 0 },
      { name: "Wed · sheet-pan veg + pickles", col: 0 },
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
    name: "Wadden Sea — bird migrations",
    col: 2,
    metadata: { Status: "Active", Tags: ["fieldwork", "2026"] },
    content:
      "Multi-season survey of stopover sites along the Dutch and German Wadden coast. " +
      "Looking for shifts in arrival timing relative to the 2009 baseline.",
    children: [
      {
        name: "Methodology",
        col: 1,
        children: [
          {
            name: "Survey protocol — daily counts at fixed transects",
            col: 0,
            children: [
              {
                name: "Hahn et al. (2009) baseline counts",
                col: -1,
                children: [{ name: "Cited via the 2014 erratum, not the original", col: -2 }],
              },
            ],
          },
          { name: "Photo IDs of resident species", col: 0 },
        ],
      },
      {
        name: "Daily logs",
        col: 1,
        children: [
          { name: "Apr 12 · first arrivals (godwits, knots)", col: 0 },
          { name: "Apr 13 · NE wind, low counts", col: 0 },
          { name: "Apr 14 · overcast, full sweep done", col: 0 },
          { name: "Apr 15 · banded a single dunlin", col: 0 },
        ],
      },
      {
        name: "Working hypothesis — climate driver",
        col: 1,
        children: [
          {
            name: "Stopover length correlates with sea-surface temp anomaly",
            col: 0,
            content: "Singleton — used to verify that lone-leaf rendering still looks right.",
          },
        ],
      },
    ],
  },
  {
    name: "Reading & follow-ups",
    col: 1,
    children: [
      { name: "Read: Hahn et al. 2009 (baseline)", col: 0 },
      { name: "Email Lars about boat schedule", col: 0 },
      { name: "Citizen-science apps — survey landscape", col: 0 },
    ],
  },
  // A bare body-level root with no children — exercises single-leaflet rendering.
  { name: "Musing — what counts as a 'site', exactly?", col: 0 },
];

export const DEMO_LOGBOOKS: DemoLogbook[] = [
  { name: "Demo · life-OS", tree: lifeOsTree },
  { name: "Demo · cookbook", tree: cookbookTree },
  { name: "Demo · research notebook", tree: researchTree },
  { name: "Demo · blank logbook", tree: [] },
];
