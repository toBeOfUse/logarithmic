/**
 * Standard Markdown input shortcuts, limited to the formats the editor offers:
 *   "## " / "### "        → headings (H2/H3)
 *   "- " / "* " / "1. "   → bulleted / numbered list
 *   "> "                  → blockquote
 *   "---" / "***" / "___" → horizontal rule
 *   ``` fence / `code`    → code block / inline code
 *   **b** *i* ~~s~~       → bold / italic / strikethrough
 *   [text](url)           → link
 *
 * Formats we don't expose are intentionally left out: H1 (the entry title is the
 * only H1 — spec/3-frontend.md), highlight, checklists, and underline (which has
 * no standard Markdown form; it stays toolbar-only).
 */
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type ElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/extension";

// The standard HEADING shortcut allows H1–H6; restrict it to H2/H3 so "# "
// never creates an H1 in the body. `replace` derives the level from the match,
// so overriding the pattern is enough.
const HEADING_H2_H3: ElementTransformer = {
  ...HEADING,
  regExp: /^(#{2,3})\s/,
};

// "---" / "***" / "___" on their own line become a horizontal rule. (Lexical's
// default TRANSFORMERS don't include one.)
const HORIZONTAL_RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? "---" : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const line = $createHorizontalRuleNode();
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line);
    } else {
      parentNode.insertBefore(line);
    }
    line.selectNext();
  },
  type: "element",
};

export const MARKDOWN_SHORTCUTS: Transformer[] = [
  HORIZONTAL_RULE,
  CODE,
  HEADING_H2_H3,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
  LINK,
];
