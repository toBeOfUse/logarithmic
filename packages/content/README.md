# logarithmic-content

The shared **data layer** for an entry's rich text content.

Logarithmic stores rich text as the JSON its editor (currently [Lexical](https://lexical.dev/)) serializes. Two very different "display layers" need to work with that data:

- the **frontend** renders it in an interactive React editor;
- the **backend** turns it into other file formats (word counts today; HTML/DOCX exports later).

This package is the common ground underneath both. It owns the document model — the node schema, the canonical (headless) definitions of custom nodes, and the tools that inspect and serialize a stored document — so neither side has to re-derive it, and the backend never has to depend on the frontend's editor UI. See `spec/2-backend.md` ("Content").

```
        frontend (React editor)        backend (serializers)
                    \                    /
                     \                  /
                   logarithmic-content  ← the document model + tools
                     (Lexical, headless — never React)
```

## The one hard rule

This package may depend on Lexical's **headless/core** packages (`lexical`, `@lexical/headless`, and the node packages), which run fine under Node. It must **never** depend on `react` or `@lexical/react` — that's the frontend's display layer, and pulling it in would drag the editor UI into the backend, defeating the whole point of the boundary.

Custom nodes are split accordingly: the canonical node (serialization, nested content, text extraction) lives here as a headless class; the frontend subclasses it to add on-screen rendering (`decorate()`). The footnote node is the first example.

## Exports

| Entry                                     | What it provides                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logarithmic-content/schema`              | `DOCUMENT_NODES` / `CONTENT_NODES` (the node schema) and `createContentEditor()`, a headless editor for parsing and serializing a stored document. |
| `logarithmic-content/word-count`          | `countWords(json)` — counts words in a stored document, footnote bodies included. Safe on null/invalid input.                                      |
| `logarithmic-content/document`            | Builders (`plainTextContent`, `emptyContent`) that produce valid documents, plus the `ContentDocument` type.                                       |
| `logarithmic-content/nodes/footnote-node` | The canonical headless `FootnoteNode` and its helpers/types.                                                                                       |

## Notes

- Documents are Lexical's real `SerializedEditorState` (stored as a JSON string) — there are no bespoke shape types; the data layer speaks the editor's own serialization.
- Inspection/serialization goes through a headless editor so it reuses Lexical's own traversal (e.g. `getTextContent`) and, in future, `@lexical/html` for export — rather than hand-walking JSON.
- Run checks from the repo root (`pnpm run check`); run this package's tests with `pnpm --filter logarithmic-content run test`. It has no Vite config of its own.
