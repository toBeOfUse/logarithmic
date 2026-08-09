# General Instructions

- Be concise in output but thorough in reasoning.
- No sycophantic openers or closing fluff.
- Prefer editing over rewriting whole files.
- Where possible, use scaffolding and code generation tools instead of manually outputting code.
- The "spec" directory is where plans live.
  - Don't act on TODO comments in the spec files yet.
- Don't use barrel files.
- Habitually read examples from linked documentation.
- Only read files from a node_modules directory as an absolute last resort. Prefer getting documentation for the package online.
- On the frontend, always prefer links over callbacks that programmatically navigate. (This lets the user open stuff in new tabs.)
- Run type checks before tests.
- Do not use `any` or `unknown` to fix type errors.
- Use `import type` to get types from packages before using them, instead of `const variable: import('some-package').SomeType`.
- Tests should be organized according to the scenario that they are testing. The purpose of each test should be very clear. Whenever possible, they should be described behaviorally with invariant statements roughly along the lines of "users cannot read other user's records from the database" or "after the doThing function is called, x should be set to y."
- Use pnpm to manage the workspace and run tasks. See the toolchain section below.
- Please avoid custom (square-brackets) Tailwind CSS classes wherever possible. Everything should be based on the design tokens in globals.css. If we need new token(s), flag that as an upcoming change after your work.

# Toolchain

Node 24. Plain pnpm plus the upstream tools. Vite 8 (`vite`), Vitest 4 (`vitest`), oxlint (`.oxlintrc.json`), oxfmt (`.oxfmtrc.json`), TypeScript. Import test utilities from `vitest`, and Vite config helpers from `vite`.

## CI

`pnpm install --frozen-lockfile` then `pnpm run ready`, on Node 24.

# Browser Automation

Use the Playwright CLI skill for browser automation when prompted. Run it with `pnpm dlx @playwright/cli`, like this:

```bash
pnpm dlx @playwright/cli --help
```

**When saving screenshots, place them in a folder called '.playwright-cli', which will be gitignored.**

_Always check if a dev server is already running before starting a new one. Run `curl -I http://localhost:5173` and look for a 200 response code._
