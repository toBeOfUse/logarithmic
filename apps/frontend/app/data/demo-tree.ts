/**
 * Seed forest for the demo logbook (life-OS). Mirrors the design's demo data.
 * Each entry's column number is one less than its parent's, per the spec.
 */
export type DemoSeedEntry = {
  id: string;
  name: string;
  col: number;
  content?: string;
  metadata?: Record<string, string | string[] | null>;
  children?: DemoSeedEntry[];
};

export const DEMO_LOGBOOK_ID = "demo";

export const DEMO_TREE: DemoSeedEntry[] = [
  {
    id: "g-creative",
    name: "Make my creative practice non-negotiable",
    col: 4,
    metadata: { Status: "On track", Tags: ["2026"] },
    children: [
      {
        id: "p-novel",
        name: "Finish first draft of the novel",
        col: 3,
        metadata: { Status: "Active", Due: "Jun 30" },
        children: [
          {
            id: "p-novel-ch3",
            name: "Chapter 3 — the lighthouse",
            col: 2,
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
                id: "l-mon",
                name: "Mon · 1,200 words before coffee",
                col: 1,
                metadata: { Day: "Apr 27" },
              },
              {
                id: "l-tue",
                name: "Tue · stuck on the dialogue",
                col: 1,
                metadata: { Day: "Apr 28" },
              },
              {
                id: "l-wed",
                name: "Wed · rewrote the ending of the scene",
                col: 1,
                metadata: { Day: "Apr 29" },
              },
              { id: "n-light", name: "What if the lighthouse is unmanned?", col: 0 },
            ],
          },
          {
            id: "p-novel-research",
            name: "Research — Maine coast 1920s",
            col: 2,
            children: [
              { id: "l-bk1", name: 'Notes from "A History of Lighthouses"', col: 1 },
              { id: "n-tide", name: "Tide tables for Casco Bay (aside)", col: 0 },
            ],
          },
        ],
      },
      {
        id: "p-newsletter",
        name: "Weekly newsletter, 24 issues",
        col: 3,
        metadata: { Status: "Active", Count: "9 / 24" },
        children: [
          {
            id: "p-news-issues",
            name: "Issues",
            col: 2,
            children: [
              {
                id: "iss-09",
                name: "#09 — On finishing things",
                col: 1,
                metadata: { Day: "Apr 21" },
              },
              {
                id: "iss-10",
                name: "#10 — Drafts and dignity",
                col: 1,
                metadata: { Day: "Apr 28" },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "g-health",
    name: "Be a body that can carry me into old age",
    col: 3,
    metadata: { Status: "On track" },
    children: [
      {
        id: "p-run",
        name: "Half marathon in October",
        col: 2,
        metadata: { Status: "Active", Plan: "12 wk" },
        children: [
          {
            id: "p-run-week",
            name: "This week — base building",
            col: 1,
            children: [
              { id: "l-r-mon", name: "Mon · 5km easy", col: 0 },
              { id: "l-r-wed", name: "Wed · intervals 6×400", col: 0 },
              { id: "l-r-sat", name: "Sat · 12km long", col: 0 },
              { id: "n-shoes", name: "Try the new shoes on grass first", col: -1 },
            ],
          },
        ],
      },
      {
        id: "p-sleep",
        name: "Sleep before midnight, every night",
        col: 2,
        metadata: { Status: "Habit", Streak: "11d" },
      },
    ],
  },
  {
    id: "g-learn",
    name: "Read 24 books this year",
    col: 2,
    metadata: { Status: "On track", Count: "8 / 24" },
    children: [
      {
        id: "p-now",
        name: "Currently reading",
        col: 1,
        children: [
          { id: "rd-pattern", name: '"A Pattern Language" — Alexander', col: 0 },
          { id: "rd-deep", name: '"Deep Work" — Newport', col: 0 },
        ],
      },
      {
        id: "p-shelf",
        name: "On the shelf",
        col: 1,
        children: [
          { id: "rd-shape", name: '"Shape Up" — Singer', col: 0 },
          { id: "rd-annie", name: '"Pilgrim at Tinker Creek" — Dillard', col: 0 },
        ],
      },
    ],
  },
  {
    id: "g-fleeting",
    name: "Fleeting notes",
    col: 1,
    metadata: { Kind: "Inbox" },
    children: [
      { id: "f1", name: 'Article idea — "the geometry of attention"', col: 0 },
      { id: "f2", name: 'Re-read "A Pattern Language" sometime', col: 0 },
      { id: "f3", name: "Buy the good olive oil again", col: 0 },
    ],
  },
];
