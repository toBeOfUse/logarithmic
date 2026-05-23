/**
 * TipTap mark for inline comments. Renders as `<span data-comment>…</span>`
 * in the editor's DOM; the markdown round-trip in `~/lib/markdown.ts` turns
 * that span into `<!-- … -->` and back again.
 */
import { Mark, mergeAttributes } from "@tiptap/core";

import { COMMENT_DATA_ATTR } from "~/lib/markdown.ts";

export const CommentMark = Mark.create({
  name: "comment",

  parseHTML() {
    return [{ tag: `span[${COMMENT_DATA_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { [COMMENT_DATA_ATTR]: "true", class: "comment" }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-/": () => this.editor.commands.toggleMark(this.name),
    };
  },
});
