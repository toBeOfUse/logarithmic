/**
 * The "/" slash menu (spec/3-frontend.md → "Text Editor"). Typing "/" after a
 * newline or a space opens a vertical menu of block options: the common ones
 * (H2, H3, bulleted/numbered list, blockquote) plus the horizontal rule and the
 * footnote. Selecting one switches the current block to that type (or inserts,
 * for hr/footnote). Code blocks are intentionally absent — they're created only
 * by typing a code fence.
 */
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/extension";
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from "lexical";

import { cn } from "~/lib/cn.ts";
import { INSERT_FOOTNOTE_COMMAND } from "./FootnotePlugin.tsx";

class SlashOption extends MenuOption {
  label: string;
  iconClass: string;
  run: (editor: LexicalEditor) => void;

  constructor(label: string, iconClass: string, run: (editor: LexicalEditor) => void) {
    super(label);
    this.label = label;
    this.iconClass = iconClass;
    this.run = run;
  }
}

/** Convert the current block(s) to the node `create()` returns. Must run inside
 *  an editor update — the slash handler removes the "/" trigger and applies the
 *  block in one update so the caret stays in the originating block. */
function $setBlock(create: () => ElementNode) {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) $setBlocksType(selection, create);
}

export function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState("");

  const triggerFn = useBasicTypeaheadTriggerMatch("/", { minLength: 0 });

  const allOptions = useMemo<SlashOption[]>(
    () => [
      new SlashOption("Heading 2", "ri-h-2", () => $setBlock(() => $createHeadingNode("h2"))),
      new SlashOption("Heading 3", "ri-h-3", () => $setBlock(() => $createHeadingNode("h3"))),
      new SlashOption("Bulleted list", "ri-list-unordered", (e) =>
        e.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
      ),
      new SlashOption("Numbered list", "ri-list-ordered", (e) =>
        e.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
      ),
      new SlashOption("Quote", "ri-double-quotes-r", () => $setBlock(() => $createQuoteNode())),
      new SlashOption("Divider", "ri-separator", (e) =>
        e.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
      ),
      new SlashOption("Footnote", "ri-superscript", (e) =>
        e.dispatchCommand(INSERT_FOOTNOTE_COMMAND, undefined),
      ),
    ],
    [],
  );

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [allOptions, query]);

  const onSelectOption = useCallback(
    (option: SlashOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      // Remove the "/" trigger and run the option in the SAME update. Doing them
      // in separate updates left the caret out of the (now-empty) originating
      // block, so block actions that inspect it — e.g. the divider, which
      // replaces an empty paragraph rather than inserting after it — misfired
      // and left a stray empty line behind. Dispatching a command from inside an
      // update is supported and mirrors Lexical's own ComponentPicker.
      editor.update(() => {
        nodeToRemove?.remove();
        option.run(editor);
      });
      closeMenu();
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<SlashOption>
      onQueryChange={(matching) => setQuery(matching ?? "")}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        anchorElementRef.current
          ? createPortal(
              <div className="absolute z-(--z-menu) flex max-h-80 min-w-[200px] flex-col gap-px overflow-y-auto rounded-md border border-stark-border bg-stark p-1 shadow-lg">
                {options.length === 0 ? (
                  <div className="px-2.5 py-2 text-sm text-muted">No matches</div>
                ) : (
                  options.map((option, i) => (
                    <button
                      key={option.key}
                      type="button"
                      ref={(el) => option.setRefElement(el)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2.5 py-1.5 text-left text-sm whitespace-nowrap text-primary hover:bg-accent-soft",
                        selectedIndex === i && "bg-accent-soft",
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlightedIndex(i)}
                      onClick={() => selectOptionAndCleanUp(option)}
                    >
                      <i
                        className={cn(
                          option.iconClass,
                          "w-[1.2em] text-center text-base text-muted",
                        )}
                      />
                      <span>{option.label}</span>
                    </button>
                  ))
                )}
              </div>,
              anchorElementRef.current,
            )
          : null
      }
    />
  );
}
