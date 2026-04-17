# Content

Downdraft is built around a tree data structure, where each node in the tree has a name, a numerical "position," the ID of a workspace that owns it, and any or none of the following:

- rich text content
- a set of key-value pairs called "metadata"
- and a set of children.

In more detail:

## Nodes

The nodes in the tree are called "leaflets." (They "unfold" to reveal content.) Their names are simple strings. They have unique IDs. They also have timestamps for when they were created and last updated.

## Rich Text Content

The rich text content is just stored as Markdown.

## Metadata

The metadata consists of key-value pairs, where the keys are strings and the values are either a string, a sequence of strings, or an empty value (null). (Note that one can easily imagine adding more value types, like numbers or dates, in the future.) For example, a leaflet could have a "Description" key with the value "An essay about migratory birds", or a "Tags" key with the values "birds", "essays", and "migration".

There is also a user-modified set of metadata templates, which can be used to add a bunch of keys (with empty values) to a document that fits within a certain category (for example, there might be a default set of attributes for a blog post, or for a task within a project.)

## Children & Positions

Any leaflet can have a set of children. Each leaflet has at most one parent.

This app will store a forest of leaflet trees, not just one. (There is no assumption that all of the content stored by the app is related and should be placed in a single tree.) There is not just one root node; there are many.

Each node also has a "position", which is an integer that indicates its "depth" relative not just to other nodes in its tree, but relative to all of the nodes in all of the trees. Each node has a position one less than that of its parent. The default position is 0. The idea is roughly that most of the content will be concentrated in leaflets that are at position 0; they'll be grouped by their parents that occupy higher positions; and weird sub-notes and digressions will go into the negative numbers.

## Workspaces

Each node belongs to a "workspace." Workspaces partition nodes, and thus, all their content and data. Each metadata template is optionally scoped to a workspace; there should be a set of standard "seed" metadata templates that are universal to all workspaces (and cannot be added to by users.)

Each workspace should have a unguessable random ID.
