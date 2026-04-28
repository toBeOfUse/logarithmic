# Frontend

The frontend will use React Router. It will operate in SPA mode. It will fetch data using the React Query tRPC client. It will use Tailwind CSS for styling. It should use Remix icons. It should have a clean, minimal, spacious aesthetic.

## User Interface

The first version of Logarithmic will be accessible via a simple web app. This app has a splash screen that lets you create a logbook or go to a logbook that you've previously created. (All routes except the splash screen should start with a logbook ID.) There are two main tabs in the logbook view: the Organizational view and the Content view. The Organizational tab is open first, and you can click into it to open a entry in the Content tab.

### Organizational Interface

The organizational view shows a spreadsheet/chart of all of the entries. They are arranged in a view similar to a file tree. You can see the column that each entry falls into.

### Content Interface

The content interface should show the entry's title, link back to its parent (if it has one), show its metadata, list its children, and have a text editor for its rich text content.

#### Text Editor

We need a simple WYSIWYG text editor (and a way to convert its contents to Markdown.) As a baseline, it needs standard set of Markdown-friendly formatting options that show up in a tooltip when you highlight some text. For now, let's try the TipTap editor (https://tiptap.dev/llms.txt). The formatting buttons should show up in a tooltip when you highlight some text.

The content should auto-save periodically.

## Demo Logbook

The frontend should have a "demo logbook" that is accessible from the splash screen. This will consist of a series of leaflets that are not persisted and are not loaded from the API that serve to demonstrate the app's functionality. To facilitate this, data-fetching should be encapsulated in hooks (like `useLeaflet` and `useLogbookOverview`) that receive a `demo` parameter that defaults to `false`; if this parameter is `true`, fetching from the API should be disabled and in-memory objects should be returned instead.
