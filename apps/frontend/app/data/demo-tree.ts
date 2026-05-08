/**
 * Seed forests for the demo logbooks. The frontend supports zero or more
 * demos; each one is a self-contained in-memory logbook. The IDs here are
 * checked by `isDemoLogbook` to route reads to the demo store.
 *
 * Convention reflected in the column choices below (see spec/3-frontend.md):
 *   • Most entries live at col 0 — they are body text.
 *   • Entries at col ≥ 1 are headings. Higher columns are larger headings.
 *   • Entries at col ≤ -1 are asides / footnotes.
 */
export type DemoSeedEntry = {
  id: string;
  name: string;
  col: number;
  content?: string;
  metadata?: Record<string, string | string[] | null>;
  children?: DemoSeedEntry[];
};

export type DemoLogbook = {
  id: string;
  name: string;
  tree: DemoSeedEntry[];
};

const lifeOsTree: DemoSeedEntry[] = [
  {
    id: "g-creative",
    name: "Creative practice",
    col: 2,
    metadata: { Status: "On track", Tags: ["2026"] },
    children: [
      {
        id: "p-novel",
        name: "Novel — first draft",
        col: 1,
        metadata: { Status: "Active", Due: "Jun 30" },
        children: [
          {
            id: "p-novel-ch3",
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
              {
                id: "n-light",
                name: "What if the lighthouse is unmanned the whole time?",
                col: -1,
              },
              {
                id: "n-tide",
                name: "Cross-ref the Casco Bay tide tables before final pass",
                col: -1,
              },
            ],
          },
          {
            id: "l-mon",
            name: "Mon · 1,200 words before coffee",
            col: 0,
            metadata: { Day: "Apr 27" },
          },
          {
            id: "l-tue",
            name: "Tue · stuck on the dialogue, walked it off",
            col: 0,
            metadata: { Day: "Apr 28" },
          },
          {
            id: "l-wed",
            name: "Wed · rewrote the ending of the scene",
            col: 0,
            metadata: { Day: "Apr 29" },
          },
          { id: "p-novel-research", name: "Research — Maine coast 1920s", col: 0 },
          { id: "l-bk1", name: 'Notes from "A History of Lighthouses"', col: 0 },
        ],
      },
      {
        id: "p-newsletter",
        name: "Weekly newsletter",
        col: 1,
        metadata: { Status: "Active", Count: "9 / 24" },
        children: [
          {
            id: "iss-09",
            name: "#09 — On finishing things",
            col: 0,
            metadata: { Day: "Apr 21" },
          },
          {
            id: "iss-10",
            name: "#10 — Drafts and dignity",
            col: 0,
            metadata: { Day: "Apr 28" },
          },
          { id: "iss-next", name: "Next week — quiet weeks vs. loud weeks", col: 0 },
        ],
      },
    ],
  },
  {
    id: "g-health",
    name: "Health",
    col: 1,
    metadata: { Status: "On track" },
    children: [
      { id: "l-r-mon", name: "Mon · 5km easy", col: 0 },
      { id: "l-r-wed", name: "Wed · intervals 6×400", col: 0 },
      {
        id: "l-r-sat",
        name: "Sat · 12km long, felt good",
        col: 0,
        children: [{ id: "n-shoes", name: "Try the new shoes on grass first", col: -1 }],
      },
      { id: "p-sleep", name: "Slept before midnight 11 nights running", col: 0 },
    ],
  },
  {
    id: "g-learn",
    name: "Reading",
    col: 1,
    metadata: { Status: "On track", Count: "8 / 24" },
    children: [
      { id: "rd-pattern", name: 'Started "A Pattern Language" — Alexander', col: 0 },
      { id: "rd-deep", name: 'Finished "Deep Work" — Newport', col: 0 },
      { id: "rd-shape", name: '"Shape Up" — on deck', col: 0 },
      { id: "rd-annie", name: '"Pilgrim at Tinker Creek" — on deck', col: 0 },
    ],
  },
  { id: "f1", name: 'Article idea — "the geometry of attention"', col: 0 },
  { id: "f2", name: "Buy the good olive oil again", col: 0 },
  { id: "f3", name: "Re-read the Pattern Language preface sometime", col: 0 },
];

const cookbookTree: DemoSeedEntry[] = [
  {
    id: "ck-mains",
    name: "Mains",
    col: 1,
    metadata: { Tags: ["dinner"] },
    children: [
      { id: "rc-carbonara", name: "Carbonara", col: 0, metadata: { Time: "25 min" } },
      {
        id: "rc-cacio",
        name: "Cacio e pepe",
        col: 0,
        metadata: { Time: "15 min" },
        children: [{ id: "rc-cacio-note", name: "Ratio: ~1g pepper per 100g pasta", col: -1 }],
      },
      { id: "rc-pesto", name: "Pesto alla Genovese", col: 0, metadata: { Time: "20 min" } },
      { id: "rc-chicken", name: "Chicken with lemon & thyme", col: 0 },
      { id: "rc-pork", name: "Slow-roast pork shoulder", col: 0 },
    ],
  },
  {
    id: "ck-sauces",
    name: "Sauces & condiments",
    col: 1,
    children: [
      { id: "rc-bechamel", name: "Béchamel", col: 0 },
      { id: "rc-salsa-verde", name: "Salsa verde", col: 0 },
      { id: "rc-pickled-onions", name: "Quick pickled onions", col: 0 },
    ],
  },
  {
    id: "ck-week",
    name: "This week's meals",
    col: 1,
    metadata: { Kind: "Plan" },
    children: [
      { id: "ck-mon", name: "Mon · pasta night", col: 0 },
      { id: "ck-tue", name: "Tue · leftover chicken sandwiches", col: 0 },
      { id: "ck-wed", name: "Wed · sheet-pan veg + pickles", col: 0 },
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
const researchTree: DemoSeedEntry[] = [
  {
    id: "rs-wadden",
    name: "Wadden Sea — bird migrations",
    col: 2,
    metadata: { Status: "Active", Tags: ["fieldwork", "2026"] },
    content:
      "Multi-season survey of stopover sites along the Dutch and German Wadden coast. " +
      "Looking for shifts in arrival timing relative to the 2009 baseline.",
    children: [
      {
        id: "rs-method",
        name: "Methodology",
        col: 1,
        children: [
          {
            id: "rs-protocol",
            name: "Survey protocol — daily counts at fixed transects",
            col: 0,
            children: [
              {
                id: "rs-protocol-fn1",
                name: "Hahn et al. (2009) baseline counts",
                col: -1,
                children: [
                  {
                    id: "rs-protocol-fn2",
                    name: "Cited via the 2014 erratum, not the original",
                    col: -2,
                  },
                ],
              },
            ],
          },
          { id: "rs-photoid", name: "Photo IDs of resident species", col: 0 },
        ],
      },
      {
        id: "rs-logs",
        name: "Daily logs",
        col: 1,
        children: [
          { id: "rs-log1", name: "Apr 12 · first arrivals (godwits, knots)", col: 0 },
          { id: "rs-log2", name: "Apr 13 · NE wind, low counts", col: 0 },
          { id: "rs-log3", name: "Apr 14 · overcast, full sweep done", col: 0 },
          { id: "rs-log4", name: "Apr 15 · banded a single dunlin", col: 0 },
        ],
      },
      {
        id: "rs-deep",
        name: "Working hypothesis — climate driver",
        col: 1,
        children: [
          {
            id: "rs-deep-1",
            name: "Stopover length correlates with sea-surface temp anomaly",
            col: 0,
            content: "Singleton — used to verify that lone-leaf rendering still looks right.",
          },
        ],
      },
    ],
  },
  {
    id: "rs-inbox",
    name: "Reading & follow-ups",
    col: 1,
    children: [
      { id: "rs-todo1", name: "Read: Hahn et al. 2009 (baseline)", col: 0 },
      { id: "rs-todo2", name: "Email Lars about boat schedule", col: 0 },
      { id: "rs-todo3", name: "Citizen-science apps — survey landscape", col: 0 },
    ],
  },
  // A bare body-level root with no children — exercises single-leaflet rendering.
  { id: "rs-musing", name: "Musing — what counts as a 'site', exactly?", col: 0 },
];

export const DEMO_LOGBOOKS: DemoLogbook[] = [
  { id: "demo", name: "Demo · life-OS", tree: lifeOsTree },
  { id: "demo-cookbook", name: "Demo · cookbook", tree: cookbookTree },
  { id: "demo-research", name: "Demo · research notebook", tree: researchTree },
  { id: "demo-blank", name: "Demo · blank logbook", tree: [] },
];

export const DEMO_LOGBOOK_IDS: ReadonlySet<string> = new Set(DEMO_LOGBOOKS.map((d) => d.id));
