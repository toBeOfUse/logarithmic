# Logarithmic

A pnpm monorepo: a React Router SPA frontend, a Fastify + MikroORM backend, and a
shared content package.

Requires **Node 24** (`engines: >=24.18.0`) and pnpm 10.

## Development

- Install dependencies:

```bash
pnpm install
```

- Run both dev servers (frontend on :5173, backend on :3001):

```bash
pnpm run dev
```

- Format, lint, and type-check (read-only; this is what CI runs):

```bash
pnpm run check
```

- Auto-fix formatting and the lint rules that have safe fixes:

```bash
pnpm run fix
```

Individual steps are available too: `fmt` / `fmt:check` (oxfmt), `lint` /
`lint:fix` (oxlint), and `typecheck` (per-workspace `tsc --noEmit`). Both linters
read a single root config — `.oxfmtrc.json` and `.oxlintrc.json` — and cover the
whole repo, so there is nothing to run per package.

- Run the tests:

```bash
pnpm run test
```

- Build:

```bash
pnpm run build
```

- Check everything is ready (all of the above):

```bash
pnpm run ready
```
