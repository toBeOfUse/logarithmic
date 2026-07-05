# Content

Logarithmic is built around a tree data structure, where each node in the tree has a name, an icon, a numerical column number, the ID of a logbook that owns it, and any or none of the following:

- rich text content
- a set of key-value pairs called "metadata"
- a set of children.

In more detail:

## Nodes

The nodes in the tree are called "entries." Their names are simple strings. They have unique IDs. An icon can be set for each of them; the icon family (i.e. `remix` for [Remix Icons](https://remixicon.com/)) and name (i.e. `check-double-line`) are both stored. They have slugs based on their names (which are not guaranteed to be unique; they should only be used alongside IDs, and serve as decoration in things like route parameters.) They also have timestamps for when they were created and last updated.

## Rich Text Content

The rich text content is stored as JSON in the format used by the rich text editor on the frontend. Currently, this is [Lexical](https://lexical.dev/).

## Metadata

The metadata consists of key-value pairs, where the keys are strings and the values are either a string, a sequence of strings, or an empty value (null). <!-- TODO: later, add more types, like numbers and dates. --> For example, a entry could have a "Description" key with the value "An essay about migratory birds", or a "Tags" key with the values "birds", "essays", and "migration".

<!-- TODO: "metadata templates," which consist of a standard set of metadata keys and types that can be used for different types of entries; for example, there might be standardized metadata for a blog post or for a task within a project  -->

## Children & Columns

Any entry can have a set of children. Each entry has at most one parent.

This app will store a forest of trees, not just one. (There is no assumption that all of the content stored by the app is related and should be placed in a single tree.) There is not just one root node; there are many.

Each node also has a "column number", which is an integer that indicates its "depth" relative not just to other nodes in its tree, but relative to all of the nodes in all of the trees. Each node has a column number one less than that of its parent. The default column number is 0. The idea is roughly that most of the content will be concentrated in entries that are in column 0; they'll be grouped by their parents that occupy higher positions; and weird sub-notes and digressions will go into the negative numbers.

Entries are also ordered; each node also has an integer indicating its place in the order relative to its siblings. (Or, if it has no parent, its place in the order relative to the other root nodes.)

## Logbooks

Each node belongs to a "logbook." Logbooks partition nodes, and thus, all their content and data. Each metadata template is optionally scoped to a logbook; there should be a set of standard "seed" metadata templates that are universal to all logbooks (and cannot be added to by users.)

Each logbook should have a unguessable random ID.

A logbook can also store presentation settings for the columns in its organizational view. For each customized column, it records the column number, a display name, and whether the column should be visually wide or narrow.

## Exports

Exports and imports are planned future feature. An export will produce a ZIP file that contains the logbook's content in HTML files, organized in a folder structure that matches the logbook's tree structure. <!-- TODO: implement at a later time. --> <!-- TODO: do we want an import feature as well? -->
