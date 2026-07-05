import type { EditorThemeClasses } from "lexical";

import styles from "./editor.module.css";

/**
 * Lexical theme — maps node types to class names. Block elements (paragraphs,
 * headings, lists, quotes, hr) are styled by `@tailwindcss/typography` (`prose`)
 * plus the content tweaks in `editor.module.css`, so they need no classes here.
 * Inline text formats use Tailwind utilities; inline/block code use the module.
 */
export const editorTheme: EditorThemeClasses = {
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline underline-offset-2",
    strikethrough: "line-through",
    underlineStrikethrough: "underline underline-offset-2 line-through",
    code: styles.inlineCode,
  },
  link: "text-accent-text underline",
  code: styles.codeBlock,
  list: {
    // The wrapper <li> that holds a nested list needs its own marker hidden
    // (Tab indents a list item into a sub-list). Everything else is prose.
    nested: {
      listitem: styles.nestedListItem,
    },
  },
};
